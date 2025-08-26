const fs = require('fs');
const steamapi = require('steamapi');
const SteamAPI = steamapi.default || steamapi;
const config = require('../config.js');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { makeRequest } = require('./utils');

class Resolver {
    constructor() {
        this.wishlist = [];
        this.owned = new Map(); // 改为 Map 结构提高查询性能
        this.steam = null;
        this.hasSteamConfig = false;
        this.steamId = null; // 缓存 SteamID
        
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
            try {
                await this.buildWishlistFromThirdPartyAPI();
                // 保存到文件
                await this.saveWishlistToFile(steamWishlistDb.source);
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
        // 首先解析 SteamID
        await this.resolveSteamId();
        
        // 然后并行构建两个列表
        await Promise.all([
            this.buildWishlist(),
            this.buildOwned()
        ]);
        
        console.log(`Resolver initialized: ${this.wishlist.length} wishlist items, ${this.owned.size} owned games`);
    }

    /**
     * 检查游戏是否已拥有
     */
    isOwned(gameId) {
        return this.owned.has(gameId.toString());
    }
}

module.exports = Resolver;
