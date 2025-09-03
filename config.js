export default  {
  languageOption: "schinese",
  languageString: [ "简体中文", "Chinese" ],
  countryCode: "us",

  proxy: "",

  meta: "meta.json",
  database: "database.json",
  databases: [
    {
      source: "list.txt",
      output: "events.json",
      deleted: "deleted.json"
    },
    {
      type: "SteamWishlist",
      source: "wishlist.txt",
      output: "wishlist.json",
      deleted: "wishlist_deleted.json"
    },
    {
      type: "SteamOwned",
      source: "owned.txt",
      output: "owned.json",
    },
    {
      type: "SteamFamily",
      source: "family.txt",
      output: "family.json",
    },
  ],

  recent: {
    forceUpdate: true,
    past: -14,
    future: 30,
  },
  ratelimit: {
    init: 40,
    update: 40,
  },
  steam: {

    // User profile ID (if is number), or username
    // https://steamcommunity.com/id/USER_ID/
    // https://steamcommunity.com/profiles/STEAM_ID
    // 76561198171618942 -> https://steamcommunity.com/profiles/76561198171618942
    // LingSamuel -> https://steamcommunity.com/id/LingSamuel/
    user: "LingSamuel",
    // resolve wishlist
    wishlist: true,
    // resolve owned games
    owned: true,
  }
}