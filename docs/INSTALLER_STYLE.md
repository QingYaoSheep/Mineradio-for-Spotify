# Better Radio Installer Style

> 2026-08-13 品牌说明：Better Radio 是与 Mineradio 完全独立的应用，安装器、appId、可执行文件、安装目录、安全标记和用户数据目录均不得复用 Mineradio。

> 已废止的历史规则：旧 `...\Mineradio` 目录、`.mineradio-install-root` 和 Mineradio 注册信息不得被 Better Radio 识别或采用。安装器/卸载器安全修复必须通过完整 NSIS 安装包发布，不使用跨应用快速补丁。

2026-06-22 用户确认保留当前安装包格式。以后发布安装包，默认沿用这套样式和流程，除非用户明确要求重做。

## 视觉方向

- 中文极简安装器。
- 主色：白底 `#FFFFFF`，主文字 `#111217`，弱文字 `#4B5263` / `#6B7280`，蓝色点缀 `#3257F7`。
- 不要再使用红色 MR、深色大卡片、复杂装饰、英文大段说明或黑底黑字。
- 顶部横幅和侧边图保持黑白蓝极简：`build/installerHeader.bmp`、`build/installerSidebar.bmp`。

## 页面结构

- 欢迎页只保留：
  - `BETTER RADIO`
  - `Better Radio`
  - 简短中文说明
  - `默认位置：D:\Better Radio`
- 安装目录页只保留：
  - `选择安装位置`
  - 简短中文说明
  - `安装目录` 输入框
  - `浏览...` 按钮
  - `默认推荐：D:\Better Radio；选盘符会自动建文件夹。`

## 技术边界

- 使用 `build/installer.nsh` 的自定义欢迎页和自定义安装目录页。
- `package.json` 中 `build.nsis.allowToChangeInstallationDirectory` 保持 `false`，使用 Better Radio 独立目录规则。
- 自定义目录页必须保留可编辑输入框和 `浏览...` 按钮。
- 默认路径通过安装器目录策略设置为 `D:\Better Radio`；命令行 `/D=` 参数仍可覆盖。
- 用户选择盘符根目录时，自动补成 `盘符:\Better Radio`。

## 发布前验证

发布前必须本地打开新生成的 `dist\Better-Radio-版本-Setup.exe` 验证：

- 欢迎页显示中文极简样式，默认位置为 `D:\Better Radio`。
- 安装目录页输入框显示 `D:\Better Radio`。
- `浏览...` 按钮能弹出中文文件夹选择窗口。
- 验证时不要点 `安装`，确认后取消退出。

## 2026-06-25 安装安全补充

- 默认安装路径从 `D:\Better Radio` 开始按 D-Z 顺序选择第一个存在的盘；只有电脑不存在任何 D-Z 盘时，才允许默认落到 `C:\Better Radio`。
- 用户手动选择目录时，安装器必须强制落到独立 `Better Radio` 子文件夹；若 D-Z 盘存在，手动选择 C 盘也要阻止。
- 非空且无法识别为 Better Radio 的目录必须阻止安装，避免卸载阶段删除用户其它文件。
- 新安装器只写入 `.better-radio-install-root` 标记；不得识别、采用、删除或修改 `.mineradio-install-root` 及旧 Mineradio 注册信息。
- 新卸载器禁止使用 `RMDir /r $INSTDIR` 删除整个安装根目录，也禁止递归删除 `resources`、`locales` 等应用子目录；只能删除 Better Radio/Electron 顶层已知文件，最后用非递归 `RMDir "$INSTDIR"` 尝试移除空目录。
