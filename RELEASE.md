# Mineradio for Spotify 发布流程

## v1.1.2 发布边界

- `v1.1.2` 是项目正式更名为 **Mineradio for Spotify** 后的首个发布版。
- 从当前 Git 工作区源码重新构建，不复用旧 `dist/` 安装包或历史 packaged build。
- 保留 `com.mineradio.desktop`、`Mineradio.exe`、`D:\Mineradio` 和 `%APPDATA%\Mineradio`，确保旧用户可覆盖升级并保留设置。
- `v1.0.10` 及更早旧安装包继续标记为不可信历史产物，不要重新上传或传播。
- 安装包样式继续沿用 `docs/INSTALLER_STYLE.md` 的中文极简黑白蓝格式。

## 发布前检查

- 确认 `package.json` 和 `package-lock.json` 版本号正确。
- 确认 `mineradio.update.owner/repo` 指向正式仓库。
- 确认 `.cookie`、`.qq-cookie`、`.spotify-auth`、`.spotify-auth.enc`、`updates/`、`node_modules/`、旧 `dist/` 没有进入 git。
- 确认 README/SECURITY/CHANGELOG/Release 正文包含 `v1.0.10` 旧安装包隔离说明。
- 运行语法检查：`git diff --check`、`node --check server.js`、前端内联脚本解析。
- 运行 `npm run verify:release`，验证 PKCE、重启刷新、Spotify 控制代理、退出清理和发布文件边界。
- 运行 Git 跟踪风险残留检查，确认没有跟踪 `.exe/.dll/.scr/.bat/.cmd/.ps1/.vbs/.jse/.wsf/.hta/.xlsm` 等可执行/脚本残留。
- 从当前源码执行 `npm run build:win` 生成 Windows 安装包。
- 对新生成的安装包和当前源码执行安全扫描。
- 生成并记录新安装包 SHA256。
- 自动测试使用模拟 Spotify 上游；正式标记 Release 前，用真实账号完成一次授权、重启后刷新和播放控制冒烟检查。

## GitHub Release

Release tag：

```text
v1.1.2
```

Release 标题：

```text
Mineradio for Spotify v1.1.2
```

建议上传资产：

- `dist/Mineradio-for-Spotify-1.1.2-Setup.exe`
- `dist/Mineradio-for-Spotify-1.1.2-Setup.exe.blockmap`
- `dist/latest.yml`
- `dist/Mineradio-for-Spotify-1.1.2-SHA256SUMS.txt`

Release 正文可直接使用 `docs/RELEASE_NOTES_v1.1.2.md`。

## 更新检测

应用会请求 GitHub Releases latest。上传 v1.1.2 全部资产后再将 Release 标为 latest，避免客户端在 `latest.yml` 和安装包尚未齐全时提前发现更新。

本地验证更新链路时，可以用临时 manifest：

```json
{
  "latestVersion": "1.1.2-test",
  "release": {
    "name": "Mineradio for Spotify v1.1.2-test",
    "downloadUrl": "http://127.0.0.1:3144/Mineradio-for-Spotify-1.1.2-Setup.exe",
    "notes": ["本地在线更新链路测试"]
  }
}
```
