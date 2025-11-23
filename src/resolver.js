import * as fs from 'fs';
import SteamAPI from 'steamapi';
import {HttpsProxyAgent} from 'https-proxy-agent';

import { makeRequest } from './utils.js';
import { getAppDataFromAPI, getCalendarData } from './steam/index.js';
import Database from './database.js';

export default class Resolver {
    constructor(config = {}) {
        this.config = config
        this.wishlist = [];
        this.owned = new Map(); // 改为 Map 结构提高查询性能
        this.steam = null;
        this.hasSteamConfig = false;
        this.steamId = null; // 缓存 SteamID
        this.meta = null; // 元数据对象
        this.forceUpdate = config.forceUpdate || false; // 强制更新选项

        this.database = new Database(this.config)
        
        // 配置代理
        this.proxy = this.getProxyConfig();
        if (this.proxy) {
            console.log(`Using proxy: ${this.proxy}`);
        }
        
        // 检查是否有 Steam 配置
        const apiKey = process.env.STEAM_APIKEY;
        const steamUser = this.config.steam?.user;
        
        if (apiKey && steamUser) {
            this.steam = new SteamAPI(apiKey, {
                language: this.config.languageOption,
                headers: this.getRequestOptions(),
            });
            this.hasSteamConfig = true;
            console.log(`Steam user configured: ${steamUser}`);
        } else {
            if (!apiKey) {
                console.log('Steam API not configured - missing STEAM_APIKEY');
            }
            if (!steamUser) {
                console.log('Steam API not configured - missing steam.user');
            }
        }
    }

    /**
     * 初始化或加载meta文件
     */
    async initializeMeta() {
        if (fs.existsSync(this.config.meta)) {
            const metaContent = fs.readFileSync(this.config.meta, 'utf-8');
            this.meta = JSON.parse(metaContent);
            console.log(`Meta file loaded: ${this.config.meta}`);
        } else {
            // 创建新的meta文件
            this.meta = {
                lastWishlistUpdate: null,
                lastOwnedUpdate: null,
                steamId: null,
            };
            await this.saveMeta();
            console.log(`New meta file created: ${this.config.meta}`);
        }
    }

    /**
     * 保存meta文件
     */
    async saveMeta() {
        const metaContent = JSON.stringify(this.meta, null, 2);
        fs.writeFileSync(this.config.meta, metaContent, 'utf-8');
    }

    /**
     * 获取当前UTC日期字符串（YYYY-MM-DD格式）
     */
    getCurrentDateString() {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 检查是否需要更新（基于日期和ForceUpdate选项）
     */
    shouldUpdate() {
        if (this.forceUpdate) {
            console.log('Force update enabled, skipping date check');
            return true;
        }

        if (!this.meta) {
            console.log('No meta data available, proceeding with update');
            return true;
        }

        const today = this.getCurrentDateString();
        const lastWishlistUpdate = this.meta.lastWishlistUpdate || null;
        const lastOwnedUpdate = this.meta.lastOwnedUpdate || null;

        if (lastWishlistUpdate === today && lastOwnedUpdate === today) {
            console.log('Both wishlist and owned lists were updated today, skipping update');
            return false;
        }

        if (lastWishlistUpdate === today) {
            console.log('Wishlist was updated today, skipping wishlist update');
        }
        if (lastOwnedUpdate === today) {
            console.log('Owned list was updated today, skipping owned update');
        }

        return true;
    }

    /**
     * 检查SteamID是否需要更新
     */
    shouldUpdateSteamId() {
        if (this.forceUpdate) {
            return true;
        }

        if (!this.meta || !this.meta.steamId) {
            return true;
        }

        console.log('SteamID already cached in meta, skipping resolution');
        return false;
    }

    /**
     * 获取代理配置
     */
    getProxyConfig() {
        // 优先从 config.proxy 获取
        if (this.config.proxy && typeof this.config.proxy === 'string' && this.config.proxy.trim() !== '') {
            return this.config.proxy.trim();
        }
        
        // 如果没有配置，尝试从环境变量 HTTP_PROXY 获取
        const envProxy = process.env.HTTP_PROXY;
        if (envProxy && typeof envProxy === 'string' && envProxy.trim() !== '') {
            return envProxy.trim();
        }
        
        return null;
    }

    /**
     * 创建带有代理的请求选项
     */
    getRequestOptions() {
        const options = {};
        
        if (this.proxy) {
            options.agent = new HttpsProxyAgent(this.proxy);
        }
        
        return options;
    }

    /**
     * 解析并缓存 SteamID
     */
    async resolveSteamId() {
        if (!this.hasSteamConfig) {
            console.log('Skipping SteamID resolution - Steam API not configured');
            return null;
        }

        // 检查是否需要更新SteamID
        if (!this.shouldUpdateSteamId()) {
            // 从meta中恢复SteamID
            this.steamId = this.meta.steamId;
            console.log(`SteamID restored from meta: ${this.steamId}`);
            return this.steamId;
        }

        const steamUser = this.config.steam.user;
        let userId;
        
        // 规则1: 如果是完整的 steamcommunity.com 链接，直接解析
        if (steamUser.includes('https://steamcommunity.com')) {
            console.log(`Calling Steam resolve for URL: ${steamUser}`);
            userId = await this.steam.resolve(steamUser);
            console.log(`Resolved Steam URL "${steamUser}" to Steam ID: ${userId}`);
        }
        // 规则2: 如果是17位纯数字，当作 SteamID 尝试解析
        else if (steamUser.match(/^\d{17}$/)) {
            const steamIdUrl = `https://steamcommunity.com/profiles/${steamUser}`;
            try {
                console.log(`Calling Steam resolve for SteamID URL: ${steamIdUrl}`);
                userId = await this.steam.resolve(steamIdUrl);
                // 验证解析结果是否匹配输入的 SteamID
                if (userId === steamUser) {
                    console.log(`Successfully resolved SteamID: ${userId}`);
                } else {
                    throw new Error(`SteamID mismatch: expected ${steamUser}, got ${userId}`);
                }
            } catch (error) {
                console.log(`Failed to resolve as SteamID "${steamUser}", trying as custom ID...`);
                
                // 规则3: 当作用户自定义ID解析
                const customIdUrl = `https://steamcommunity.com/id/${steamUser}/`;
                console.log(`Calling Steam resolve for custom ID URL: ${customIdUrl}`);
                userId = await this.steam.resolve(customIdUrl);
                console.log(`Resolved custom ID "${steamUser}" to Steam ID: ${userId}`);
            }
        }
        // 规则4: 其他情况当作用户自定义ID解析
        else {
            const customIdUrl = `https://steamcommunity.com/id/${steamUser}/`;
            console.log(`Calling Steam resolve for custom ID URL: ${customIdUrl}`);
            userId = await this.steam.resolve(customIdUrl);
            console.log(`Resolved custom ID "${steamUser}" to Steam ID: ${userId}`);
        }
        
        this.steamId = userId;
        // 保存SteamID到meta文件
        if (this.meta) {
            this.meta.steamId = userId;
            await this.saveMeta();
        }
        console.log(`SteamID cached: ${this.steamId}`);
        return userId;
    }

    /**
     * 从配置文件中的数据库源文件构建 wishlist
     */
    async buildWishlist() {
        this.wishlist = [];
        
        // 查找 SteamWishlist 类型的数据库
        const steamWishlistDb = this.config.databases.find(db => db.type === 'SteamWishlist');
        
        if (steamWishlistDb && this.hasSteamConfig && this.config.steam?.wishlist) {
            // 检查是否需要更新
            if (!this.forceUpdate && this.meta && this.meta.lastWishlistUpdate) {
                const today = this.getCurrentDateString();
                const lastUpdate = this.meta.lastWishlistUpdate;
                if (lastUpdate === today) {
                    console.log('Wishlist was updated today, skipping API call');
                    await this.buildWishlistFromLocalFiles();
                    return this.wishlist;
                }
            }
            
            try {
                await this.buildWishlistFromThirdPartyAPI();
                // 保存到文件
                await this.saveWishlistToFile(steamWishlistDb.source);
                // 记录更新日期
                if (this.meta) {
                    this.meta.lastWishlistUpdate = this.getCurrentDateString();
                    await this.saveMeta();
                }
            } catch (error) {
                console.error('Failed to build wishlist from Steam API, falling back to local files:', error.message);
                await this.buildWishlistFromLocalFiles();
            }
        } else {
            // 从本地文件构建
            await this.buildWishlistFromLocalFiles();
        }
        
        console.log(`Built wishlist with ${this.wishlist.length} items`);
        return this.wishlist;
    }

    /**
     * 从 Steam Wishlist Calculator API 获取愿望单数据
     */
    async buildWishlistFromThirdPartyAPI() {
        console.log('Building wishlist from Steam Wishlist Calculator API...');
        
        if (!this.steamId) {
            throw new Error('SteamID not resolved yet');
        }
        
        // 构建 API URL
        const countryCode = this.config.steam.countryCode || 'US';
        const apiUrl = `https://www.steamwishlistcalculator.com/api/wishlist?steamId=${this.steamId}&countryCode=${countryCode}`;

        console.log(`Fetching wishlist from: ${apiUrl}`);
        
        console.log(`Making HTTP request to Steam Wishlist API: ${apiUrl}`);
        const requestOptions = this.getRequestOptions();
        const response = await makeRequest(apiUrl, requestOptions);
        
        if (!response) {
            throw new Error('Failed to fetch wishlist from Steam API');
        }
        
        const wishlistData = JSON.parse(response);
        
        // 解析返回的数据，提取 appid
        wishlistData.forEach(item => {
            if (item.storeItem) {
                item = storeItem.storeItem
            }
            if (item.success && item.appid) {
                this.wishlist.push(parseInt(item.appid));
            }
        });
        
        console.log(`Successfully fetched ${this.wishlist.length} items from Steam Wishlist API`);
    }

    /**
     * 从本地文件构建愿望单
     */
    async buildWishlistFromLocalFiles() {
        console.log('Building wishlist from local files...');
        
        for (const db of this.config.databases) {
            if (db.type !== 'SteamWishlist') {
                // 跳过 SteamWishlist 类型，因为我们要从 API 获取
                continue;
            }
            
            if (fs.existsSync(db.source)) {
                const content = fs.readFileSync(db.source, 'utf-8');
                const lines = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && !line.startsWith('//'))
                    .map(line => parseInt(line))
                    .filter(id => !isNaN(id));
                
                this.wishlist.push(...lines);
                console.log(`${db.source}: read ${lines.length} items`)
            }
        }
        
        console.log(`Built wishlist with ${this.wishlist.length} items from local sources`);
    }

    /**
     * 从 Steam API 获取用户拥有的游戏列表
     */
    async buildOwned() {
        this.owned.clear();
        
        if (!this.config.steam.owned) {
            console.log("Skipping owned list build - config.steam.owned disabled")
            return this.owned;
        }
        
        if (!this.hasSteamConfig) {
            console.log('Skipping owned list build - Steam API not configured');
            return this.owned;
        }
        
        // 检查是否需要更新
        if (!this.forceUpdate && this.meta && this.meta.lastOwnedUpdate) {
            const today = this.getCurrentDateString();
            const lastUpdate = this.meta.lastOwnedUpdate;
            if (lastUpdate === today) {
                console.log('Owned list was updated today, skipping API call');
                await this.buildOwnedFromLocalFiles();
                return this.owned;
            }
        }
        
        try {
            if (!this.steamId) {
                throw new Error('SteamID not resolved yet');
            }
            
            // 获取用户拥有的游戏
            console.log(`Fetching owned games for SteamID: ${this.steamId}`);
            const games = await this.steam.getUserOwnedGames(this.steamId);
            
            games.forEach(game => {
                this.owned.set(game.game.id.toString(), true);
            });
            
            console.log(`Built owned list with ${this.owned.size} games`);
            
            // 查找 SteamOwned 类型的数据库并保存
            const steamOwnedDb = this.config.databases.find(db => db.type === 'SteamOwned');
            if (steamOwnedDb) {
                await this.saveOwnedToFile(steamOwnedDb.source);
                // 记录更新日期
                if (this.meta) {
                    this.meta.lastOwnedUpdate = this.getCurrentDateString();
                    await this.saveMeta();
                }
            }
        } catch (error) {
            console.error('Failed to build owned list from Steam API, falling back to local files:', error.message);
            // 网络调用失败时，回退到本地文件
            await this.buildOwnedFromLocalFiles();
        }
        
        return this.owned;
    }

    /**
     * 从本地文件构建已拥有游戏列表
     */
    async buildOwnedFromLocalFiles() {
        console.log('Building owned list from local files...');
        
        for (const db of this.config.databases) {
            if (db.type !== 'SteamOwned') {
                // 跳过非 SteamOwned 类型
                continue;
            }
            
            if (fs.existsSync(db.source)) {
                const content = fs.readFileSync(db.source, 'utf-8');
                const lines = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && !line.startsWith('//'))
                    .map(line => parseInt(line))
                    .filter(id => !isNaN(id));
                
                lines.forEach(id => {
                    this.owned.set(id.toString(), true);
                });
                console.log(`${db.source}: read ${lines.length} items`)
            }
        }
        
        console.log(`Built owned list with ${this.owned.size} games from local sources`);
    }

    /**
     * 保存愿望单到文件
     */
    async saveWishlistToFile(filename) {
        try {
            // 逆序排序并只保存 appid
            const sortedWishlist = [...this.wishlist]
                .sort((a, b) => b - a) // 逆序排序
                .map(id => id.toString()); // 转换为字符串
            
            const content = sortedWishlist.join('\n');
            fs.writeFileSync(filename, content, 'utf-8');
            console.log(`Wishlist saved to ${filename} with ${sortedWishlist.length} items`);
        } catch (error) {
            console.error(`Failed to save wishlist to ${filename}:`, error);
        }
    }

    /**
     * 保存已拥有游戏到文件
     */
    async saveOwnedToFile(filename) {
        try {
            // 从 Map 中提取 appid，逆序排序并保存
            const ownedIds = Array.from(this.owned.keys())
                .map(id => parseInt(id))
                .filter(id => !isNaN(id))
                .sort((a, b) => b - a); // 逆序排序
            
            const content = ownedIds.join('\n');
            fs.writeFileSync(filename, content, 'utf-8');
            console.log(`Owned games saved to ${filename} with ${ownedIds.length} items`);
        } catch (error) {
            console.error(`Failed to save owned games to ${filename}:`, error);
        }
    }

    /**
     * 初始化 resolver，构建两个列表
     */
    async initialize() {
        // 首先初始化meta文件
        await this.initializeMeta();
        
        // 首先解析 SteamID
        await this.resolveSteamId();
        
        // 然后并行构建两个列表
        await Promise.all([
            this.buildWishlist(),
            this.buildOwned()
        ]);
        
        console.log(`Resolver initialized: ${this.wishlist.length} wishlist items, ${this.owned.size} owned games`);
        
        // 载入数据库
        await this.database.initialize();
        // 更新日历数据
        if (this.wishlist.length > 0) {
            await this.updateCalendarData();
        }

        this.updateOwnership();
        
        await this.database.save();
    }

    updateOwnership() {
        let owned = []
        let wishlist = []
        let family = []
        this.config.databases.forEach(db => {
            let key = db.source
            switch(db.type) {
                case "SteamWishlist": {
                    if (this.database.dbTrackingSteam[key]) {
                        wishlist = wishlist.concat(this.database.dbTrackingSteam[key])
                    }
                    break;
                }

                case "SteamOwned": {
                    if (this.database.dbTrackingSteam[key]) {
                        owned = owned.concat(this.database.dbTrackingSteam[key])
                    }
                    break;
                }

                case "SteamFamily": {
                    if (this.database.dbTrackingSteam[key]) {
                        family = family.concat(this.database.dbTrackingSteam[key])
                    }
                    break;
                }
            }
        })

        Object.keys(this.database.steamData).forEach(appid => {
            if (this.database.steamData[appid].app_data) {
                this.database.steamData[appid].app_data.owned = false
                this.database.steamData[appid].app_data.wishlist = false
                this.database.steamData[appid].app_data.family = false
            }
        })
        owned.forEach(appid => {
            if (this.database.steamData[appid] && this.database.steamData[appid].app_data) {
                this.database.steamData[appid].app_data.owned = true
            }
        })
        wishlist.forEach(appid => {
            if (this.database.steamData[appid] && this.database.steamData[appid].app_data) {
                this.database.steamData[appid].app_data.wishlist = true
            }
        })
        family.forEach(appid => {
            if (this.database.steamData[appid] && this.database.steamData[appid].app_data) {
                this.database.steamData[appid].app_data.family = true
            }
        })
    }

    /**
     * 检查游戏是否已拥有
     */
    isOwned(gameId) {
        return this.owned.has(gameId.toString());
    }

    async resolveAppidTask(item) {
        const { appid, type: updateType, title: existingTitle } = item;
        
        // try {
            if (updateType === 'initialization') {
                console.log(`[初始化] 获取新游戏数据: AppID ${appid}`);
            } else if (updateType === 'update') {
                console.log(`[更新] 更新游戏数据: AppID ${appid} - "${existingTitle}"`);
            }
            
            let appData = await getAppDataFromAPI(appid, this.steam, this.config);

            if (appData.meta?.error) {
                // 下架游戏？也可能是API错误。尝试获取旧数据
                console.log(`${appid} error, reason: ${appData.meta?.error_reason}`)
                let meta = appData.meta
                if (this.database.steamData[appid]) {
                    appData = this.database.steamData[appid]
                    appData.meta = meta
                    console.log("Fallback to existed data")
                }
            }
            
            if (appData) {
                const calendarData = getCalendarData(appData, this.config);
                
                // 更新owned状态
                if (calendarData.app_data && this.owned.has(appid.toString())) {
                    calendarData.app_data.owned = true;
                }

                // 更新last_track_date为当前日期
                if (calendarData.meta) {
                    calendarData.meta.last_track_date = this.getCurrentDateString();
                }

                // 添加到steamData
                this.database.updateSteam(appid, calendarData)
                
                if (appData.meta?.error) {
                    if (appData.title) {
                        console.log(`[${updateType === 'initialization' ? '初始化' : '更新'}] 失败: AppID ${appid} - ${appData.title} - 无数据返回，采用旧数据`);
                    } else {
                        console.log(`[${updateType === 'initialization' ? '初始化' : '更新'}] 失败: AppID ${appid} - 无数据返回，记录错误信息`);
                    }
                } else if (updateType === 'initialization') {
                    console.log(`[初始化] 成功: AppID ${appid} - "${appData.name}"`);
                } else if (updateType === 'update') {
                    if (existingTitle != appData.name) {
                        console.log(`[更新] 成功: AppID ${appid} - "${existingTitle}" -> "${appData.name}"`);
                    } else {
                        console.log(`[更新] 成功: AppID ${appid} - "${appData.name}"`);
                    }
                }
                
                let succ = true
                if (appData.meta?.error) {
                    succ = false
                }
                return { success: succ, appid, data: calendarData, type: updateType };
            } else {
                console.log(`[${updateType === 'initialization' ? '初始化' : '更新'}] 失败: AppID ${appid} - 无数据返回`);
                return { success: false, appid, error: 'No data returned', type: updateType };
            }
        // } catch (error) {
        //     console.error(`[${updateType === 'initialization' ? '初始化' : '更新'}] 错误: AppID ${appid} - ${error.message}`);
        //     return { success: false, appid, error: error.message, type: updateType };
        // }
    }

    /**
     * 为wishlist中的appid获取详细数据并构建日历数据
     */
    async updateCalendarData() {
        console.log(`Updating calendar data from wishlist`);
        
        if (this.wishlist.length === 0) {
            console.log('Wishlist is empty, skipping calendar data build');
            return;
        }

        // 获取需要处理的appid列表
        const appidsToProcess = this.database.getSteamAppIDToProcess();
        
        if (appidsToProcess.length === 0) {
            console.log('No appids need to be processed');
            return;
        }

        // 输出详细的处理计划
        console.log(`\n=== Summary ===`);
        console.log(`Total ${appidsToProcess.length} games`);
        
        // 按类型分组显示
        const initializationAppids = appidsToProcess.filter(item => item.type === 'initialization');
        const updateAppids = appidsToProcess.filter(item => item.type === 'update');
        
        if (initializationAppids.length > 0) {
            console.log(`\nInit ${initializationAppids.length} games:`);
            console.log(`  - AppID: ${initializationAppids.map(x=>x.appid).join(", ")}`);
        }
        
        if (updateAppids.length > 0) {
            console.log(`\nUpdate ${updateAppids.length} games:`);
            updateAppids.forEach(item => {
                console.log(`  - AppID: ${item.appid} - "${item.title}"`);
            });
        }
        
        console.log(`\n=== 开始处理 ===`);

        // 并发执行函数
        const runWithConcurrency = async (items, concurrency, delay) => {
            const allResults = [];
            let currentIndex = 0;

            while (currentIndex < items.length) {
                const end = Math.min(currentIndex + concurrency, items.length);
                const promises = items.slice(currentIndex, end).map(async (item) => this.resolveAppidTask(item));

                const results = await Promise.all(promises);
                allResults.push(...results);
                currentIndex = end;

                // 进行延迟
                if (currentIndex < items.length) {
                    console.log(`等待 ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            return allResults;
        };

        // 等待所有处理完成
        const results = await runWithConcurrency(appidsToProcess, 50, 1000);
        
        // 统计成功和失败的数量，按类型分组
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        const successfulInit = successful.filter(r => r.type === 'initialization');
        const successfulUpdate = successful.filter(r => r.type === 'update');
        const failedInit = failed.filter(r => r.type === 'initialization');
        const failedUpdate = failed.filter(r => r.type === 'update');
        
        console.log(`\n=== 处理结果统计 ===`);
        console.log(`初始化类型: ${successfulInit.length} 成功, ${failedInit.length} 失败`);
        console.log(`更新类型: ${successfulUpdate.length} 成功, ${failedUpdate.length} 失败`);
        console.log(`总计: ${successful.length} 成功, ${failed.length} 失败`);

        console.log(`\n=== 处理完成 ===`);
        return;
    }
}
