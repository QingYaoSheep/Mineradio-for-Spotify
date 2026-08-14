# Better Radio v2.0.0

Better Radio 是为 Spotify 专门打造的舞台粒子效果视觉歌词显示器。音乐继续由 Spotify 客户端播放，Better Radio 负责播放同步与控制、桌面音频捕获、逐字歌词和沉浸式粒子舞台。

## 全新独立应用

- 启动界面、窗口、安装器、快捷方式、EXE 元数据和发布资产统一为 Better Radio。
- 使用全新的应用 ID、可执行文件、安装目录、登录分区和用户数据目录。
- 不覆盖、不读取、不迁移、不卸载旧 Mineradio；两个应用可以独立存在。

## Spotify 专属体验

- PKCE 安全授权，不保存 Client Secret。
- 支持当前播放、进度、播放控制、设备、搜索、资料库与 Spotify 歌单。
- Windows 桌面音频驱动粒子、节奏分析和电影镜头。

## Apple Music 风格歌词舞台

- 新增 Apple Music 歌词 Beta 多行显示、未来歌词模糊、拖动浏览、弹簧换行和原生呼吸点。
- 可选 Apple Music TTML 歌词源，支持逐字时间、翻译、背景人声、对唱和重叠歌词。
- QQ QRC 继续提供高优先级逐字歌词，网易云作为逐行兜底。
- 支持歌词选择、全局/单曲延迟、每曲单缓存，以及本地日语/韩语音译。
- 改进重叠高亮、背景人声绝对时钟、韩语词列对齐、长音辉光和提前换行。

## 视觉与性能

- 新增 Sonic Topography 音域回响与第二套音域预设。
- 新增歌词清晰度设置、Wallpaper Engine 本地资源库和安全桌面壁纸模式。
- 队列与搜索结果虚拟化，优化后台节流、内存清理和 AMLL 销毁流程。

## 安全说明

Spotify refresh token 与 Apple Music user token 使用 Electron `safeStorage` 加密；access token 只驻留内存。敏感凭据不会进入前端存储、日志、URL、歌词缓存或仓库。

## 安装

请下载：`Better-Radio-2.0.0-Setup.exe`

`Source code`、`.blockmap`、`latest.yml` 和 `win-unpacked` 不是普通用户安装包。

Better Radio 不是 Spotify、Apple Music、QQ 音乐或网易云音乐的官方客户端。请遵守对应服务条款与版权规则。
