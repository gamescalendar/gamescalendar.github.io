const https = require('https');
const fs = require('fs');

const fetch = require('node-fetch');
const {HttpsProxyAgent} = require('https-proxy-agent');

function fetch_data(appid) {

    https.get({
        host: "127.0.0.1",
        port: 1080,
        path: `https://store.steampowered.com/api/appdetails?appids=${appid}`,
    }, res => {
        let data = [];
        const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';
        console.log('Status Code:', res.statusCode);
        console.log('Date in Response header:', headerDate);

        res.on('data', chunk => {
            data.push(chunk);
        });

        res.on('end', () => {
            console.log('Response ended: ');
            const app_data = JSON.parse(Buffer.concat(data).toString());

            console.log(app_data)
        });
    }).on('error', err => {
        console.log('Error: ', err.message);
    });
}

// fetch_data(1086940)

const isCI = process.env.CI_ENV == "ci"
const proxy = process.env.HTTP_PROXY || 'http://127.0.0.1:1080'

async function getAppDataFromAPI(appid) {
    let response;
    if (isCI) {
        console.log(`Fetching API for ${appid}`)
        response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}`);
    } else {
        const proxyAgent = new HttpsProxyAgent(proxy);
        response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}`, {agent: proxyAgent});
    }
    const body = await response.text();
    // console.log(body);
    return JSON.parse(body);
}

function getCalendarData(data) {
    let date = data.release_date.date ?? data.release_date
    let releaseDate = (new Date(date + " GMT"))
    let isTBA = releaseDate.toString() === "Invalid Date"
    let start = date
    if (!isTBA) {
        start = releaseDate.toISOString().slice(0, 10)
    }

    return {
        meta: data.meta,
        type: "Game",
        title: data.name,
        isTBA: isTBA,
        start: start,
        app_data: {
            platform: "Steam",
            appid: data.steam_appid,
            title: data.name,
            description: data.short_description,
            tags: data.genres.map(x => x.description),
            release_date: data.release_date,
            language: {
                zh: {
                    gui: data.supported_languages.includes("简体中文") || data.supported_languages.includes("Chinese"),
                    audio: data.supported_languages.includes("简体中文<strong>*</strong>") || data.supported_languages.includes("Chinese<strong>*</strong>"),
                    subtitle: data.supported_languages.includes("简体中文") || data.supported_languages.includes("Chinese"),
                }
            },
            owned: false,
            developers: data.developers,
            publishers: data.publishers,
            categories: data.categories,
            genres: data.genres,
        }
    }
}

function transformAPIDataToCalendarData(apiData) {
    // apiData = { "appid" = {} }
    let result = []

    let keys = Object.keys(apiData)
    for (const key of keys) {
        // console.log(x[key])
        let data = apiData[key].data
        if (!data) {
            continue
        }
        let app_data = getCalendarData(data)
        result.push(app_data)
    }
    return result
}

function getSteamAppid(originalTarget) {
    let target = originalTarget
    let appid = parseFloat(target)
    if (typeof appid == "number" && !isNaN(appid)) {
        return appid;
    }
    if (typeof target != "string") return null;

    target = target.trim()
    target = target.replace("http://", "")
    target = target.replace("https://", "")
    target = target.replace("store.steampowered.com/", "")
    target = target.replace("steamcommunity.com/", "")
    if (target.startsWith("app/")) {
        target = target.replace("app/", "")
        let elements = target.split("/")
        if (elements.length >= 1) {
            console.log(`take ${elements[0]} as appid from ${originalTarget}`)
            let appid = parseFloat(elements[0])
            if (appid && !isNaN(appid)) {
                return appid
            }
        }
    }

    console.log(`${target} is not a valid steam appid or URL`)
    return null
}

function getTrackedEvents() {
    let tracked = {
        index: 0,
        data: {}
    }

    let data = fs.readFileSync('events.json', 'utf8');
    // console.log(`read tracked events ${data}`)

    let obj = JSON.parse(data);
    if (obj.index && typeof (obj.index) == 'number' && obj.index > tracked.index) {
        tracked.index = obj.index;
    }
    if (obj.data && typeof (obj.data) == "object") {
        tracked.data = obj.data;
    }

    let maxIndex = Math.max(...(Object.values(obj.data).filter(x => (typeof x.meta.index) == "number").map(x => x.meta.index)))
    if (tracked.index <= maxIndex) {
        console.log(`wrong tracked log, fix index from ${tracked.index} to ${maxIndex + 1}`)
        tracked.index = maxIndex + 1
    }
    // console.log(`read tracked log ${JSON.stringify(tracked)}`)
    return tracked
}

function doWrite(events) {
    // backup file
    let nowFilename = (new Date().toISOString()).replaceAll("-", "_").replaceAll(":", "__")
    let backupFilename = `events_${nowFilename}.json`
    console.log(`backup previous data to ${backupFilename}`)
    fs.renameSync("events.json", backupFilename)

    // write new file
    let eventsJSON = JSON.stringify(events, null, 4);
    console.log("writing to events.json");
    fs.writeFileSync('events.json', eventsJSON, 'utf8');
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

function getNeedRefreshTargets(newTargets, tracked) {
    let today = (new Date()).toISOString().slice(0, 10)
    let needRefreshTargets = []
    newTargets.forEach(target => {
        if (!tracked[target]) {
            console.log(`${target} not tracked yet, add to refresh list`)
            needRefreshTargets.push({
                target,
                outdated_days: 9999,
            })
        }
    });
    Object.keys(tracked).forEach(target => {
        let obj = tracked[target]
        if (!obj.meta) {
            console.log(`${target} tracked but no metadata, add to refresh list`)
            needRefreshTargets.push({
                target,
                outdated_days: 9999,
            })
            return
        }
        let lastTrackDate = obj.meta?.last_track_date
        if (!lastTrackDate) {
            console.log(`${obj.meta} tracked but no last_track_date, add to refresh list`)
            needRefreshTargets.push({
                target,
                outdated_days: 9999,
            })
            return
        }

        let difference = (new Date(today)).getTime() - (new Date(lastTrackDate)).getTime()
        if (difference > 0) {
            let days = difference / (1000 * 3600 * 24);
            console.log(`${obj.meta} outdated for ${days} days, add to refresh list`)
            needRefreshTargets.push({
                target,
                outdated_days: days,
            })
            return
        }
        console.log(`skip ${target} because last tracked date is today: ${today}`)
    })

    const MAX_COUNT_PER_DAY = 10

    return needRefreshTargets.sort((a, b) => {
        return b.outdated_days - a.outdated_days
    }).slice(0, MAX_COUNT_PER_DAY).map(x => x.target)
}

async function main(newTargets) {
    newTargets = newTargets.map(getSteamAppid).filter(x => x && !isNaN(x))

    let trackedEvents = getTrackedEvents();

    let needRefreshTargets = getNeedRefreshTargets(newTargets, trackedEvents.data)

    let changed = needRefreshTargets.length > 0

    if (changed) {
        console.log(`filtered need to refresh targets: ${needRefreshTargets}`)

        let today = (new Date()).toISOString().slice(0, 10)
        for (let target of needRefreshTargets) {
            let apiData = await getAppDataFromAPI(target);
            let calendarData = transformAPIDataToCalendarData(apiData);
            calendarData.forEach(x => {
                x.meta = {
                    index: trackedEvents.index,
                    platform: "Steam",
                    identifier: target,
                    last_track_date: today,
                };

                trackedEvents.data[target] = x;
                trackedEvents.index += 1;
            })
        }

        doWrite(trackedEvents)
    }

    cleanupBackups()
}

(async () => {
    let list = fs.readFileSync("list.txt", "utf-8").split("\n").map(x => x.trim())
    console.log(`Read target list: ${list}`)
    await main(list)
})();
