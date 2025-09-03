import cheerio from 'cheerio';
import { makeRequest, yearStrToNumber, cnDateStrToDateStr, ResolveDateFromString } from './src/utils.js';
import config from './config.js';
import { getCalendarData } from './src/steam/index.js';

function clearURL(url) {
    let u = new URL(url)
    u.search = ""
    return u.toString()
}

const reqOpts = {
    headers: {
        cookie: "wants_mature_content=1; birthtime=-1988179199; lastagecheckage=1-0-1995; review_score_preference=0"
    }
}

// https://store.steampowered.com/apphoverpublic/1771300?review_score_preference=1&l=schinese&pagev6=true
async function getAppDataFromStorePage(appid) {
    let page = `https://store.steampowered.com/app/${appid}?l=${config.languageOption}&review_score_preference=0`
    // console.log(`Fetching Store page for ${appid} from ${page}`)

    const body = await makeRequest(page, reqOpts);
    if (!body) {
        console.log(`Failed to fetch store page for ${appid} from ${page}`)
        return null
    }

    let data = {}

    // return body;
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

async function updateStoreData(data, appid) {
    const pageData = await getAppDataFromStorePage(appid)
    if (pageData != null) {
        data.tags = pageData.tags
        data.recentReview = pageData.recentReview
        data.totalReview = pageData.totalReview
        data.allLangReview = pageData.allLangReview
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
        try {
            data = JSON.parse(body);
        } catch(e) {
            console.log(`Failed to parse ${config.languageOption} data for ${appid}.\n${body}`, e);
        }
        if (!data || !data[appid] || !data[appid].data) {
            if (bodyEn) {
                try {
                    const dataEn = JSON.parse(bodyEn);
                    if (dataEn && dataEn[appid] && dataEn[appid].data) {
                        console.log(`API data for ${appid} error, fallback to english`)

                        data = dataEn[appid].data

                        return updateStoreData(data, appid)
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
                }
            }
        }
        data = data[appid].data

        if (bodyEn) {
            try {
                const dataEn = JSON.parse(bodyEn);
                if (dataEn && dataEn[appid] && dataEn[appid].data) {
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


// getAppDataFromStorePage(1771300).then(data => {
//     // data.tags = undefined
//     if (data.tags) {
//         data.tags= undefined
//     }
//     console.log(data)
// });

const DetailTest = appid => getAppDataFromAPI(appid).then(data => {
    delete(data.tags)
    delete(data.ratings)
    delete(data.achievements)
    delete(data.movies)
    delete(data.screenshots)
    delete(data.categories)
    delete(data.genres)
    delete(data.metacritic)
    delete(data.package_groups)
    delete(data.price_overview)
    delete(data.detailed_description)
    delete(data.about_the_game)
    delete(data.pc_requirements)
    console.log(data)
});
// DetailTest(242050)
// DetailTest(368500)

const StoreTest = appid => getAppDataFromStorePage(appid).then(data => {
    // data.tags = undefined
    if (data.tags) {
        data.tags= undefined
    }
    console.log(data)
});
// StoreTest(1569580)

const DateTest = appid => getAppDataFromAPI(appid).then(data => {
    // data.tags = undefined
    if (data.tags) {
        data.tags= undefined
    }
    data = getCalendarData(data, config)
    console.log(data.app_data.release_date)
    console.log(data.start)
});
// DateTest(1735700)
// DateTest(456670)

// METAL GEAR SOLID Δ: SNAKE EATER；需要成人验证
// getAppDataFromAPI(2417610).then(data => {
//     data.tags = undefined
//     console.log(data)
// });
getAppDataFromAPI(516030).then(data => {
    // data.tags = undefined
    if (data.tags) {
        data.tags= undefined
    }
    data = getCalendarData(data, config)
    data.app_data.description = data.app_data.description.trim()
    console.log(data.app_data)
})