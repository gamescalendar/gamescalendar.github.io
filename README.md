# Games Calendar

[![Update Games Calendar](https://github.com/gamescalendar/gamescalendar.github.io/actions/workflows/update.yaml/badge.svg)](https://github.com/gamescalendar/gamescalendar.github.io/actions/workflows/update.yaml)

[![Deployment Status](https://github.com/gamescalendar/gamescalendar.github.io/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/gamescalendar/gamescalendar.github.io/actions/workflows/pages/pages-build-deployment)

## 添加记录

往 `list.txt` 内写入即可。一行一条记录，支持 Steam APPID 与 Steam Store 商店页链接。

## 覆盖记录

在 `override.json` 中的特定字段将会覆盖自动拉取的字段。包括：`start`, `app_data.owned`。

## 静态记录

在 `static.json` 中记录即可。
