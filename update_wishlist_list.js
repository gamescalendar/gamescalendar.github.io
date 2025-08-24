let wishlist = require("./wishlist.json")

let SteamURL = "https://store.steampowered.com/"
let result = []
wishlist.map(x=>{
    let url = SteamURL + x.storeUrlPath
    let name = x.name
    
    let msg = `${url} // ${name}`
    console.log(msg)
})
