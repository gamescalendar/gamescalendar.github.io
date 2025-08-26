const fs = require('fs');
const steamapi = require('steamapi');
const SteamAPI = steamapi.default || steamapi;
const config = require('../config.js');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { makeRequest } = require('./utils');
const { getAppDataFromAPI, getCalendarData } = require('./steam');

class Resolver {
    constructor(options = {}) {
        this.wishlist = [];
        this.owned = new Map(); // 改为 Map 结构提高查询性能
        this.steam = null;
        this.hasSteamConfig = false;
        this.steamId = null; // 缓存 SteamID
        this.meta = null; // 元数据对象
        this.forceUpdate = options.forceUpdate || false; // 强制更新选项

        this.db = {}
        this.dbTrackingAppids = {}
        this.steamData = {}
        
        // 配置代理
        this.proxy = this.getProxyConfig();
        if (this.proxy) {
            console.log(`Using proxy: ${this.proxy}`);
            // 设置环境变量，让 Steam API 使用代理
            process.env.HTTP_PROXY = this.proxy;
            process.env.HTTPS_PROXY = this.proxy;
        }
        
        // 检查是否有 Steam 配置
        const apiKey = process.env.STEAM_APIKEY;
        const steamUser = config.steam?.user;
        
        if (apiKey && steamUser) {
            this.steam = new SteamAPI(apiKey, {
                language: config.languageOption,
                headers: this.getRequestOptions()
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
        try {
            if (fs.existsSync(config.meta)) {
                const metaContent = fs.readFileSync(config.meta, 'utf-8');
                this.meta = JSON.parse(metaContent);
                console.log(`Meta file loaded: ${config.meta}`);
            } else {
                // 创建新的meta文件
                this.meta = {
                    lastWishlistUpdate: null,
                    lastOwnedUpdate: null,
                    steamId: null,
                };
                await this.saveMeta();
                console.log(`New meta file created: ${config.meta}`);
            }
        } catch (error) {
            console.error(`Failed to initialize meta file: ${error.message}`);
            // 如果加载失败，创建默认的meta对象
            this.meta = {
                lastWishlistUpdate: null,
                lastOwnedUpdate: null,
                steamId: null,
            };
        }
    }

    /**
     * 保存meta文件
     */
    async saveMeta() {
        try {
            const metaContent = JSON.stringify(this.meta, null, 2);
            fs.writeFileSync(config.meta, metaContent, 'utf-8');
        } catch (error) {
            console.error(`Failed to save meta file: ${error.message}`);
        }
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
        if (config.proxy && typeof config.proxy === 'string' && config.proxy.trim() !== '') {
            return config.proxy.trim();
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

        try {
            const steamUser = config.steam.user;
            let userId;
            
            // 规则1: 如果是完整的 steamcommunity.com 链接，直接解析
            if (steamUser.includes('https://steamcommunity.com')) {
                try {
                    console.log(`Calling Steam resolve for URL: ${steamUser}`);
                    userId = await this.steam.resolve(steamUser);
                    console.log(`Resolved Steam URL "${steamUser}" to Steam ID: ${userId}`);
                } catch (error) {
                    console.error(`Failed to resolve Steam URL "${steamUser}":`, error.message);
                    process.exit(1); // 解析失败则报错退出
                }
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
                    try {
                        const customIdUrl = `https://steamcommunity.com/id/${steamUser}/`;
                        console.log(`Calling Steam resolve for custom ID URL: ${customIdUrl}`);
                        userId = await this.steam.resolve(customIdUrl);
                        console.log(`Resolved custom ID "${steamUser}" to Steam ID: ${userId}`);
                    } catch (customError) {
                        console.error(`Failed to resolve both SteamID and custom ID for "${steamUser}":`);
                        console.error(`- SteamID error: ${error.message}`);
                        console.error(`- Custom ID error: ${customError.message}`);
                        process.exit(1); // 两种方式都失败则报错退出
                    }
                }
            }
            // 规则4: 其他情况当作用户自定义ID解析
            else {
                try {
                    const customIdUrl = `https://steamcommunity.com/id/${steamUser}/`;
                    console.log(`Calling Steam resolve for custom ID URL: ${customIdUrl}`);
                    userId = await this.steam.resolve(customIdUrl);
                    console.log(`Resolved custom ID "${steamUser}" to Steam ID: ${userId}`);
                } catch (error) {
                    console.error(`Failed to resolve custom ID "${steamUser}":`, error.message);
                    process.exit(1); // 解析失败则报错退出
                }
            }
            
            this.steamId = userId;
            // 保存SteamID到meta文件
            if (this.meta) {
                this.meta.steamId = userId;
                await this.saveMeta();
            }
            console.log(`SteamID cached: ${this.steamId}`);
            return userId;
        } catch (error) {
            console.error('Failed to resolve SteamID:', error);
            process.exit(1);
        }
    }

    /**
     * 从配置文件中的数据库源文件构建 wishlist
     */
    async buildWishlist() {
        this.wishlist = [];
        
        // 查找 SteamWishlist 类型的数据库
        const steamWishlistDb = config.databases.find(db => db.type === 'SteamWishlist');
        
        if (steamWishlistDb && this.hasSteamConfig && config.steam?.wishlist) {
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
        const countryCode = config.steam.countryCode || 'US';
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
        
        for (const db of config.databases) {
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
                this.dbTrackingAppids[db.source] = lines
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
        
        if (!config.steam.owned) {
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
            const steamOwnedDb = config.databases.find(db => db.type === 'SteamOwned');
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
        
        for (const db of config.databases) {
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
                this.dbTrackingAppids[db.source] = lines
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
        await this.loadCalendarData();
        // 更新日历数据
        if (this.wishlist.length > 0) {
            await this.updateCalendarData();
        }
    }

    /**
     * 检查游戏是否已拥有
     */
    isOwned(gameId) {
        return this.owned.has(gameId.toString());
    }

    async loadCalendarData() {
        // 加载所有数据库的输出文件
        for (const db of config.databases) {
            if (db.output && fs.existsSync(db.output)) {
                try {
                    const content = fs.readFileSync(db.output, 'utf-8');
                    const data = JSON.parse(content);
                    
                    this.db[db.output] = data
                    // 如果还没有数据，或者这个版本更新，则使用这个版本
                    if (data.steam && typeof data.steam === 'object') {
                        Object.keys(data.steam).forEach(appid => {
                            const appData = data.steam[appid];
                            
                            if (!this.steamData[appid] || this.isNewerVersion(appData, this.steamData[appid])) {
                                this.steamData[appid] = appData;
                            }
                        });
                    }
                    
                    console.log(`Loaded existing data from ${db.output}`);
                } catch (error) {
                    console.error(`Failed to load data from ${db.output}:`, error.message);
                }
            }
        }

        console.log(`Loaded ${Object.keys(this.steamData).length} unique steam apps from all databases`);
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
        const appidsToProcess = this.getAppidsToProcess();
        
        if (appidsToProcess.length === 0) {
            console.log('No appids need to be processed');
            return;
        }

        // 输出详细的处理计划
        console.log(`\n=== 处理计划 ===`);
        console.log(`总计需要处理 ${appidsToProcess.length} 个appid`);
        
        // 按类型分组显示
        const initializationAppids = appidsToProcess.filter(item => item.type === 'initialization');
        const updateAppids = appidsToProcess.filter(item => item.type === 'update');
        
        if (initializationAppids.length > 0) {
            console.log(`\n初始化类型 (${initializationAppids.length} 个):`);
            initializationAppids.forEach(item => {
                console.log(`  - AppID: ${item.appid} (新游戏)`);
            });
        }
        
        if (updateAppids.length > 0) {
            console.log(`\n更新类型 (${updateAppids.length} 个):`);
            updateAppids.forEach(item => {
                console.log(`  - AppID: ${item.appid} - "${item.title}" (已有数据，需要更新)`);
            });
        }
        
        console.log(`\n=== 开始处理 ===`);

        // 并行处理所有appid
        const processPromises = appidsToProcess.map(async (item) => {
            const { appid, type: updateType, title: existingTitle } = item;
            
            // try {
                if (updateType === 'initialization') {
                    console.log(`[初始化] 获取新游戏数据: AppID ${appid}`);
                } else if (updateType === 'update') {
                    console.log(`[更新] 更新游戏数据: AppID ${appid} - "${existingTitle}"`);
                }
                
                const appData = await getAppDataFromAPI(appid, this.steam);
                
                if (appData) {
                    const calendarData = getCalendarData(appData);
                    
                    // 更新owned状态
                    if (this.owned.has(appid.toString())) {
                        calendarData.app_data.owned = true;
                    }

                    // 更新last_track_date为当前日期
                    if (calendarData.meta) {
                        calendarData.meta.last_track_date = this.getCurrentDateString();
                    }

                    // 添加到steamData
                    this.steamData[appid] = calendarData;
                    
                    if (updateType === 'initialization') {
                        console.log(`[初始化] 成功: AppID ${appid} - "${appData.name}"`);
                    } else if (updateType === 'update') {
                        console.log(`[更新] 成功: AppID ${appid} - "${existingTitle}" -> "${appData.name}"`);
                    }
                    
                    return { success: true, appid, data: calendarData, type: updateType };
                } else {
                    console.log(`[${updateType === 'initialization' ? '初始化' : '更新'}] 失败: AppID ${appid} - 无数据返回`);
                    return { success: false, appid, error: 'No data returned', type: updateType };
                }
            // } catch (error) {
            //     console.error(`[${updateType === 'initialization' ? '初始化' : '更新'}] 错误: AppID ${appid} - ${error.message}`);
            //     return { success: false, appid, error: error.message, type: updateType };
            // }
        });

        // 等待所有处理完成
        const results = await Promise.all(processPromises);
        
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

        // 保存更新后的数据到所有配置的输出文件
        await this.saveCalendarDataToOutputs();

        console.log(`\n=== 处理完成 ===`);
        console.log(`日历数据构建完成，总计 ${Object.keys(this.steamData || {}).length} 个游戏`);
        return;
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

    /**
     * 获取需要处理的appid列表
     */
    getAppidsToProcess() {
        let newCount = config.ratelimit.init
        let updateCount = config.ratelimit.update
        
        console.log(`\n=== 速率限制配置 ===`);
        console.log(`初始化限制: ${newCount} 个新游戏`);
        console.log(`更新限制: ${updateCount} 个已有游戏`);
        
        const existingAppids = new Set(Object.keys(this.steamData || {}));
        const wishlistAppids = this.wishlist.map(id => id.toString());
        
        console.log(`\n=== 数据统计 ===`);
        console.log(`愿望单总数: ${wishlistAppids.length} 个游戏`);
        console.log(`本地已有数据: ${existingAppids.size} 个游戏`);
        console.log(`需要初始化的新游戏: ${wishlistAppids.filter(appid => !existingAppids.has(appid)).length} 个`);
        console.log(`可以更新的已有游戏: ${wishlistAppids.filter(appid => existingAppids.has(appid)).length} 个`);
        
        // 初始化：处理本地存档里没有的appid，限制数量
        let newAppids = wishlistAppids.filter(appid => !existingAppids.has(appid)).slice(0, newCount);
        
        // 更新：根据meta.last_track_date排序，取最老的appid，限制数量
        let existingAppidsToUpdate = wishlistAppids.filter(appid => existingAppids.has(appid));
        
        // 按last_track_date排序，最老的在前
        const sortedAppids = existingAppidsToUpdate.sort((a, b) => {
            const aData = this.steamData[a];
            const bData = this.steamData[b];
            
            if (!aData || !aData.meta || !aData.meta.last_track_date) return 1;
            if (!bData || !bData.meta || !bData.meta.last_track_date) return -1;
            
            return new Date(aData.meta.last_track_date) - new Date(bData.meta.last_track_date);
        }).slice(0, updateCount);
        
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
        
        console.log(`\n=== 本次处理计划 ===`);
        console.log(`将处理初始化类型: ${newAppids.length} 个 (限制: ${newCount})`);
        console.log(`将处理更新类型: ${sortedAppids.length} 个 (限制: ${updateCount})`);
        console.log(`总计将处理: ${resultWithType.length} 个游戏`);
        
        return resultWithType
    }



    /**
     * 保存日历数据到所有配置的输出文件
     */
    async saveCalendarDataToOutputs() {
        for (const db of config.databases) {
            if (db.output) {
                let data = this.db[db.output]
                let tracking = this.dbTrackingAppids[db.source]
                if (!tracking) {
                    continue;
                }
                if (!data) {
                    data = {
                        index: 0,
                        steam: {},
                        metacritic: {},
                    } 
                }
                try {
                    tracking.forEach(appid => {
                        if (this.steamData[appid]) {
                            data.steam[appid] = this.steamData[appid]
                        }
                    })
                    const content = JSON.stringify(data, null, 2);
                    fs.writeFileSync(db.output, content, 'utf-8');
                    console.log(`Calendar data saved to ${db.output} (${Object.keys(data.steam || {}).length} steam apps)`);
                } catch (error) {
                    console.error(`Failed to save data to ${db.output}:`, error.message);
                }
            }
        }
    }


}

module.exports = Resolver;
