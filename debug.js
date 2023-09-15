
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

(async () => {
    const url = "https://www.metacritic.com/game/demons-souls"

    let body = await makeRequest(url) // details 页面有 table，不好解析
    if (!body) {
        return null
    }

    let $ = cheerio.load(body)

    let meta = $(".c-productScoreInfo_scoreContent:nth(0) .c-siteReviewScore").text().trim()
    let user = $(".c-productScoreInfo_scoreContent:nth(1) .c-siteReviewScore").text().trim()

    console.log(meta)
    console.log(user)
})();
