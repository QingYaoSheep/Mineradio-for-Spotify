# Better Radio 发布流程

## v2.0.0 发布边界

- 正式名称：**Better Radio**。
- 产品定位：为 Spotify 专门打造的舞台粒子效果视觉歌词显示器。
- Better Radio 是独立应用，不覆盖或读取 Mineradio：使用 `com.betterradio.desktop`、`Better Radio.exe`、独立安装目录、登录分区和 `%APPDATA%\Better Radio`。
- GitHub 仓库继续使用 `QingYaoSheep/Mineradio-for-Spotify`；仓库名称不影响应用系统身份。
- 从当前 Git 工作区源码全新构建，不复用旧 `dist/` 安装包。

## 发布前检查

1. 确认 `package.json` 与 `package-lock.json` 均为 `2.0.0`。
2. 确认 productName、窗口、安装器、快捷方式与发布资产均为 Better Radio。
3. 确认 appId、用户数据目录、安装目录和登录分区不再与 Mineradio 共享。
4. 确认 `.cookie`、`.qq-cookie`、Spotify/Apple Music Token、`updates/`、`node_modules/` 和旧 `dist/` 没有进入 Git。
5. 运行 `git diff --check`、JS 语法检查、`npm run verify:release`、AMLL、Apple TTML、Spotify-only、壁纸和性能回归。
6. 执行 `npm run build:win`，只使用新生成的安装包。
7. 对安装包生成 SHA256，并用可用的安全软件扫描。
8. 正式发布前使用真实 Spotify 账号检查授权、重启刷新、播放控制、歌词与粒子舞台。

## GitHub Release

Release tag：`v2.0.0`

Release 标题：`Better Radio v2.0.0`

建议上传资产：

- `dist/Better-Radio-2.0.0-Setup.exe`
- `dist/Better-Radio-2.0.0-Setup.exe.blockmap`
- `dist/latest.yml`
- `dist/Better-Radio-2.0.0-SHA256SUMS.txt`

Release 正文使用 `docs/RELEASE_NOTES_v2.0.0.md`。

应用仍从 `QingYaoSheep/Mineradio-for-Spotify` 的 GitHub Releases latest 检查更新。全部资产上传完成后再标记 latest，避免客户端提前发现不完整版本。
