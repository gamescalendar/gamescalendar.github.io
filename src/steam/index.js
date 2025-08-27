import cheerio from 'cheerio';
import { makeRequest, yearStrToNumber, cnDateStrToDateStr, ResolveDateFromString } from '../utils.js';
import config from '../../config.js';

function clearURL(url) {
    let u = new URL(url)
    u.search = ""
    return u.toString()
}

async function getAppDataFromStorePage(appid) {
    let page = `https://store.steampowered.com/app/${appid}?l=${config.languageOption}`
    console.log(`Fetching Store page for ${appid} from ${page}`)

    const body = await makeRequest(page, {
        headers: {
            cookie: "wants_mature_content=1; birthtime=786211201; lastagecheckage=1-0-1995;"
        }
    });
    if (!body) {
        console.log(`Failed to fetch store page for ${appid} from ${page}`)
        return null
    }

    let data = {}

    let $ = cheerio.load(body);
    let userReview = $("#userReviews")
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
    }).map(x => {
        return {
            link: clearURL(x.attr("href")),
            name: x.text().trim(),
        }
    })

    return data
}

const reqOpts = {
    headers: {
        cookie: "wants_mature_content=1; birthtime=786211201; lastagecheckage=1-0-1995;"
    }
}
async function updateStoreData(data, appid) {
    const pageData = await getAppDataFromStorePage(appid)
    if (pageData != null) {
        data.tags = pageData.tags
        data.recentReview = pageData.recentReview
        data.totalReview = pageData.totalReview
    }

    data.meta = {
        platform: "Steam",
        identifier: appid,
        last_track_date: (new Date()).toISOString().slice(0, 10),
    }

    return data
}

export async function getAppDataFromAPI(appid, steamapi) {
    let data

    // if (steamapi) {
        // steamapi uses camelCase
        // data = await steamapi.getGameDetails(appid)
    // } else {
        const api = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=${config.languageOption}`
        const apiEn = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`;

        const [body, bodyEn] = await Promise.all([
            makeRequest(api, reqOpts),
            makeRequest(apiEn, reqOpts)
        ]);

        if (!body) {
            console.log(`Failed to fetch store API for ${appid} from ${api}`)
            return null
        }
        data = JSON.parse(body);
        if (!data[appid] || !data[appid].data) {
            console.log(`API data for ${appid} error, fallback to english`)

            if (bodyEn) {
                const dataEn = JSON.parse(bodyEn);
                if (dataEn[appid] && dataEn[appid].data) {
                    data = dataEn[appid].data

                    return updateStoreData(data, appid)
                }
            }
            return {
                meta: {
                    platform: "Steam",
                    identifier: appid,
                    last_track_date: (new Date()).toISOString().slice(0, 10),
                    error: true,
                }
            }
        }
        data = data[appid].data

        if (bodyEn) {
            try {
                const dataEn = JSON.parse(bodyEn);
                if (dataEn[appid] && dataEn[appid].data) {
                    if (dataEn[appid].data.release_date) {
                        console.log(`${appid}: ${data.release_date?.date} -> ${dataEn[appid].data.release_date?.date}`);
                        data.release_date.en = dataEn[appid].data.release_date.date
                    }
                }
            } catch (e) {
                console.log(`Failed to parse English data for ${appid}.`, e);
            }
        }
    // }

    return updateStoreData(data, appid)
}

// apiData to calendarData
export function getCalendarData(data) {
    if (data.meta?.error) {
        return {
            meta: data.meta,
        }
    }
    let date = data.release_date.en ?? data.release_date.date
    let isTBA = data.release_date.coming_soon && !data.release_date.date

    let start = ResolveDateFromString(date)
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

    let supportLanguage = config.languageString.some(x => data.supported_languages.includes(x))
    let supportAudio = config.languageString.some(x => data.supported_languages.includes(x + "<strong>*</strong>"))

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
            header_image: data.header_image?.split("?")[0],
            release_date: data.release_date,
            language: {
                zh: {
                    gui: supportLanguage,
                    audio: supportAudio,
                    subtitle: supportLanguage,
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
