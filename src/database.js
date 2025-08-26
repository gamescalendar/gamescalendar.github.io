import * as fs from 'fs';
import { parse } from './parser.js';
import config from '../config.js';
import { getNeedRefreshTargets } from './utils.js';

export default class Database {
    constructor() {
        this.db = {}

        this.dbTrackingSteam = {}
        this.dbTrackingMetacritic = {}

        this.steamData = {}
        this.metacriticData = {}

        this.steamTrackingKeys = {}
        this.metacriticTrackingKeys = {}
    }

    async initialize() {
        console.log("\nInitializing database...")
        await this.load();
        console.log("Database initialized.\n")
    }

    async loadOutput(file) {
        let data
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf-8');
            data = JSON.parse(content);
            if (data.data && !data.steam) {
                data.steam = data.data
                delete(data.data)
            }
        } else {
            data = {
                index: 0,
                steam: {},
                metacritic: {},
            }
        }
        
        this.db[file] = data

        const fixStart = start => {
            if (!start) {
                return start
            }
            start = start.replaceAll("Z", "")
            if (!start) {
                return start
            }
            console.log(start)
            return new Date(start).toISOString().slice(0, 10)
        }
        
        Object.keys(data.steam).forEach(appid => {
            const appData = data.steam[appid];
            appData.start = fixStart(appData.start)
            
            // 如果还没有数据，或者这个版本更新，则使用这个版本
            if (!this.steamData[appid] || this.isNewerVersion(appData, this.steamData[appid])) {
                this.steamData[appid] = appData;
            }
        });
        Object.keys(data.metacritic).forEach(name => {
            const appData = data.metacritic[name];
            appData.start = fixStart(appData.start)
            
            if (!this.metacriticData[name] || this.isNewerVersion(appData, this.metacriticData[name])) {
                this.metacriticData[name] = appData;
            }
        });

        console.log(`Output ${file}: cached ${Object.keys(data.steam).length} Steam items, ${Object.keys(data.metacritic).length} Metacritic items.`);
    }

    async loadSource(file) {
        let steams = []
        let mcs = []

        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('//'))
                .map(str => parse(str));

            steams = lines.filter(x=>x?.steam).map(x=>x.appid)
            mcs = lines.filter(x=>x?.metacritic).map(x=>x.url)
        }

        steams.forEach(key => {
            this.steamTrackingKeys[key] = true
        })
        mcs.forEach(key => {
            this.metacriticTrackingKeys[key] = true
        })
        
        this.dbTrackingSteam[file] = steams
        this.dbTrackingMetacritic[file] = mcs

        console.log(`Source ${file}: tracking ${steams.length} Steam items, ${mcs.length} Metacritic items.`)
    }

    // 加载所有数据库的输出文件
    async load() {
        for (const db of config.databases) {
            if (!db.output) {
                continue;
            }

            console.log(`Database: ${db.source} -> ${db.output}`)
            await Promise.all([
                this.loadSource(db.source),
                this.loadOutput(db.output),
            ]);
        }

        console.log(`Loaded ${Object.keys(this.steamData).length} steam apps, ${Object.keys(this.metacriticData).length} metacritic games from all databases`);
    }

    async updateSteam(appid, data) {
        this.steamData[appid] = data
    }

    async updateMetacritic(name, data) {
        this.metacriticData[name] = data
    }

    /**
     * 保存日历数据到所有配置的输出文件
     */
    async save() {
        for (const db of config.databases) {
            if (!db.output) {
                continue;
            }

            let data = this.db[db.output]
            let trackingSteam = this.dbTrackingSteam[db.source]
            let trackingMetacritic = this.dbTrackingMetacritic[db.source]
            if (!data || !trackingSteam || !trackingMetacritic) {
                continue;
            }

            trackingSteam.forEach(key => {
                if (this.steamData[key]) {
                    data.steam[key] = this.steamData[key]
                }
            })
            trackingMetacritic.forEach(key => {
                if (this.metacriticData[key]) {
                    data.metacritic[key] = this.metacriticData[key]
                }
            })

            const content = JSON.stringify(data, null, 2);
            fs.writeFileSync(db.output, content, 'utf-8');
            
            console.log(`Calendar data saved to ${db.output}: ${Object.keys(data.steam).length}/${trackingSteam.length} Steam apps, ${Object.keys(data.metacritic).length}/${trackingMetacritic.length} Metacritic games.`);
        }
    }

    /**
     * 判断appData是否比existingData更新
     * @param {Object} appData 新的应用数据
     * @param {Object} existingData 现有的应用数据
     */
    isNewerVersion(appData, existingData) {
        // 如果没有last_track_date，认为新数据更旧或没有同步过，使用旧版数据
        if (!appData.meta || !appData.meta.last_track_date) {
            return false;
        }
        
        // 如果现有数据没有last_track_date，认为新数据更新，使用新数据
        if (!existingData.meta || !existingData.meta.last_track_date) {
            return true;
        }
        
        // 比较last_track_date，日期越新版本越新
        const newDate = new Date(appData.meta.last_track_date);
        const existingDate = new Date(existingData.meta.last_track_date);
        
        return newDate > existingDate;
    }

    getSteamAppIDToProcess() {
        let newCount = config.ratelimit.init
        let updateCount = config.ratelimit.update
        
        const cachedAppids = new Set(Object.keys(this.steamData));
        const allTrackingAppids = Object.keys(this.steamTrackingKeys);
        
        const toTrackAppids = allTrackingAppids.filter(appid => !cachedAppids.has(appid))
        const toUpdateAppids = allTrackingAppids.filter(appid => cachedAppids.has(appid))

        // 初始化：处理本地存档里没有的appid，限制数量
        let newAppids = toTrackAppids.slice(0, newCount);
        
        // 更新：根据meta.last_track_date排序，最老的在前，限制数量
        // const sortedAppids = toUpdateAppids.sort((a, b) => {
        //     const aData = this.steamData[a];
        //     const bData = this.steamData[b];
            
        //     if (!aData || !aData.meta || !aData.meta.last_track_date) return 1;
        //     if (!bData || !bData.meta || !bData.meta.last_track_date) return -1;
            
        //     return new Date(aData.meta.last_track_date) - new Date(bData.meta.last_track_date);
        // }).slice(0, updateCount);
        const sortedAppids = getNeedRefreshTargets(toUpdateAppids, this.steamData, config)
        
        // 构建带类型信息的结果数组
        const resultWithType = [];
        
        // 记录初始化类型的appid
        newAppids.forEach(appid => {
            resultWithType.push({ appid, type: 'initialization', title: null });
        });

        // 记录更新类型的appid，并提取现有数据中的标题
        sortedAppids.forEach(appid => {
            const existingData = this.steamData[appid];
            const title = existingData && existingData.title ? existingData.title : 'Unknown';
            resultWithType.push({ appid, type: 'update', title });
        });
        
        return resultWithType
    }
}
