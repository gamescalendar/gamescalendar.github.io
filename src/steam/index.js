import cheerio from 'cheerio';
import { makeRequest, yearStrToNumber, cnDateStrToDateStr, ResolveDateFromString } from '../utils.js';

function clearURL(url) {
    let u = new URL(url)
    u.search = ""
    return u.toString()
}

const reqOpts = {
    headers: {
        cookie: "wants_mature_content=1; birthtime=786211201; lastagecheckage=1-0-1995;"
    }
}
async function getAppDataFromStorePage(appid, opts = {}) {
    let page = `https://store.steampowered.com/app/${appid}?l=${opts.languageOption}`
    // console.log(`Fetching Store page for ${appid} from ${page}`)

    const body = await makeRequest(page, reqOpts);
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
                summary: recentSummary.text(), // 过去 30 天内的 2,646 篇用户评测中有 90% 为好评。
                cssClass: recentSummary.attr("class").replace("game_review_summary", "").trim(),
                count: recentReview.find(".summary").find(".responsive_hidden").text().trim(),
                tooltip: recentReview.attr("data-tooltip-html"),

                caption: recentReview.find(".subtitle").text().trim(), // 最近评测：
            }
        }
    }

    let totalReview = $(userReview.find(".subtitle.column.all").parent())
    if (totalReview.length > 0) {
        let totalSummary = totalReview.find(".game_review_summary")
        if (totalSummary.length > 0) {
            data.totalReview = {
                summary: totalSummary.text(), // 特别好评
                cssClass: totalSummary.attr("class").replace("game_review_summary", "").trim(), // positive
                count: totalReview.find(".summary").find(".responsive_hidden").text().trim(), // (15,209)
                tooltip: totalReview.attr("data-tooltip-html"), // 您语言的 15,209 篇用户评测中有 91% 为好评。

                caption: totalReview.find(".subtitle").text().trim(), // 简体中文评测：
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

    let appReview = $("#app_reviews_hash")
    let reviews = $(appReview?.find(".review_language_outliers")?.find(".outlier_totals"))
    let allLanguageReviews = $(reviews?.find("div:nth-child(1)"))
    let allLangSummary = allLanguageReviews?.find(".game_review_summary")
    if (allLanguageReviews && allLanguageReviews.length > 0 && allLangSummary && allLangSummary.length > 0) {
        data.allLangReview = {
            summary: allLangSummary.text(),
            cssClass: allLangSummary.attr("class").replace("game_review_summary", "").trim(),
            count: allLanguageReviews.find(".review_summary_count").text().trim(), // 83,597
            tooltip: allLangSummary.attr("data-tooltip-html"), // 此游戏的 83,597 篇用户评测中有 93% 为好评。
        }
    }

    return data
}

async function updateStoreData(data, appid, opts) {
    const pageData = await getAppDataFromStorePage(appid, opts)
    
    data.meta = {
        platform: "Steam",
        identifier: appid,
        last_track_date: (new Date()).toISOString().slice(0, 10),
    }

    if (pageData != null && pageData.tags && pageData.tags.length > 0) {
        data.tags = pageData.tags
        data.recentReview = pageData.recentReview
        data.totalReview = pageData.totalReview
        data.allLangReview = pageData.allLangReview
    } else {
        data.meta.error = true
        data.meta.error_reason = "Store failed"
        console.log(pageData)
    }

    return data
}

export async function getAppDataFromAPI(appid, steamapi, opts = {}) {
    let data

    // if (steamapi) {
        // steamapi uses camelCase
        // data = await steamapi.getGameDetails(appid)
    // } else {
        const api = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=${opts.languageOption}`
        const apiEn = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`;

        const [body, bodyEn] = await Promise.all([
            makeRequest(api, reqOpts),
            makeRequest(apiEn, reqOpts)
        ]);

        if (!body) {
            console.log(`Failed to fetch store API for ${appid} from ${api}`)
            return null
        }
        try {
            data = JSON.parse(body);
        } catch(e) {
            console.log(`Failed to parse ${opts.languageOption} data for ${appid}.\n${body}`, e);
        }
        if (!data || !data[appid] || !data[appid].data) {
            if (bodyEn) {
                try {
                    const dataEn = JSON.parse(bodyEn);
                    if (dataEn && dataEn[appid] && dataEn[appid].data) {
                        console.log(`API data for ${appid} error, fallback to english`)

                        data = dataEn[appid].data

                        const result = updateStoreData(data, appid, opts)
                        if (result.meta) {
                            result.meta.error = true
                            result.meta.error_reason = "Fallback to English"
                        }
                        return result
                    }
                } catch (e) {
                    console.log(`Failed to parse English data for ${appid}.\n${bodyEn}`, e);
                }
            }
            console.log(`API data for ${appid} error, record failure`)
            return {
                meta: {
                    platform: "Steam",
                    identifier: appid,
                    last_track_date: (new Date()).toISOString().slice(0, 10),
                    error: true,
                    error_reason: "API failed"
                }
            }
        }
        data = data[appid].data

        if (bodyEn) {
            try {
                const dataEn = JSON.parse(bodyEn);
                if (dataEn && dataEn[appid] && dataEn[appid].data) {
                    if (dataEn[appid].data.release_date) {
                        // console.log(`${appid}: ${data.release_date?.date} -> ${dataEn[appid].data.release_date?.date}`);
                        data.release_date.en = dataEn[appid].data.release_date.date
                    }
                }
            } catch (e) {
                console.log(`Failed to parse English data for ${appid}.`, e);
            }
        }
    // }

    return updateStoreData(data, appid, opts)
}

// apiData to calendarData
export function getCalendarData(data, opts = {}) {
    if (data.meta?.error) {
        return data
    }
    let date = data.release_date.en ?? cnDateStrToDateStr(data.release_date.date)
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

    let supportLanguage = opts.languageString.some(x => data.supported_languages?.includes(x))
    let supportAudio = opts.languageString.some(x => data.supported_languages?.includes(x + "<strong>*</strong>"))

    return {
        meta: data.meta,
        type: "Game",
        title: data.name,
        start: start,
        app_data: {
            platform: "Steam",
            appid: data.steam_appid,
            title: data.name.trim(),
            description: data.short_description.trim(),
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
            allLangReview: data.allLangReview
        }
    }
}
