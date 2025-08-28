const fs = require('fs');
const path = require('path');

function BuildString(steam, mc) {
    if (!Array.isArray(steam)) {
        steam = Object.keys(steam)
    }
    if (!Array.isArray(mc)) {
        mc = Object.keys(mc)
    }

    const list = steam.map(x=> parseInt(x))
    list.sort(function(a, b) {
        return a - b;
    })
    const appids = list.join("\n")
    const mcs = mc.join("\n")

    return [appids, mcs].join("\n")
}

function analysisDatabase(inputFilePath, outputPath) {
    // 1. 检查命令行参数是否提供
    if (!inputFilePath) {
        console.error('错误: 请提供一个JSON文件路径作为参数。');
        console.error('用法: node your_script_name.js input.json');
        return;
    }

    const jsonData = fs.readFileSync(inputFilePath, 'utf8');
    const data = JSON.parse(jsonData);

    if (!data.steam) {
        console.error("no data.steam")
        return;
    }

    if (!data.metacritic) {
        console.error("no data.metacritic")
        return;
    }

    fs.writeFileSync(outputPath, BuildString(data.steam, data.metacritic), 'utf8');

    console.log(`成功将文件 ${inputFilePath} 最小化并输出到 ${outputPath}`);
}

function analysisOldDatabase(fileList, outputPath, dupPath) {
    const steam = {}
    const mc = {}

    let steamDup = []
    let mcDup = []

    fileList.forEach(file => {
        const jsonData = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(jsonData);

        if (!data.steam) {
            console.error(`${file} no data.steam`)
            return;
        }

        if (!data.metacritic) {
            console.error(`${file} no data.metacritic`)
            return;
        }

        Object.keys(data.steam).forEach(x=> {
            steam[x] = true
        })
        Object.keys(data.metacritic).forEach(x=> {
            mc[x] = true
        })

        steamDup = steamDup.concat(Object.keys(data.steam))
        mcDup = mcDup.concat(Object.keys(data.metacritic))
    })

    fs.writeFileSync(outputPath, BuildString(steam, mc), 'utf8');
    console.log(`成功输出到 ${outputPath}`);

    fs.writeFileSync(dupPath, BuildString(steamDup, mcDup), 'utf8');
}

// 调用函数处理文件
analysisDatabase("database.json", "database.list");
analysisOldDatabase([
    "events.json", "wishlist.json", "owned.json", "family.json"
], "database_old.list", "database_old_dup.list");

