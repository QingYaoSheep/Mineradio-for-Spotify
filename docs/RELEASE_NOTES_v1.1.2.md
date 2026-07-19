# Mineradio for Spotify v1.1.2

Mineradio 正式更名为 **Mineradio for Spotify**。本版本将 Spotify 当前播放、系统音频可视化、逐字歌词和 3D 音乐舞台整合为完整体验。

## 主要更新

- 新增 Spotify PKCE 登录、Token 自动刷新、当前播放同步和播放控制；无需 Client Secret，refresh token 使用 Electron `safeStorage` 加密保存。
- Spotify 个人歌单接入侧边栏与 3D 歌单架。
- Spotify 模式使用系统桌面音频捕获驱动粒子视觉和电影镜头。
- QQ 音乐歌词源最高优先，支持 QRC 逐字时间轴；网易云仅在 QQ 无可靠匹配时提供逐行歌词。
- 优化原唱/版本匹配，支持手动选择歌词、全局与单曲延迟、100MB 本地 LRU 歌词缓存。
- 修复空翻译占位、片头创作者信息、卡拉 OK 高亮和长间奏呼吸点表现。

## 升级兼容

虽然显示名称和安装包名称已更新，但应用继续使用原有 `Mineradio.exe`、应用 ID、安装目录和用户数据目录。已有 Mineradio 用户可直接覆盖安装，网易云、QQ 音乐及其它设置不会因改名迁移到新目录。

为消除旧版凭据落盘风险，首次启动会清除遗留的 Spotify Client Secret、明文 Token 和旧 `.spotify-auth`。Spotify 用户需要只填写公开 Client ID，并重新完成一次 PKCE 授权。

## 安装

下载并运行：

`Mineradio-for-Spotify-1.1.2-Setup.exe`

可使用 `Mineradio-for-Spotify-1.1.2-SHA256SUMS.txt` 校验安装包。`Source code`、`.blockmap` 和 `latest.yml` 不是供普通用户直接安装的文件。

> `v1.0.10` 及更早旧安装包不再建议安装或传播，请继续隔离这些历史 `.exe` 文件。

## 第三方平台说明

Mineradio for Spotify 不是 Spotify、网易云音乐、QQ 音乐或腾讯音乐娱乐集团的官方客户端，也不受这些平台认可或赞助。请遵守相应服务条款、版权规则和会员权益规则。
