const fs = require('fs');

function parseSteam(text) {
    let appid = parseFloat(text)
    if (typeof appid == "number" && !isNaN(appid)) {
        return {
            appid: appid,
            steam: true,
        };
    }
    if (typeof text != "string") return;

    text = text.trim().split(" ")[0]
    text = text.replace("http://", "")
    text = text.replace("https://", "")
    text = text.replace("store.steampowered.com/", "")
    text = text.replace("steamcommunity.com/", "")
    if (text.startsWith("app/")) {
        text = text.replace("app/", "")
        let elements = text.split("/")
        if (elements.length >= 1) {
            let appid = parseFloat(elements[0])
            // console.log(`take ${elements[0]} as appid from ${originalTarget}`)
            if (appid && !isNaN(appid)) {
                return {
                    appid: appid,
                    steam: true,
                }
            }
        }
    }
    // console.log(`${target} is not a valid steam appid or URL`)
}

const MetacriticURL = "https://www.metacritic.com/game/"

function parseMetacritic(text) {
    if (typeof text === "string") {
        let lowered = text.toLowerCase().trim()
        if (lowered.startsWith(MetacriticURL)) {
            return {
                url: text,
                metacritic: true,
            }
        }
    }
}

function parse(target) {
    return parseSteam(target) || parseMetacritic(target)
}

function parseFile(file) {
    let arr = fs.readFileSync(file, "utf-8").split("\n")
        .map(x => x.trim())
        .filter(x => x.length > 0 && !x.startsWith("//"))
    //console.log(`Read target list: ${list.join("\n")}`)

    let database = {
        steam: [],
        metacritic: [],
    }

    arr.forEach(str => {
        let result = parse(str)
        if (result?.steam) {
            database.steam.push(result.appid)
        }
        if (result?.metacritic) {
            database.metacritic.push(result.url)
        }
    })

    return database
}

module.exports = {
    parse,
    parseFile,
    MetacriticURL,
}
