import * as fs from 'fs';

function SharedLibraryAppsToAppidList(file) {
    const raw = fs.readFileSync(file, 'utf8');
    let data = JSON.parse(raw);

    if (data.response) {
        data = data.response
    }
    if (data.apps) {
        data = data.apps
    }

    data = data.map(x => x?.appid).filter(x => x).sort((a, b) => b - a)

    data.forEach(appid => {
        console.log(`${appid}`)
    })
}

const inputPath = process.argv[2];
SharedLibraryAppsToAppidList(inputPath)
