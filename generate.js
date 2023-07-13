const https = require('https');

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


const fetch = require('node-fetch');
const {HttpsProxyAgent} = require('https-proxy-agent');


async function get_appdata(appid) {
    const proxyAgent = new HttpsProxyAgent('http://127.0.0.1:1080');
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}`, {agent: proxyAgent});
    const body = await response.text();
    // console.log(body);
    return JSON.parse(body)
}

function gen_calendar_data(data) {
    return {
        title: data.name,
        start: (new Date(data.release_date.date)).toISOString().slice(0, 10),
        app_data: {
            appid: data.steam_appid,
            title: data.name,
            description: data.short_description,
            tags: data.genres.map(x => x.description),
            release_date: data.release_date,
            language: {
                zh: {
                    gui: data.supported_languages.includes("简体中文") || data.supported_languages.includes("Chinese"),
                    audio: data.supported_languages.includes("简体中文<strong>*</strong>") || data.supported_languages.includes("Chinese<strong>*</strong>"),
                    subtitle: true,
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

function transform_data(data) {
    let result = []

    data.forEach(x => {
        let keys = Object.keys(x)
        for (const key of keys) {
            // console.log(x[key])
            let data = x[key].data
            if (!data) {
                continue
            }
            let app_data = gen_calendar_data(data)
            result.push(app_data)
        }
    })

    return result
}

async function main() {
    let targets = [
        1086940, // baldur
        1244090, // sea of stars
        1716740, // STARFIELD
        949230, // skylines 2
        2254740, // Persona_5_Tactica
    ]
    let data = []

    for (let target of targets) {
        data.push(await get_appdata(target))
    }

    let calendar_data = transform_data(data)

    console.log(JSON.stringify(calendar_data, null, 4))
}

(async () => {
    try {
        await main()
    } catch (e) {
        // Deal with the fact the chain failed
    }
    // `text` is not available here
})();
// https.get('https://httpbin.org/get', res => {
//     let data = [];
//     const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';
//     console.log('Status Code:', res.statusCode);
//     console.log('Date in Response header:', headerDate);
//
//     res.on('data', chunk => {
//         data.push(chunk);
//     });
//
//     res.on('end', () => {
//         console.log('Response ended: ');
//         const users = JSON.parse(Buffer.concat(data).toString());
//
//         console.log(users);
//     });
// }).on('error', err => {
//     console.log('Error: ', err.message);
// });