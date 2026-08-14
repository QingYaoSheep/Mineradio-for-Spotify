# Third-party notices

Better Radio 的本地歌词音译功能使用以下开源组件：

- [kuromoji.js](https://github.com/takuyaa/kuromoji.js) — Apache License 2.0。用于日语分词与 IPADIC 读音查询。
- [WanaKana](https://github.com/WaniKani/WanaKana) — MIT License。用于假名到修订式 ASCII Hepburn 罗马字的确定性转换。
- `mecab-ipadic-2.7.0-20070801` — Copyright 2000–2003 Nara Institute of Science and Technology。词典的完整版权、无担保与分发声明随 `kuromoji/NOTICE.md` 一同打包。

各依赖的完整许可证文本与 NOTICE 文件保留在发行包的对应 `node_modules` 目录中。

Apple Music TTML 歌词解析使用 [sax](https://github.com/isaacs/sax-js) 1.6.0（BlueOak-1.0.0）作为流式 XML 解析器。Apple Music 请求路径和临时 Bearer Token 获取方法参考了 GPL-3.0 项目 [zhaarey/apple-music-downloader](https://github.com/zhaarey/apple-music-downloader) 的公开实现；Better Radio 的凭据存储、匹配、解析、缓存和回退代码为本项目独立实现。

视觉层还包含 Mineradio 上游 GPL-3.0 代码中的 `Sonic Topography` 预设。该实现注明其视觉算法移植自
[yin-yizhen/sonic-topography](https://github.com/yin-yizhen/sonic-topography) 1.1.1；本项目继续按
GPL-3.0-only 分发，并保留对应源码与来源说明。

Windows WorkerW 壁纸运行时、Wallpaper Engine 本地安全索引和应用进程工作集清理模块来自
[XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio) 2.0 系列 GPL-3.0-only 源码。本分支只接入
点击穿透壁纸、本地元数据索引和 Better Radio 自身进程清理；不执行导入的 Web/Application 壁纸项目，也不提供系统级内存清理。

## Apple Music 歌词 (Beta)

可选的 Apple Music 多行歌词界面直接依赖
[`@applemusic-like-lyrics/core`](https://github.com/amll-dev/applemusic-like-lyrics/tree/main/packages/core)
0.5.2。该组件由 AMLL contributors 开发，按 **GNU Affero General Public License v3.0 only
(AGPL-3.0-only)** 提供。

Better Radio 在生成浏览器发行文件时会对 AMLL Core 0.5.2 应用一份可审查、可重建的本地源码补丁，
用于分离韩语原词与音译的运动层和遮罩宽度测量。补丁源码位于
`scripts/patch-amll-core-source.js`，构建入口和生成脚本分别位于
`scripts/amll-core-entry.js` 与 `scripts/build-amll-vendor.js`；运行 `npm run build:amll` 即可从
上述 npm 依赖与本地补丁重新生成 `public/vendor/amll-core.bundle.js` 和
`public/vendor/amll-core.css`。补丁后的派生文件继续按 **AGPL-3.0-only** 分发。AMLL Core 的完整许可证文本保留在发行依赖目录
`node_modules/@applemusic-like-lyrics/core/LICENSE` 中，生成文件顶部也保留来源与 SPDX 标识。
