# Games Calendar

[![Daily Update](https://github.com/gamescalendar/gamescalendar.github.io/actions/workflows/update.yaml/badge.svg)](https://github.com/gamescalendar/gamescalendar.github.io/actions/workflows/update.yaml)

## 添加记录

往 `list.txt` 内写入即可。一行一条记录，支持 Steam APPID 与 Steam Store 商店页链接。

点击该链接即可：https://github.com/gamescalendar/gamescalendar.github.io/edit/master/list.txt

## 覆盖记录

在 `override.json` 中的特定字段将会覆盖自动拉取的字段。包括：`start`, `app_data.owned`。

## 静态记录

在 `static.json` 中记录即可。

## 获取 Steam 家庭组共享的游戏

API 合集地址：https://steamapi.xpaw.me

1. 获取 Access Key：

https://store.steampowered.com/pointssummary/ajaxgetasyncconfig

2. 获取 Family Group ID：

API 地址：https://steamapi.xpaw.me/#IFamilyGroupsService/GetFamilyGroupForUser

需要填写 Access Key，Steam ID

3. 获取 Shared Library

API 地址：https://steamapi.xpaw.me/#IFamilyGroupsService/GetSharedLibraryApps

需要填写 Access Key，Steam ID，Family Group ID

4. 将导出的 JSON 写入文件

运行：

```bash
node ./family_shared_toappid.js ./family_shared.json > family.txt
```

## 评论相关的一些 API

https://store.steampowered.com/appreviewhistogram/1771300?l=english

https://store.steampowered.com/apphoverpublic/1771300?review_score_preference=1&l=schinese

## 其他 API 文档

https://steamapi.xpaw.me/

https://github.com/Revadike/InternalSteamWebAPI/wiki
