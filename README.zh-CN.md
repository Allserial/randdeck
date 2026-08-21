# RandDeck / 掷数台

RandDeck（掷数台）是面向 Windows 11 x64 的离线随机抽取工作台，使用 React、TypeScript、Vite、Tauri 2 和 Rust 构建。随机结果在本地使用 Web Crypto 生成，不使用远程字体、网络 API、账户、遥测或自动更新。

English documentation: [README.md](README.md)。

![RandDeck 界面](docs/images/掷数台界面.png)

## 主要功能

- 范围池、自定义数字池和骰子表达式
- 整数、闭区间、奇数、偶数排除规则与“抽后移除”
- Web Crypto 无偏随机，生成动画不参与结果计算
- 单项选择、局部重掷、固定结果、加入排除和事务撤销
- 三种模式分别记忆抽取数量
- `Space`、`Enter` 和 `Shift+Space` 快捷生成及倒计时
- 历史记录、频次、覆盖率、趋势和概率分析
- JSON、CSV、PNG、审计回执和完整备份
- 深色、浅色、高对比主题与减少动态效果支持
- 完全离线运行，数据保存在本机

## 下载

请从 [GitHub Releases](https://github.com/Allserial/randdeck/releases) 下载：

- `RandDeck.exe`：单文件便携版，目标电脑需要已有 Microsoft Edge WebView2 Runtime。
- `RandDeck-v0.6.0-portable.zip`：多文件便携包，包含中英文说明、许可证、清单和 SHA256 校验文件。
- `RandDeck-v0.6.0-offline-setup.exe`：离线安装程序，内置 WebView2 安装能力。

当前版本未进行代码签名，Windows SmartScreen 可能显示“未知发布者”。运行前请核对发布页提供的 SHA256 值。

## 本地开发

环境要求：Node.js 24 LTS、npm 11、Rust stable、Microsoft C++ Build Tools 和 WebView2 Runtime。

```powershell
git clone https://github.com/Allserial/randdeck.git
Set-Location .\randdeck
npm install
npm run dev
```

浏览器默认访问 `http://localhost:5173/`。

常用质量检查：

```powershell
npm run i18n:verify
npm run icons:verify
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Tauri 开发与构建：

```powershell
npm run tauri:dev
npm run tauri:build:portable
npm run tauri:build:offline
```

## 本地数据与兼容性

- Tauri 状态文件：`%APPDATA%\com.zhishutai.desktop\state-v5.json`
- 浏览器调试版：IndexedDB `zhishutai-v5`
- 备份格式：`zhishutai.backup.v5`
- 回执和发布 schema 继续使用 `zhishutai.*` 命名空间

这些内部标识为了让 v0.5.0 原地升级时继续读取已有数据而保持不变。它们是兼容性标识，不是公开产品名。应用不会上传这些数据。迁移电脑或卸载前，请在“设置”中导出完整 JSON 备份。

## 安全与隐私

仓库不应包含真实账号、邮箱、令牌、私钥、本机绝对路径、应用数据或个人测试记录。安全问题请按照 [SECURITY.md](SECURITY.md) 使用 GitHub 的私密安全报告渠道。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方依赖仍分别遵循各自许可证，正式发布包附带依赖许可证清单。
