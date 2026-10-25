# 掷数台 (RandDeck)

在 Windows 上抽数字、从自己准备的名单里抽人/抽签，或者投掷多面骰。完全单机离线运行，不用注册账号，也不连任何外网。支持 Windows 11 x64。

English documentation: [README.md](README.md)。

![掷数台界面](docs/images/掷数台界面.png)

## 能做什么

- **三种抽法**：按起止范围抽整数、自己填名单或导入 CSV 抽（支持设置权重与标签分组），或者写 `2d6+3`、`2d20kh1`、`4d6kh3` 这类骰子算式。
- **灵活控场**：可以排除指定数字、区间、奇数或偶数；开启“抽后移除”后，抽过的数字不会重复出现。
- **卡片交互**：抽出来的结果卡片可以点选——只重抽选中的几张、把某张卡片固定留到下一轮、直接加入排除名单，或者一键撤销整次抽取。
- **批次备注与回溯**：每次抽完都能在底栏或右键菜单里写一句备注（比如“一等奖抽签”“先攻检定”），在底部最近批次或“数据洞察”里随时按关键词找回。
- **三种动效模式**：赶时间选“即时”，日常使用选“标准”，需要现场揭晓气氛选“仪式”（可设 3s/5s/10s 倒计时、逐张翻牌揭晓和流金礼花）。
- **独立副屏展示**：支持打开独立展示窗口，可切换普通窗口、外接大屏全屏演示，或无边框桌面置顶透明悬浮。
- **数据洞察与导出**：查看历史记录、频次分布、覆盖进度、走势和理论概率；支持导出 JSON、CSV、PNG 回执图片及完整备份。
- **界面与无障碍**：内置标准墨蓝、暖灰浅色、高对比三套主题，支持大窗口/高分屏等比缩放，可在设置中随时切换简体中文与 English。
- **真正离线**：随机数由本机 Web Crypto 生成，动画只负责视觉表现，不影响结果；不设账号、无遥测、不自动更新、不上云。

## 下载

前往 [GitHub Releases](https://github.com/Allserial/randdeck/releases) 下载最新版：

- `RandDeck.exe`：单文件便携版，双击即用（电脑需自带 Microsoft Edge WebView2 Runtime，Windows 11 默认已内置）。
- `RandDeck-v0.7.1-portable.zip`：完整便携包，解压后使用，内含中英文说明、项目及依赖许可证清单、文件清单和 SHA256 校验值。
- `RandDeck-v0.7.1-offline-setup.exe`：离线安装包，自带 WebView2 离线运行库，支持从旧版直接覆盖升级并保留本机数据。

当前版本未购买商业代码签名证书，Windows SmartScreen 可能会提示“未知发布者”。运行前请核对发布页提供的 SHA256 校验值。

## 本地开发

环境要求：Node.js 24 LTS、npm 11、Rust stable、Microsoft C++ Build Tools 和 WebView2 Runtime。

```powershell
git clone https://github.com/Allserial/randdeck.git
Set-Location .\randdeck
npm install
npm run dev
```

浏览器默认打开 `http://localhost:5173/`。

常用检查命令：

```powershell
npm run i18n:verify
npm run icons:verify
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Tauri 桌面端调试与打包：

```powershell
npm run tauri:dev
npm run tauri:build:offline
npm run tauri:build:portable
```

## 本机数据与旧版兼容

- 桌面版存档位置：`%APPDATA%\com.zhishutai.desktop\state-v5.json`
- 浏览器调试版存档：IndexedDB `zhishutai-v5`
- 备份文件标识：`zhishutai.backup.v5`（回执与发布清单沿用 `zhishutai.*` 内部命名）

保留 `zhishutai.*` 内部路径是为了让老版本（v0.5.0 / v0.6.0）直接升级时不丢历史记录和预设。所有数据只存在你的电脑上，换电脑或重装系统前可以在“设置”里导出完整备份。

## 安全说明

仓库内不包含任何账号、密钥、本机路径或个人数据。如发现安全漏洞，请按 [SECURITY.zh-CN.md](SECURITY.zh-CN.md) 通过 GitHub 私密渠道反馈。

## 许可证

采用 [MIT License](LICENSE) 开源。第三方依赖各自遵循原许可证，发布包内附有完整的依赖许可证清单。
