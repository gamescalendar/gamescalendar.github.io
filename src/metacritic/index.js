const cheerio = require('cheerio');
const { makeRequest } = require('../utils');

function toNumberOrUndefined(str) {
    let num = parseFloat(str)
    if (isNaN(num)) {
        return undefined
    }
    return num
}

function elementToUrl(element) {
    let url = ""
    if (element.attr("href")) {
        url = element.attr("href")
    } else {
        let a = element.find("a")
        if (a && a.attr("href")) {
            url = a.attr("href")
        }
    }
    return url
}

export async function getMetacriticInfo(game, platformOverride) {
    // === Scores ===
    // Main page no longer provides full game description and cover image
    let url = `https://www.metacritic.com/game/${game}`
    console.log(`Fetching Metacritic for ${game} from ${url}`)
    let body = await makeRequest(url)
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
    let detailsBody = await makeRequest(detailsUrl)
    if (!detailsBody) {
        console.log(`Failed to fetch metacritic page for ${game} from ${detailsUrl}`)
        return null
    }

    $ = cheerio.load(detailsBody)

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
    let platform = platformOverride
    if (!platform) {
        platform = platforms.length > 0 ? platforms[0].name : "unknown"
    }

    // publishers
    let publishers = []

    let pubElem = $(".c-gameDetails_Distributor .g-outer-spacing-left-medium-fluid")
    let pubName = pubElem.text().trim()
    if (pubName === "") {
        publishers = Array.from($(".c-gameDetails_Distributor li")).map(x => {
            let $x = $(x)
            return {
                name: $x.text().trim(),
                url: elementToUrl($x),
            }
        })
    } else {
        publishers.push({
            name: pubName,
            url: elementToUrl(pubElem),
        })
    }

    // devs
    let developers = []

    let devElem = $(".c-gameDetails_Developer .g-outer-spacing-left-medium-fluid")
    let devName = devElem.text().trim()
    if (devName === "") {
        developers = Array.from($(".c-gameDetails_Developer li")).map(x => {
            let $x = $(x)
            return {
                name: $x.text().trim(),
                url: elementToUrl($x),
            }
        })
    } else {
        developers.push({
            name: devName,
            url: elementToUrl(devElem),
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

    return {
        meta: {
            platform: platform,
            identifier: url,
            last_track_date: (new Date()).toISOString().slice(0, 10),
        },
        type: "Game",
        title: title,
        start: start,
        app_data: {
            imageURL: imageURL,
            imageAlt: imageAlt,

            platform: platform,
            name: game,
            title: title,
            platformString: platforms,
            releaseDate: startStr,

            summary: summary,
            publisher: publishers,
            developer: developers,
            genres: genres,

            metaScore: toNumberOrUndefined(metaScore),
            metaReviewsCount: toNumberOrUndefined(metaReviewsCount),
            userScore: toNumberOrUndefined(userScore),
            userReviewsCount: toNumberOrUndefined(userReviewsCount),
        },
    }
}
