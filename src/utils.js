const fetch = require('node-fetch');
const {HttpsProxyAgent} = require('https-proxy-agent');

const isCI = process.env.CI_ENV == "ci"
const proxy = process.env.HTTP_PROXY || 'http://127.0.0.1:1080'

async function makeRequest(url, opts = {}) {
    let response;
    let options = { ...opts };

    try {
        if (isCI) {
            response = await fetch(url, options);
        } else {
            console.log(`using proxy ${proxy}`)
            options.agent = new HttpsProxyAgent(proxy);
            response = await fetch(url, options);
        }
        return await response.text();
    } catch (e) {
        console.log(`failed to fetch ${url}, error: ${e}`)
        return null
    }
}

function yearStrToNumber(str) {
    let n = parseFloat(str)
    if (isNaN(str) || isNaN(n)) {
        return -1
    }
    return n
}

function cnDateStrToDateStr(str) {
    if (!str?.replaceAll) {
        return str
    }
    str = str.replaceAll(" ", "").replaceAll("日", "")
    str = str.replaceAll("年", "-").replaceAll("月", "-")
    return str + "Z"
}

function getNeedRefreshTargets(newTargets, tracked, opts = {}) {
    const MAX_COUNT_PER_RUN = opts.MAX_COUNT_PER_RUN ?? 20
    const MORE_UNTRACKED_PER_RUN = opts.MORE_UNTRACKED_PER_RUN ?? 40

    console.log("Filtering need refresh targets...")
    if (!tracked) {
        return newTargets
    }

    let today = (new Date()).toISOString().slice(0, 10)
    let needRefreshTargets = []

    for (const target of newTargets) {
        if (needRefreshTargets.length > MORE_UNTRACKED_PER_RUN) {
            console.log(`Untracked apps count > ${MORE_UNTRACKED_PER_RUN}, break`)
            break;
        }
        if (!tracked[target]) {
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
                isUntracked: true,
            })
        }
    }

    let additionalCount = 0
    if (needRefreshTargets.length > 0) {
        additionalCount = Math.min(needRefreshTargets.length, MORE_UNTRACKED_PER_RUN)
    }

    let recentCount = 0

    let RecentGameDatesRangeLeft = -14
    let RecentGameDatesRangeRight = 30
    Object.keys(tracked).forEach(target => {
        let obj = tracked[target]
        if (!obj.meta) {
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
            })
            return
        }

        let lastTrackDate = obj.meta?.last_track_date
        if (!lastTrackDate) {
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
            })
            return
        }

        let difference = (new Date(today)).getTime() - (new Date(lastTrackDate)).getTime()
        let needRefresh = difference > 0

        let recentGamePriority = false
        let tbaPriority = false
        let releaseDate = obj.start
        if (releaseDate) {
            let calendarDate = new Date(releaseDate).getTime()
            if (obj.app_data?.release_date && obj.app_data.release_date.date) {
                let date = new Date(cnDateStrToDateStr(obj.app_data.release_date.date))
                if (date.toString() != "Invalid Date") {
                    calendarDate = Math.min(calendarDate, date.getTime())
                }
            }

            let released = ((new Date(today)).getTime() - calendarDate)
            let days = Math.abs(released / (1000 * 3600 * 24))
            recentGamePriority = RecentGameDatesRangeLeft <= days && days <= RecentGameDatesRangeRight
            if (released < 0 && ((released / (1000 * 3600 * 24)) < -365)) {
                tbaPriority = true
            }
        }

        if (needRefresh || recentGamePriority) {
            let days = difference / (1000 * 3600 * 24);
            if (recentGamePriority) {
                days = 99999
                recentCount += 1
            }
            if (tbaPriority) {
                days += 7
            }
            needRefreshTargets.push({
                target: target,
                outdated_days: days,
                recentGamePriority: recentGamePriority,
                tbaPriority: tbaPriority,
            })
            return
        }
    })

    let maxCount = MAX_COUNT_PER_RUN + additionalCount + recentCount

    let limited = needRefreshTargets.sort((a, b) => {
        return b.outdated_days - a.outdated_days
    }).slice(0, maxCount)

    limited.forEach(x=>{
        if (x.recentGamePriority) {
            // marker for recent
        }
    })

    return limited.map(x => x.target)
}

module.exports = {
    makeRequest,
    yearStrToNumber,
    cnDateStrToDateStr,
    getNeedRefreshTargets,
}
