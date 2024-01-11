const https = require('https');
const fs = require('fs');

const fetch = require('node-fetch');
const {HttpsProxyAgent} = require('https-proxy-agent');
const cheerio = require('cheerio');

const MAX_COUNT_PER_RUN = 20

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

async function makeRequest(url) {
    console.log(`Requesting ${url}`)
    let response;

    let opts = {
        headers: {
            cookie: "wants_mature_content=1; birthtime=786211201; lastagecheckage=1-0-1995;"
            // cookie: "wants_mature_content=1; sessionid=a8cb216f0ce30895a5872d0e; birthtime=186595201; lastagecheckage=1-0-1976"
        }
    };

    try {
        if (isCI) {
            response = await fetch(url, opts);
        } else {
            console.log(`using proxy ${proxy}`)
            opts.agent = new HttpsProxyAgent(proxy);
            response = await fetch(url, opts);
        }
        return await response.text();
    } catch (e) {
        console.log(`failed to fetch ${url}, error: ${e}`)
        return null
    }
}

function clearURL(url) {
    let u = new URL(url)
    u.search = ""
    return u.toString()
}

async function getAppDataFromStorePage(appid) {
    let page = `https://store.steampowered.com/app/${appid}?l=schinese`
    console.log(`Fetching Store page for ${appid} from ${page}`)

    const body = await makeRequest(page);
    if (!body) {
        console.log(`Failed to fetch store page for ${appid} from ${page}`)
        return null
    }

    let data = {}

    let $ = cheerio.load(body);
    let userReview = $("#userReviews")
    // let userReview = Array.from(("#userReviews").children())
    // let recentReview = userReview.filter(x=> {
    //     let element = $(x)
    //     return element.is("div") && element.find(".subtitle.column").text().includes("最近评测")
    // })
    let recentReview = $(userReview.find(".subtitle.column:not(.all)").parent())
    if (recentReview.length > 0) {
        let recentSummary = recentReview.find(".game_review_summary")
        if (recentSummary.length > 0) {
            data.recentReview = {
                summary: recentSummary.text(),
                cssClass: recentSummary.attr("class").replace("game_review_summary", "").trim(),
                count: recentReview.find(".summary").find(".responsive_hidden").text().trim(),
                tooltip: recentReview.attr("data-tooltip-html"),
            }
        }
    }

    let totalReview = $(userReview.find(".subtitle.column.all").parent())
    if (totalReview.length > 0) {
        let totalSummary = totalReview.find(".game_review_summary")
        if (totalSummary.length > 0) {
            data.totalReview = {
                summary: totalSummary.text(),
                cssClass: totalSummary.attr("class").replace("game_review_summary", "").trim(),
                count: totalReview.find(".summary").find(".responsive_hidden").text().trim(),
                tooltip: totalReview.attr("data-tooltip-html"),
            }
        }
    }

    data.tags = Array.from($(".glance_tags.popular_tags").children()).map(x => $(x)).filter(x => {
        return x.is("a")
        // && element.css("display") !== "none" // 页面中最开始全部都是 display: none
    }).map(x => {
        return {
            link: clearURL(x.attr("href")),
            name: x.text().trim(),
        }
    })

    return data
}

async function getAppDataFromAPI(appid) {
    let api = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`
    console.log(`Fetching API for ${appid} from ${api}`)

    // https://store.steampowered.com/apphoverpublic/1086940/?l=english&json=1 can get review stats
    // but still cannot get user-defined tags

    const body = await makeRequest(api);
    if (!body) {
        console.log(`Failed to fetch store API for ${appid} from ${api}`)
        return null
    }
    // console.log(body);
    let data = JSON.parse(body);
    if (!data[appid] || !data[appid].data) {
        console.log(`API data for ${appid} error`)
        return null
    }

    data = data[appid].data
    const pageData = await getAppDataFromStorePage(appid)
    if (pageData != null) {
        data.tags = pageData.tags
        data.recentReview = pageData.recentReview
        data.totalReview = pageData.totalReview
    }

    return data
}

function getCalendarData(data) {
    let date = data.release_date.date ?? data.release_date
    let isTBA = data.release_date.coming_soon && !data.release_date.date

    let start = date
    if (!isTBA) {
        let year = yearStrToNumber(date) // 2024
        if (year !== -1) {
            let d = new Date()
            d.setFullYear(year)
            d.setMonth(11, 31)
            start = d.toISOString().slice(0, 10)
        } else {
            let releaseDate = (new Date(date + " GMT"))

            isTBA = releaseDate.toString() === "Invalid Date"
            if (!isTBA) {
                start = releaseDate.toISOString().slice(0, 10)
            }
        }
    }

    return {
        meta: data.meta,
        type: "Game",
        title: data.name,
        start: start,
        app_data: {
            platform: "Steam",
            appid: data.steam_appid,
            title: data.name,
            description: data.short_description,
            // tags: data.genres.map(x => x.description),
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
            tags: data.tags,
            recentReview: data.recentReview,
            totalReview: data.totalReview,
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

const steamAppIdMap = {}

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
            steamAppIdMap[elements[0]] = originalTarget
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
    let data = fs.readFileSync('events.json', 'utf8');
    // console.log(`read tracked events ${data}`)

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

    // let maxIndex = Math.max(...(Object.values(tracked.data).filter(x => (typeof x.meta?.index) == "number").map(x => x.meta.index)))
    // if (tracked.index <= maxIndex) {
    //     console.log(`wrong tracked log, fix index from ${tracked.index} to ${maxIndex + 1}`)
    //     tracked.index = maxIndex + 1
    // }
    // console.log(`read tracked log ${JSON.stringify(tracked)}`)
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

function yearStrToNumber(str) {
    let n = parseFloat(str)
    if (isNaN(str) || isNaN(n)) {
        return -1
    }
    return n
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
        let old_start = new Date(event.start)
        if (old_start.toString() === "Invalid Date") {
            let qYear = QYearToDate(event.start)
            if (qYear != "Invalid Date") {
                events.data[key].start = qYear.toISOString().slice(0, 10)
                return
            }

            if (event.app_data && event.app_data.release_date && event.app_data.release_date.coming_soon) {
                if (event.start != next3Year) {
                    console.log("sanitize " + event.title + " (" + key + ") to " + next3Year)
                    events.data[key].start = next3Year
                    changed = true
                }
            }
        } else {
            let start_str = old_start.toISOString().slice(0, 10)
            if (event.start != start_str) {
                events.data[key].start = start_str
            }
        }
    })
    console.log("sanitized")

    return changed
}

function doWrite(events) {
    // backup file
    // let nowFilename = (new Date().toISOString()).replaceAll("-", "_").replaceAll(":", "__")
    // let backupFilename = `events_${nowFilename}.json`
    // console.log(`backup previous data to ${backupFilename}`)
    // fs.renameSync("events.json", backupFilename)

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
    if (!tracked) {
        return newTargets
    }

    let today = (new Date()).toISOString().slice(0, 10)
    let needRefreshTargets = []
    newTargets.forEach(target => {
        if (!tracked[target]) {
            console.log(`${target} not tracked yet, add to refresh list`)
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
            })
        }
    });
    Object.keys(tracked).forEach(target => {
        let obj = tracked[target]
        if (!obj.meta) {
            console.log(`${target} tracked but no metadata, add to refresh list`)
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
            })
            return
        }

        if ((obj.app_data.metaScore && !obj.app_data.metaReviewsCount) || (obj.app_data.userScore && !obj.app_data.userReviewsCount)) {
            console.log(`${target} tracked but reviews score and count mismatched`)
            needRefreshTargets.push({
                target: target,
                outdated_days: 9999,
            })
            return
        }

        let lastTrackDate = obj.meta?.last_track_date
        if (!lastTrackDate) {
            console.log(`${target} tracked but no last_track_date, add to refresh list`)
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
            let released = ((new Date(today)).getTime() - (new Date(releaseDate)).getTime())
            recentGamePriority = released > 0 && ((released / (1000 * 3600 * 24)) < 14) && needRefresh
            if (released < 0 && ((released / (1000 * 3600 * 24)) < -365)) {
                tbaPriority = true
            }
        }

        if (needRefresh) {
            let days = difference / (1000 * 3600 * 24);
            if (recentGamePriority) {
                days = 19999
            }
            if (tbaPriority) {
                days += 7
            }
            console.log(`${target} outdated for ${days} days, add to refresh list (${steamAppIdMap[target]}) `)
            needRefreshTargets.push({
                target: target,
                outdated_days: days,
            })
            return
        }
        console.log(`skip ${target} because last tracked date is today: ${today}`)
    })

    return needRefreshTargets.sort((a, b) => {
        return b.outdated_days - a.outdated_days
    }).slice(0, MAX_COUNT_PER_RUN).map(x => x.target)
}

async function updateSteamTargets(trackedEvents, newTargets) {
    newTargets = newTargets.map(getSteamAppid).filter(x => x && !isNaN(x))

    let needRefreshTargets = getNeedRefreshTargets(newTargets, trackedEvents.data)

    console.log(`need to refresh targets: ${needRefreshTargets}`)
    needRefreshTargets = needRefreshTargets.map(x => parseFloat(x)).filter(x => !isNaN(x))
    console.log(`filtered need to refresh targets: ${needRefreshTargets}`)

    let changed = needRefreshTargets.length > 0

    if (changed) {
        let today = (new Date()).toISOString().slice(0, 10)
        for (let target of needRefreshTargets) {
            let apiData = await getAppDataFromAPI(target);
            if (apiData == null) {
                console.log(`no response of target ${target}`)
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

function toNumberOrUndefined(str) {
    let num = parseFloat(str)
    if (isNaN(num)) {
        return undefined
    }
    return num
}

async function getMetacriticInfo(game, platformOverride) {
    // === Scores ===
    // Main page no longer provides full game description and cover image
    let url = `https://www.metacritic.com/game/${game}`
    console.log(`Fetching Metacritic for ${game} from ${url}`)
    let body = await makeRequest(url) // details 页面有 table，不好解析
    if (!body) {
        console.log(`Failed to fetch metacritic page for ${game} from ${url}`)
        return null
    }

    let $ = cheerio.load(body)

    let metaScore = $(".c-productScoreInfo_scoreContent:nth(0) .c-siteReviewScore").text().trim()
    let metaReviewsCount = $(".c-productScoreInfo_scoreContent:nth(0) .c-productScoreInfo_reviewsTotal")?.text().trim()
    if (metaReviewsCount) {
        metaReviewsCount = metaReviewsCount.toLowerCase()
            .replace("based on", "")
            .replace("critic reviews", "").trim().replace(",", "")
    }
    let userScore = $(".c-productScoreInfo_scoreContent:nth(1) .c-siteReviewScore").text().trim()
    let userReviewsCount = $(".c-productScoreInfo_scoreContent:nth(1) .c-productScoreInfo_reviewsTotal")?.text().trim()
    if (userReviewsCount) {
        userReviewsCount = userReviewsCount.toLowerCase()
            .replace("based on", "")
            .replace("user ratings", "").trim().replace(",", "")
    }

    // === Details ===
    // Main page no longer provides full game description and cover image
    let detailsUrl = `https://www.metacritic.com/game/${game}/details/`
    console.log(`Fetching Metacritic Details for ${game} from ${detailsUrl}`)
    let detailsBody = await makeRequest(detailsUrl) // details 页面有 table，不好解析
    if (!detailsBody) {
        console.log(`Failed to fetch metacritic page for ${game} from ${detailsUrl}`)
        return null
    }

    $ = cheerio.load(detailsBody)

    // title
    let title = $(".c-productSubpageHeader_back").text().trim()

    // date
    let startStr = $(".c-gameDetails_ReleaseDate span.g-outer-spacing-left-medium-fluid").text().trim()
    let releaseDate = (new Date(startStr + " GMT"))

    let start = ""
    let isTBA = releaseDate.toString() === "Invalid Date"
    if (!isTBA) {
        start = releaseDate.toISOString().slice(0, 10)
    }

    // cover
    let img = $(".c-productSubpageHeader_image img")
    let imageURL = img.attr("src")
    let imageAlt = img.attr("alt")

    // summary
    const prefix = "Description:"
    let summary = $(".c-pageProductDetails_description").text().trim()
    if (summary.startsWith(prefix)) {
        summary = summary.slice(prefix.length).trim()
    }

    // platforms
    let platforms = Array.from($(".c-gameDetails_Platforms li")).map(x => {
        let $x = $(x)
        return {
            name: $x.text().trim(),
            url: "",
        }
    })

    // publishers
    let publishers = []

    let pubName = $(".c-gameDetails_Distributor span.g-outer-spacing-left-medium-fluid").text().trim()
    if (pubName === "") {
        publishers = Array.from($(".c-gameDetails_Distributor li")).map(x => {
            let $x = $(x)
            return {
                name: $x.text().trim(),
                url: "",
            }
        })
    } else {
        publishers.push({
            name: pubName,
            url: "",
        })
    }

    // devs
    let developers = []

    let devName = $(".c-gameDetails_Developer span.g-outer-spacing-left-medium-fluid").text().trim()
    if (devName === "") {
        developers = Array.from($(".c-gameDetails_Developer li")).map(x => {
            let $x = $(x)
            return {
                name: $x.text().trim(),
                url: "",
            }
        })
    } else {
        developers.push({
            name: devName,
            url: "",
        })
    }

    // genres
    let genres = Array.from($(".c-genreList a")).map(x => {
        let $x = $(x)
        return {
            name: $x.text().trim(),
            url: $x.attr("href"),
        }
    })

    let platform = platformOverride
    if (!platform) {
        platform = platforms.length > 0 ? platforms[0].name : "unknown"
    }

    return {
        type: "Game",
        title: title, // done
        start: start, // done
        app_data: {
            imageURL: imageURL, // done
            imageAlt: imageAlt, // done

            platform: platform,
            name: game,
            title: title, // done
            platformString: platforms, // done
            releaseDate: startStr, // done

            summary: summary, // done
            publisher: publishers, // done
            developer: developers, // done
            genres: genres, // done

            metaScore: toNumberOrUndefined(metaScore),
            metaReviewsCount: toNumberOrUndefined(metaReviewsCount),
            userScore: toNumberOrUndefined(userScore),
            userReviewsCount: toNumberOrUndefined(userReviewsCount),
        },
    }
}

async function updateMetacriticTargets(trackedEvents, newTargets) {
    console.log(`Updating metacritic urls`)

    let today = (new Date()).toISOString().slice(0, 10)

    if (!trackedEvents.metacritic) {
        trackedEvents.metacritic = {}
    }

    newTargets = newTargets.map(x => x.toLowerCase()).filter(x => x && x.startsWith(MetacriticURL))
    console.log(`New metacritic urls: ${newTargets.join("\n")}`)
    let platforms = {}
    let newVersionGames = {}
    newTargets.forEach(target => {
        let url = target;
        let arr = target.replace(MetacriticURL, "").split("/").filter(x => x !== "");
        console.log(arr)
        if (arr.length === 1) {
            newVersionGames[arr[0]] = {
                url: url,
                game: arr[0],
            }
            return
        }
        if (arr.length < 2) {
            return
        }
        let platform = arr[0]
        let game = arr[1]

        if (!platforms[platform]) {
            platforms[platform] = {}
        }
        platforms[platform][game] = {
            url: url,
            platform: platform,
            game: game,
        }
    })

    let changed = false
    for (const platform of Object.keys(platforms)) {
        let gamesData = platforms[platform]
        let games = Object.keys(gamesData)
        let targets = getNeedRefreshTargets(games, trackedEvents.metacritic[platform])
        if (targets <= 0) {
            continue;
        }

        changed = true

        for (let game of targets) {
            if (!trackedEvents.metacritic[platform]) {
                trackedEvents.metacritic[platform] = {}
            }

            let app_info = await getMetacriticInfo(game, platform)
            if (!app_info) {
                console.log(`failed to get metacritic info of ${game} at ${platform}`)
                continue
            }
            app_info.meta = trackedEvents.metacritic[platform][game]?.meta

            trackedEvents.metacritic[platform][game] = app_info

            if (trackedEvents.metacritic[platform][game].meta) {
                trackedEvents.metacritic[platform][game].meta.last_track_date = today
            } else {
                console.log("index +1")
                trackedEvents.metacritic[platform][game].meta = {
                    index: trackedEvents.index,
                    platform: platform,
                    identifier: `https://www.metacritic.com/game/${game}`,
                    last_track_date: today,
                }
                trackedEvents.index += 1
            }

        }
    }

    for (const game of Object.keys(newVersionGames)) {
        let app_info = await getMetacriticInfo(game)
        if (!app_info) {
            console.log(`failed to get metacritic info of ${game}`)
            continue
        }
        changed = true

        let platform = app_info.app_data.platform
        if (!trackedEvents.metacritic[platform]) {
            trackedEvents.metacritic[platform] = {}
        }
        app_info.meta = trackedEvents.metacritic[platform][game]?.meta

        trackedEvents.metacritic[platform][game] = app_info

        if (trackedEvents.metacritic[platform][game].meta) {
            trackedEvents.metacritic[platform][game].meta.last_track_date = today
        } else {
            console.log("index +1")
            trackedEvents.metacritic[platform][game].meta = {
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

async function main(newTargets) {
    let trackedEvents = getTrackedEvents();

    let changed = await updateSteamTargets(trackedEvents, newTargets)
    changed = await updateMetacriticTargets(trackedEvents, newTargets) || changed

    changed = sanitizeEvents(trackedEvents) || changed

    if (changed) {
        doWrite(trackedEvents)
    }

    // cleanupBackups()
}

function getTargets(file) {
    let list = fs.readFileSync(file, "utf-8").split("\n")
        .map(x => x.trim())
        .filter(x => x.length > 0 && !x.startsWith("//"))
    console.log(`Read target list: ${list.join("\n")}`)

    return list
}

(async () => {
    let file = process.argv[2]
    await main(getTargets(file))
})();
