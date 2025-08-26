import SteamAPI from 'steamapi';

const steam = new SteamAPI(process.env.STEAM_APIKEY, {
    language: "schinese"
});

// let SteamID
// steam.resolve('https://steamcommunity.com/id/LingSamuel').then(id => {
//     SteamID = id
// 	console.log(`User id: ${id}`); // 76561198171618942
// }).catch(e => {
//     console.log(e)
// });

// const SteamAppURL = "https://store.steampowered.com/app/"

// let ownedGames = []
// steam.getUserOwnedGames('76561198171618942').then(games => {
// 	// console.log(games);

//     games.forEach(x => {
//         ownedGames.push(x.game.id)
//     })
// });

steam.getGameDetails(1735700).then(result => {
    console.log(result)
}).catch(e => {
    console.log(e)
});

// steam.get("app/1735700", "https://store.steampowered.com/").then(result => {
//     console.log(result)
// }).catch(e => {
//     console.log(e)
// });
