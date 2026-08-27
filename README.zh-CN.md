# 掷数台

在 Windows 上抽数字、从自己写的名单里抽，或者掷骰子。完全离线，不需要账号，也不联网。Windows 11 x64。

软件英文名是 RandDeck。English documentation: [README.md](README.md)。

![掷数台界面](docs/images/掷数台界面.png)

## 能做什么

- 按范围抽、从自定义名单抽，或者掷骰子（比如 `2d6+3`）
- 可以排除某个数、一段区间、奇数或偶数；也可以抽完就从池子里拿走
- 数字在这台电脑上生成，动画只是看着热闹
- 可以只重掷选中的结果、把某个结果固定住、把数字加进排除，或者撤销上一次抽取
- 三种模式各自记住你上次抽几个
- `Space` / `Enter` 立刻抽；`Shift+Space` 先倒计时再抽
- 有历史记录，也能看频次、覆盖、趋势和概率
- 能导出 JSON、CSV、PNG，也能在设置里做完整备份
- 深色、浅色、高对比主题，还可以减少动画
- 设置里可以把整个界面换成中文或英文
- 没有账号、不上报使用数据、不自动更新、也不上云。数据只在本机。

## 下载

从 [GitHub Releases](https://github.com/Allserial/randdeck/releases) 下载：

- `RandDeck.exe`：一个文件就能用。电脑上要已经装好 Microsoft Edge WebView2 Runtime。
- `RandDeck-v0.6.0-portable.zip`：解压后用。里面有说明、许可证、清单和 SHA256。
- `RandDeck-v0.6.0-offline-setup.exe`：安装包。电脑没有 WebView2 时，它可以帮你装。

这个版本没做代码签名。Windows SmartScreen 可能会提示「未知发布者」。运行前请核对发布页上的 SHA256。

## 本地开发

需要 Node.js 24 LTS、npm 11、Rust stable、Microsoft C++ Build Tools 和 WebView2 Runtime。

```powershell
git clone https://github.com/Allserial/randdeck.git
Set-Location .\randdeck
npm install
npm run dev
```

浏览器默认打开 `http://localhost:5173/`。

常用检查：

```powershell
npm run i18n:verify
npm run icons:verify
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Tauri 开发和打包：

```powershell
npm run tauri:dev
npm run tauri:build:offline
npm run tauri:build:portable
```

## 本机数据和兼容

- Tauri 状态文件：`%APPDATA%\com.zhishutai.desktop\state-v5.json`
- 浏览器调试版：IndexedDB `zhishutai-v5`
- 备份格式：`zhishutai.backup.v5`
- 回执和发布 schema 继续用 `zhishutai.*` 命名空间

这些内部名字是故意没改的，这样从 v0.5.0 升上来不会丢数据。它们不是对外产品名。应用不会上传这些数据。换电脑或卸载前，请在「设置」里导出完整备份。

## 安全

仓库里不要放真实账号、令牌、私钥、本机绝对路径、应用数据或个人测试记录。安全问题请按 [SECURITY.md](SECURITY.md) 用 GitHub 的私密渠道报告。

## 许可证

本项目使用 [MIT License](LICENSE)。第三方依赖各自有自己的许可证，正式发布包里会附一份依赖许可证清单。
