# 隐私与用户数据说明

Better Radio 是本地桌面应用。项目不应把用户登录状态、Cookie、播放历史、搜索历史、自定义封面、自定义歌词或本地缓存提交到 GitHub。

## 本地数据

应用可能在本机保存以下数据：

- 网易云音乐登录 Cookie
- QQ 音乐登录 Cookie
- Spotify PKCE refresh token（仅以 Electron `safeStorage` 加密形式保存）
- Apple Music `media-user-token`（仅在启用 Apple Music 歌词源后，以 Electron `safeStorage` 加密形式保存）
- 搜索历史
- 自定义专辑封面
- 自定义歌词
- 歌词布局与视觉控制设置
- 本地节奏分析缓存
- 更新安装包下载缓存
- 已采用的 Apple Music 原始明文 TTML 与解析后歌词缓存（不包含任何 Token）

这些数据用于本地体验，不属于开源仓库内容。

## 不应上传的内容

以下内容不应提交到 GitHub：

- `.cookie`
- `.qq-cookie`
- `.spotify-auth`
- `.spotify-auth.enc`
- `.apple-music-lyrics-auth.enc`
- `updates/`
- `node_modules/`
- Electron 打包产物
- 用户上传的本地音乐文件
- 用户账号信息、Cookie、Token、二维码登录状态

## 第三方平台

用户通过 Spotify、Apple Music、网易云音乐、QQ 音乐等第三方平台使用相关功能时，应遵守对应平台的用户协议。Better Radio 不提供绕过付费、绕过会员、破解音质或重新分发音乐内容的能力。

Apple Music 歌词源使用 Apple Music 的非公开接口，要求用户自行提供有效订阅所对应的 User Token。获取到的 TTML 仅保存在本机歌词缓存中供离线重用；清理歌词缓存时会连同对应 TTML 一并删除。
