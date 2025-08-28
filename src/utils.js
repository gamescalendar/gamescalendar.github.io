import fetch from 'node-fetch';
import {HttpsProxyAgent} from 'https-proxy-agent';

const isCI = process.env.CI_ENV == "ci"
const proxy = process.env.HTTP_PROXY || 'http://127.0.0.1:1080'

export async function makeRequest(url, opts = {}) {
    let response;
    let options = { ...opts };

    try {
        console.log(`Fetching ${url}`)
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

export function yearStrToNumber(str) {
    let n = parseFloat(str)
    if (isNaN(str) || isNaN(n)) {
        return -1
    }
    return n
}

export function cnDateStrToDateStr(str) {
    if (!str?.replaceAll) {
        return str
    }
    str = str.replaceAll("Z", "")
    str = str.replaceAll(" ", "").replaceAll("日", "")
    str = str.replaceAll("年", "-").replaceAll("月", "-")
    if (!str) {
        return ""
    }
    let d = new Date(str + "Z") 
    if (d.toString() === "Invalid Date") {
        // console.log(str)
        return ""
    }
    return d.toISOString().slice(0, 10)
}

function getTrackedName(tracked, target) {
    return `${target.toString().padStart(7, ' ')}: ${tracked[target].title}`
    if (tracked[target]) {
    } else {
        return target
    }
}

export function getNeedRefreshTargets(newTargets, tracked, opts = {}) {
    const MAX_COUNT_PER_RUN = opts?.ratelimit?.update ?? 20
    const RecentGameDatesRangeLeft = opts?.recent?.past ?? -14
    const RecentGameDatesRangeRight = opts?.recent?.future ?? 30

    console.log("Filtering need refresh targets...")
    if (!tracked) {
        return newTargets
    }

    let today = (new Date()).toISOString().slice(0, 10)
    let needRefreshTargets = []

    let recentCount = 0

    Object.keys(tracked).forEach(target => {
        let obj = tracked[target]
        if (!obj.meta) {
            console.log(`${getTrackedName(tracked, target)} tracked but no metadata, add to refresh list`)
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
            })
            return
        }

        if ((obj.app_data?.metaScore && !obj.app_data?.metaReviewsCount) || (obj.app_data?.userScore && !obj.app_data?.userReviewsCount)) {
            console.log(`${getTrackedName(tracked, target)} tracked but reviews score and count mismatched`)
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
            })
            return
        }

        let lastTrackDate = obj.meta?.last_track_date
        if (!lastTrackDate) {
            console.log(`${getTrackedName(tracked, target)} tracked but no last_track_date, add to refresh list`)
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

        if (!opts?.recent?.forceUpdate) {
            recentGamePriority = false
        }

        if (needRefresh || recentGamePriority) {
            let days = difference / (1000 * 3600 * 24);
            if (recentGamePriority) {
                days = 99999
                recentCount += 1
                // console.log(`${getTrackedName(tracked, target)} is a recent game`)
            }
            if (tbaPriority) {
                days += 7
            }
            // console.log(`${getTrackedName(tracked, target)} outdated for ${days} days, add to refresh list (${steamAppIdMap[target]}) `)
            needRefreshTargets.push({
                target: target,
                outdated_days: days,
                recentGamePriority: recentGamePriority,
                tbaPriority: tbaPriority,
            })
            return
        }
        // console.log(`skip ${getTrackedName(tracked, target)} because last tracked date is today: ${today}`)
    })

    let maxCount = MAX_COUNT_PER_RUN + recentCount

    console.log(`Total ${maxCount}, ${recentCount} additional updates due to recent`)

    let limited = needRefreshTargets.sort((a, b) => {
        return b.outdated_days - a.outdated_days
    }).slice(0, maxCount)

    limited.forEach(x=>{
        if (x.recentGamePriority) {
            console.log(`Recent release ${tracked[x.target].start}: ${getTrackedName(tracked, x.target)}`)
        }
        if (x.tbaPriority) {
            console.log(`[TBA] ${x.outdated_days.toString().padStart(5, " ")} days ago: ${getTrackedName(tracked, x.target)}`)
        }
        if (x.isUntracked) {
            console.log(`Untracked: ${getTrackedName(tracked, x.target)}`)
        }
        if (!x.recentGamePriority && !x.tbaPriority && !x.isUntracked) {
            console.log(`Last sync: ${x.outdated_days.toString().padStart(5, " ")} days ago: ${getTrackedName(tracked, x.target)}`)
        }
    })

    return limited.map(x => x.target)
}

const quarterMap = {
'Q1': '03-31',
'Q2': '06-30',
'Q3': '09-30',
'Q4': '12-31'
};
export function ResolveDateFromString(inputStr) {
  let upperStr = inputStr.toUpperCase();
  let foundYear = null;
  let foundQuarter = null;

  // 替换季度
  for (const qKey in quarterMap) {
    if (upperStr.includes(qKey)) {
      foundQuarter = qKey;
      upperStr = upperStr.replaceAll(qKey, "").trim()
      break;
    }
  }

  // 查找年份
  const yearMatch = upperStr.match(/\d{4}/);
  if (yearMatch) {
    foundYear = yearMatch[0];
  }

  // 季度+年份
  if (foundYear && foundQuarter) {
    return `${foundYear}-${quarterMap[foundQuarter]}`;
  }
  
  // 有且仅有年份
  const yearGroups = upperStr.match(/\d+/g)
  if (foundYear && yearGroups.length === 1 && yearGroups[0].length === 4) {
    return `${yearGroups[0]}-12-31`;
  }
  
  // 没有找到年份和季度，尝试解析为标准日期
  const date = new Date(inputStr);
  if (!isNaN(date.getTime())) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  
  // 其他情况，返回三年后
  const now = new Date();
  const futureYear = now.getFullYear() + 3;
  return `${futureYear}-01-01`;
}
