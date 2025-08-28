import * as fs from 'fs';
import { parse } from './parser.js';
import { getNeedRefreshTargets, cnDateStrToDateStr } from './utils.js';

export default class Database {
    constructor(config) {
        this.config = config

        this.db = {}

        this.dbTrackingSteam = {}
        this.dbTrackingMetacritic = {}

        this.steamMeta = {}
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

    async loadDatabase(file) {
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
                steam_meta: {},
            }
        }
        
        this.db[file] = data

        Object.keys(data.steam).forEach(appid => {
            const appData = data.steam[appid];
            appData.start = cnDateStrToDateStr(appData.start)
            
            // 如果还没有数据，或者这个版本更新，则使用这个版本
            if (!this.steamData[appid] || this.isNewerVersion(appData, this.steamData[appid])) {
                this.steamData[appid] = appData;
            }
        });
        Object.keys(data.metacritic).forEach(name => {
            const appData = data.metacritic[name];
            appData.start = cnDateStrToDateStr(appData.start)
            
            if (!this.metacriticData[name] || this.isNewerVersion(appData, this.metacriticData[name])) {
                this.metacriticData[name] = appData;
            }
        });

        console.log(`Database ${file}: cached ${Object.keys(data.steam).length} Steam items, ${Object.keys(data.metacritic).length} Metacritic items.`);
        if (data.steam_meta) {
            Object.keys(data.steam_meta).forEach(type => {
                if (!this.steamMeta[type]) {
                    this.steamMeta[type] = {}
                }
                Object.keys(data.steam_meta[type]).forEach(key => {
                    const v = data.steam_meta[type][key]
                    this.steamMeta[type][key] = v
                })
            })

            const txt = Object.keys(data.steam_meta).map(key => {
                return `${Object.keys(data.steam_meta[key]).length} ${key}`
            }).join(", ")
            console.log(`    Steam meta: ${txt}`)
        }
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
                steam: [],
                metacritic: [],
            }
        }
        
        this.db[file] = data

        console.log(`    Source output ${file}: cached ${Object.keys(data.steam).length} Steam items, ${Object.keys(data.metacritic).length} Metacritic items.`);
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
            mcs = lines.filter(x=>x?.metacritic).map(x=>x.name)
        }

        steams.forEach(key => {
            this.steamTrackingKeys[key] = true
        })
        mcs.forEach(key => {
            this.metacriticTrackingKeys[key] = true
        })
        
        this.dbTrackingSteam[file] = steams
        this.dbTrackingMetacritic[file] = mcs

        console.log(`    Source ${file}: tracking ${steams.length} Steam items, ${mcs.length} Metacritic items.`)
    }

    // 加载所有数据库的输出文件
    async load() {
        if (this.config.database) {
            this.loadDatabase(this.config.database);
        }
        for (const db of this.config.databases) {
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

    packDatabase(database) {
        console.log("Packing database...")
        const db = database.steam;
        const meta = database.steam_meta ?? {
            categories: {},
            genres: {},
            tags: {},
        }
        meta.categories = meta.categories ?? {}
        meta.genres = meta.genres ?? {}
        meta.tags = meta.tags ?? {}
        
        let keys = Object.keys(db)
        console.log(`Packing ${keys.length} Steam apps...`)

        keys.forEach(appid => {
            const data = db[appid]?.app_data
            if (!data) {
                // console.log(`${appid}: no app_data`)
                return
            }

            if (data.categories) {
                data.categories = data.categories.map(cate => {
                    if (cate.id) {
                        if (!meta.categories[cate.id]) {
                            meta.categories[cate.id] = cate.description
                        }

                        return cate.id
                    } else {
                        return cate
                    }
                })
            }

            if (data.genres) {
                data.genres = data.genres.map(genr => {
                    if (genr.id) {
                        if (!meta.genres[genr.id]) {
                            meta.genres[genr.id] = genr.description
                        }

                        return genr.id
                    } else {
                        return genr
                    }
                })
            }

            if (data.tags) {
                data.tags = data.tags.map(tag => {
                    if (tag.name) {
                        if (!meta.tags[tag.name]) {
                            meta.tags[tag.name] = tag.link
                        }

                        return tag.name
                    } else {
                        return tag
                    }
                })
            }
        })
        database.steam_meta = meta;

        console.log(`Packed: ${Object.keys(meta.categories).length} categories, ${Object.keys(meta.genres).length} genres, ${Object.keys(meta.tags).length} tags.`);
        return database
    }

    /**
     * 保存日历数据到所有配置的输出文件
     */
    async save() {
        if (this.config.database) {
            let database = {
                steam_meta: this.steamMeta,
                steam: this.steamData,
                metacritic: this.metacriticData,
            }
            database = this.packDatabase(database)

            fs.writeFileSync(this.config.database, JSON.stringify(database, null, 2), 'utf-8');
            console.log(`Database saved to ${this.config.database}: cached ${Object.keys(database.steam).length} Steam items, ${Object.keys(database.metacritic).length} Metacritic items.`);
        }

        for (const db of this.config.databases) {
            if (!db.output) {
                continue;
            }

            let data = this.db[db.output]
            let trackingSteam = this.dbTrackingSteam[db.source]
            let trackingMetacritic = this.dbTrackingMetacritic[db.source]
            if (!data || !trackingSteam || !trackingMetacritic) {
                continue;
            }

            data.steam = trackingSteam
            data.metacritic = trackingMetacritic

            const content = JSON.stringify(data, null, 2);
            fs.writeFileSync(db.output, content, 'utf-8');
            
            console.log(`Calendar data saved to ${db.output}: ${data.steam.filter(x=>this.steamData[x]).length}/${trackingSteam.length} Steam apps, ${data.metacritic.filter(x=>this.metacriticData[x]).length}/${trackingMetacritic.length} Metacritic games.`);
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
        let newCount = this.config.ratelimit.init
        let updateCount = this.config.ratelimit.update
        
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
        const sortedAppids = getNeedRefreshTargets(toUpdateAppids, this.steamData, this.config)
        
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
