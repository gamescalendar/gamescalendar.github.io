const fs = require('fs');

const { parseFile } = require('./src/parser')
const { cnDateStrToDateStr } = require('./src/utils')

const {
    getAppDataFromAPI,
    getCalendarData,
} = require("./src/steam")

const {
    getMetacriticInfo,
} = require("./src/metacritic")

const MAX_COUNT_PER_RUN = 20
const MORE_UNTRACKED_PER_RUN = 40

function getTrackedEvents(filename) {
    let data = "{}"

    if (fs.existsSync(filename)) {
        data = fs.readFileSync(filename, 'utf8');
    }

    let tracked = JSON.parse(data);
    if (tracked.index === undefined) {
        tracked.index = 0
    }
    if (!tracked.data) {
        tracked.data = {}
    }
    if (!tracked.metacritic) {
        tracked.metacritic = {}
    }

    return tracked
}

function doPatch(events) {
    let data = fs.readFileSync('override.json', 'utf8');
    let override = JSON.parse(data);

    Object.keys(override).forEach(key => {
        let obj = override[key]
        if (events.data[key]) {
            // we should only patch specific fields
            console.log(`Patching ${key}`)
            if (obj.start) {
                console.log(`Patching ${key}.start from ${events.data[key].start} to ${obj.start}`)
                events.data[key].start = obj.start
            }
            if (obj.app_data.owned !== events.data[key].app_data.owned) {
                console.log(`Patching ${key}.app_data.owned from ${events.data[key].app_data.owned} to ${obj.app_data.owned}`)
                events.data[key].app_data.owned = obj.app_data.owned
            }
        } else {
            console.log(`Patch for ${key} isn't tracked yet`)
        }
    })
}

function testQNMonth(str) {
    str = str.toUpperCase()
    switch (str) {
        case "Q1":
            return 0+2
        case "Q2":
            return 3+2
        case "Q3":
            return 6+2
        case "Q4":
            return 9+2
    }
    return -1
}

function testQNDate(str) {
    str = str.toUpperCase()
    switch (str) {
        case "Q1":
            return 31
        case "Q2":
            return 30
        case "Q3":
            return 30
        case "Q4":
            return 31
    }
    return -1
}

function QYearToDate(date) {
    let arr = date.trim().split(" ").map(x => x.trim()).filter(x => x != "")

    if (arr.length != 2) {
        return "Invalid Date"
    }
    // Q1 2024
    let qMonth1 = testQNMonth(arr[0])
    // 2024 Q1
    let qMonth2 = testQNMonth(arr[1])
    if (qMonth1 == -1 && qMonth2 == -1) {
        return "Invalid Date"
    }

    let d = new Date()
    if (qMonth1 != -1) {
        let year = yearStrToNumber(arr[1])
        if (year == -1) {
            return "Invalid Date"
        }
        d.setFullYear(year)
        d.setMonth(qMonth1, testQNDate(arr[0]))
    }
    if (qMonth2 != -1) {
        let year = yearStrToNumber(arr[0])
        if (year == -1) {
            return "Invalid Date"
        }
        d.setFullYear(year)
        d.setMonth(qMonth2, testQNDate(arr[1]))
    }
    return d
}

function sanitizeEvents(events) {
    let changed = false

    // sanity coming soon games
    let next3Year = new Date()
    next3Year.setFullYear(next3Year.getFullYear() + 3)
    next3Year.setMonth(0, 1)
    next3Year = next3Year.toISOString().slice(0, 10)

    console.log("sanitizing...")
    Object.keys(events.data).forEach(key => {
        let event = events.data[key]
        event.start = cnDateStrToDateStr(event.start)
        let old_start = new Date(event.start)
        if (old_start.toString() === "Invalid Date") {
            let qYear = QYearToDate(event.start)
            if (qYear != "Invalid Date") {
                events.data[key].start = qYear.toISOString().slice(0, 10)
                return
            }

            let releaseDate = event.app_data?.release_date
            if (releaseDate && releaseDate.coming_soon) {
                let date = cnDateStrToDateStr(event.app_data.release_date.date)
                let dateStr = new Date(date).toString()
                if (dateStr === "Invalid Date" && event.start != next3Year) { // some games have release_date but coming_soon is true
                    console.log("sanitize " + event.title + " (" + key + ") to " + next3Year)
                    events.data[key].start = next3Year
                    changed = true
                } else {
                    events.data[key].start = new Date(date).toISOString().slice(0, 10)
                    console.log("sanitize " + event.title + " (" + key + ") to " + events.data[key].start)
                }
            }
        } else {
            let start_str = old_start.toISOString().slice(0, 10)
            if (event.start != start_str) {
                events.data[key].start = start_str
            }
            
            let releaseDate = event.app_data?.release_date
            // some games have release_date but coming_soon is true
            if (releaseDate && releaseDate.date && releaseDate.coming_soon) {
                let date = cnDateStrToDateStr(releaseDate.date)
                let comingDate = new Date(date)
                let dateStr = comingDate.toString()
                let isFuture = new Date().getTime() < comingDate.getTime()
                if (dateStr !== "Invalid Date" && isFuture) { 
                    // changed = true
                    let old = event.start
                    let newStr = comingDate.toISOString().slice(0, 10)
                    if (old != newStr) {
                        events.data[key].start = newStr
                        console.log(`${start_str} (${old}) -> ${events.data[key].start} (${date}): ${event.title} (${key})`)
                    }
                }
            }
        }
    })
    console.log("sanitized")

    return changed
}

function doWrite(events, filename) {
    // backup file
    // let nowFilename = (new Date().toISOString()).replaceAll("-", "_").replaceAll(":", "__")
    // let backupFilename = `events_${nowFilename}.json`
    // console.log(`backup previous data to ${backupFilename}`)
    // fs.renameSync("events.json", backupFilename)

    // write new file
    let eventsJSON = JSON.stringify(events, null, 4);
    console.log(`writing to ${filename}`);
    fs.writeFileSync(filename, eventsJSON, 'utf8');
}

function cleanupBackups() {
    // remove outdated backups
    let filenames = fs.readdirSync(".");
    let backups = filenames.filter(x => x.startsWith("events_") && x.endsWith(".json"));
    if (backups.length > 3) {
        let outdatedBackups = backups.map(x => {
            let dateStr = x.replaceAll("events_", "").replaceAll(".json", "").replaceAll("__", ":").replaceAll("_", "-")
            return {
                name: x,
                date: new Date(dateStr)
            }
        }).sort((a, b) => {
            return a.date - b.date;
        }).slice(0, backups.length - 3).map(x => x.name);
        console.log(`outdated backups ${JSON.stringify(outdatedBackups)}, delete`)
        outdatedBackups.forEach(x => {
            fs.rmSync(x, {
                force: true,
            });
        })
    }
}

function getTrackedName(tracked, target) {
    if (tracked[target]) {
        return `${tracked[target].title} (${target})`
    } else {
        return target
    }
}

function getNeedRefreshTargets(newTargets, tracked) {
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
            // console.log(`${getTrackedName(tracked, target)} not tracked yet, add to refresh list`)
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
            console.log(`${getTrackedName(tracked, target)} tracked but no metadata, add to refresh list`)
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
            })
            return
        }

        if ((obj.app_data.metaScore && !obj.app_data.metaReviewsCount) || (obj.app_data.userScore && !obj.app_data.userReviewsCount)) {
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
            if (obj.app_data.release_date && obj.app_data.release_date.date) {
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

    let maxCount = MAX_COUNT_PER_RUN + additionalCount + recentCount

    console.log(`Total ${maxCount}, ${additionalCount} additional updates due to untracked, ${recentCount} additional updates due to recent`)

    let limited = needRefreshTargets.sort((a, b) => {
        return b.outdated_days - a.outdated_days
    }).slice(0, maxCount)

    limited.forEach(x=>{
        if (x.recentGamePriority) {
            console.log(`Recent ${tracked[x.target].start}: ${getTrackedName(tracked, x.target)}`)
        }
        if (x.tbaPriority) {
            console.log(`${x.outdated_days} days ago [TBA]: ${getTrackedName(tracked, x.target)}`)
        }
        if (x.isUntracked) {
            console.log(`Untracked: ${getTrackedName(tracked, x.target)}`)
        }
        if (!x.recentGamePriority && !x.tbaPriority && !x.isUntracked) {
            console.log(`${x.outdated_days} days ago: ${getTrackedName(tracked, x.target)}`)
        }
    })

    return limited.map(x => x.target)
}

async function updateSteamTargets(trackedEvents, newTargets, deletedEvents) {
    let needRefreshTargets = getNeedRefreshTargets(newTargets, trackedEvents.data)

    console.log(`need to refresh targets: ${needRefreshTargets.map(x => `${x}(${trackedEvents.data[x]?.title || "untracked yet"})`)}`)
    needRefreshTargets = needRefreshTargets.map(x => parseFloat(x)).filter(x => !isNaN(x))
    console.log(`filtered need to refresh targets: ${needRefreshTargets}`)

    let changed = needRefreshTargets.length > 0

    if (changed) {
        let today = (new Date()).toISOString().slice(0, 10)
        for (let target of needRefreshTargets) {
            let apiData = await getAppDataFromAPI(target);
            if (apiData == null) {
                console.log(`no response of target ${target}`)
                let trackedData = trackedEvents.data[target]
                if (trackedData) {
                    let lastTrackDate = trackedEvents.data[target].meta?.last_track_date
                    if (lastTrackDate) {
                        let today = (new Date()).toISOString().slice(0, 10);
                        let difference = (new Date(today)).getTime() - (new Date(lastTrackDate)).getTime();
                        let days = difference / (1000 * 3600 * 24);
                        if (days >= 100) {
                            console.log(`no response and outdated for ${days} days, deleted.`)
                            deletedEvents.data[target] = trackedEvents.data[target]
                            delete(trackedEvents.data[target])
                        }
                    }
                }
                continue
            }
            let calendarData = getCalendarData(apiData);

            if (trackedEvents.data[target] && trackedEvents.data[target].meta) {
                calendarData.meta = trackedEvents.data[target].meta
            }
            if (!calendarData.meta) {
                calendarData.meta = {
                    index: trackedEvents.index,
                    platform: "Steam",
                    identifier: target,
                    last_track_date: today,
                };
                trackedEvents.index += 1;
            } else {
                calendarData.meta.last_track_date = today
            }

            trackedEvents.data[target] = calendarData;
        }

        doPatch(trackedEvents)
    }

    return changed
}

const MetacriticURL = "https://www.metacritic.com/game/"

async function updateMetacriticTargets(trackedEvents, newTargets) {
    console.log(`Updating metacritic urls`)

    let today = (new Date()).toISOString().slice(0, 10)

    if (!trackedEvents.metacritic) {
        trackedEvents.metacritic = {}
    }

    console.log(`Metacritic urls: ${newTargets.join("\n")}`)
    let mcGames = {}
    newTargets.forEach(target => {
        let url = target;
        let arr = target.replace(MetacriticURL, "").split("/").filter(x => x !== "");
        console.log(arr)
        if (arr.length === 1) {
            mcGames[arr[0]] = {
                url: url,
                game: arr[0],
            }
            return
        }
    })

    let changed = false

    let targets = getNeedRefreshTargets(Object.keys(mcGames), trackedEvents.metacritic)
    if (targets <= 0) {
        return
    }

    console.log(`need to refresh targets: ${targets}`)

    for (const game of targets) {
        let app_info = await getMetacriticInfo(game)
        if (!app_info) {
            console.log(`failed to get metacritic info of ${game}`)
            continue
        }
        changed = true

        let platform = app_info.app_data.platform
        app_info.meta = trackedEvents.metacritic[game]?.meta

        trackedEvents.metacritic[game] = app_info

        if (trackedEvents.metacritic[game].meta) {
            trackedEvents.metacritic[game].meta.last_track_date = today
        } else {
            console.log("index +1")
            trackedEvents.metacritic[game].meta = {
                index: trackedEvents.index,
                platform: platform,
                identifier: `https://www.metacritic.com/game/${game}`,
                last_track_date: today,
            }
            trackedEvents.index += 1
        }
    }

    return changed
}

async function main(database, outputEvents, outputDeleted) {
    let trackedEvents = getTrackedEvents(outputEvents);
    let deletedEvents = getTrackedEvents(outputDeleted);

    let changed = await updateSteamTargets(trackedEvents, database.steam, deletedEvents)
    changed = await updateMetacriticTargets(trackedEvents, database.metacritic) || changed

    changed = sanitizeEvents(trackedEvents) || changed

    if (changed) {
        doWrite(trackedEvents, outputEvents)
        doWrite(deletedEvents, outputDeleted)
    }

    // cleanupBackups()
}

(async () => {
    let file = process.argv[2]
    let outputEvents = process.argv[3]
    let outputDeleted = process.argv[4]
    await main(parseFile(file), outputEvents, outputDeleted)
})();
