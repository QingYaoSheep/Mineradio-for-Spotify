# Mineradio for Spotify

Mineradio for Spotify 是一款 Windows 桌面 Spotify 遥控器与沉浸式歌词可视化播放器。它将 Spotify 当前播放状态、QQ 音乐优先歌词、逐字卡拉 OK、粒子视觉和 3D 歌单架组合成一个私人音乐舞台。

注意：由于 Spotify 接口限制，启用了 Spotify 模式下的 Mineradio 将变成歌词显示器，音乐将仍由 Spotify 客户端播放！

## 作者支持

[查看完整支持页](./docs/SUPPORT.md)

!\[Mineradio 原作者支持渠道](./docs/assets/support/mineradio-author-support-poster.png)

## 当前版本

当前版本：`1.1.2`

状态：v1.1.2 GitHub 发布候选版。

## 核心特性

* Spotify OAuth 登录、当前播放同步和全局播放控制
* Spotify 个人歌单接入侧边栏与 3D 歌单架
* 系统桌面音频捕获，让视觉效果跟随 Spotify 实际声音
* 接入QQ QRC 逐字歌词，实现真正的卡拉OK歌词
* 歌词搜索选择页、全局/单曲延迟与 100MB 本地歌词缓存
* Open-Meteo 天气电台，根据当前位置、城市和天气 mood 生成更合适的播放队列
* 首页包含天气电台、每日推荐、私人电台、继续听、听歌画像和我的歌单入口
* Wallpaper 银河首页背景，未播放状态保持干净的星河氛围
* 播放后切换到 Emily / 默认播放态视觉，歌词舞台与粒子舞台同步工作
* 基于节奏的电影镜头视觉系统
* 面向长播客和 DJ 曲目的专属视觉模式
* 歌词舞台、自定义歌词、歌词位置与视觉控制
* 自定义专辑封面上传与裁剪
* 右键唤起 3D 歌单架，支持歌单队列浏览
* 网易云音乐账号、搜索、歌单、播客等体验接入
* QQ 音乐搜索、登录态与音源补充接入
* GitHub Releases 更新检测与下载入口
* 首次启动内置「默认测试」视觉用户存档，软件内默认视觉参数与该存档一致

## 使用说明

Windows 用户可以在 GitHub Releases 中下载安装包。

正式分发以 `Mineradio-for-Spotify-1.1.2-Setup.exe` 为准，不建议直接下载 `win-unpacked` 目录作为正式分发包。为兼容旧用户，程序文件仍为 `Mineradio.exe`，安装目录和用户数据目录也保持原路径；窗口、快捷方式和安装器显示新名称。

已经安装过旧版本的用户可以直接运行 v1.1.2 安装包覆盖升级；`v1.0.10` 及更早旧安装包仍应隔离，不要继续传播。

为消除旧版凭据落盘风险，v1.1.2 首次启动会删除遗留的 Spotify Client Secret、明文 Token 和旧 `.spotify-auth`。网易云、QQ 音乐及其它设置仍沿用原用户数据目录；Spotify 用户需要用 Client ID 重新完成一次 PKCE 授权。

## Spotify 配置

1. 在 Spotify Developer Dashboard 创建应用。
2. 将 Redirect URI 设置为 `http://127.0.0.1/api/spotify/callback`（不填写端口；Spotify 允许 loopback IP 在授权请求中使用动态端口）。
3. 在 Mineradio for Spotify 的高级设置中只填写 Client ID，然后完成浏览器 PKCE 授权；桌面应用不需要 Client Secret。

refresh token 由 Electron `safeStorage` 加密后保存在旧用户数据目录的 `.spotify-auth.enc` 中，access token 只驻留主进程内存。Token 不会返回页面，Spotify API 请求统一由仅监听 `127.0.0.1` 的白名单代理发出。

## 开发运行

```bash
npm install
npm start
npm run build:win
```

桌面版入口由 Electron 主进程加载本地服务。`npm run build:win` 会生成 Windows NSIS 安装包，产物位于 `dist/`。

## 第三方音乐平台说明

Mineradio for Spotify 不是 Spotify、网易云音乐、QQ 音乐或腾讯音乐娱乐集团的官方客户端，也不受这些平台认可或赞助。

项目中的第三方平台接入仅用于个人学习、本地客户端体验和用户自有账号的播放辅助。请遵守对应平台的用户协议、版权规则和会员权益规则。项目不会提供绕过付费、绕过会员、破解音质或重新分发音乐内容的能力。

## 用户数据与隐私

登录 Cookie、搜索历史、自定义封面、自定义歌词、节奏分析缓存等数据只应保存在本机用户数据目录或浏览器本地存储中，不应提交到仓库。

更多说明见 [PRIVACY.md](./PRIVACY.md)。

## 致谢

Mineradio 由 XxHuberrr  主要设计与打造。emily 作为早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一，特此感谢。

同时感谢小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦在早期体验、测试反馈和发布准备中的帮助。

## 版权与授权

Copyright (C) 2026 XxHuberrr.

本项目采用 GPL-3.0 授权。详见 [LICENSE](./LICENSE)。

MR Logo、Mineradio 名称、界面视觉设计与原创视觉表达归作者所有；第三方依赖和第三方服务分别遵循其各自授权与服务条款。Spotify 名称与商标归其权利人所有。
