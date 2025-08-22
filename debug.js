
const cheerio = require('cheerio');
const fetch = require("node-fetch");
const {HttpsProxyAgent} = require("https-proxy-agent");

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
        console.log(`using proxy ${proxy}`)
        opts.agent = new HttpsProxyAgent(proxy);
        response = await fetch(url, opts);
        return await response.text();
    } catch (e) {
        console.log(`failed to fetch ${url}, error: ${e}`)
        return null
    }
}

async function testMetaScore() {
    const url = "https://www.metacritic.com/game/demons-souls"

    let body = await makeRequest(url) // details 页面有 table，不好解析
    if (!body) {
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

    console.log(metaScore)
    console.log(userScore)
    console.log(metaReviewsCount)
    console.log(userReviewsCount)
}

(async () => {

    // let game = "donkey-kong-bananza"
    let game = "death-stranding-2-on-the-beach"
    let detailsUrl = `https://www.metacritic.com/game/${game}/details/`
    let detailsBody = await makeRequest(detailsUrl)
    if (!detailsBody) {
        console.log(`Failed to fetch metacritic page for ${game} from ${detailsUrl}`)
        return null
    }

    $ = cheerio.load(detailsBody)
    let img = $(".c-cmsImage-loaded")
    // console.log(img)
    let imageURL = img.attr("src")
    let imageAlt = img.attr("alt")
    
    const elementToUrl = function(element) {
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
            console.log(pubElem)
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


    console.log(publishers)
    console.log(developers)
})();
