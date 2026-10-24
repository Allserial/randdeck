# 更新日志 (Changelog)

## 0.7.0 - 2026-10-25

### English

- **Visual Re-forge**: Redesigned the workbench around an integrated sunken astrolabe stage, dark/light/high-contrast themes, and custom arrowless brass scrollbars.
- **Proportional High-DPI Scaling**: Result cards now scale proportionally with the stage container so maximizing the window never stretches card aspect ratios.
- **Batch Notes**: Right-click any item in Recent Batches or click `+ Note` on the stage bar to label draws and search them in Data Insights.
- **Ceremony Controls**: Added an expandable Ceremony sub-panel in Settings (`3s`/`5s`/`10s` countdowns, card-by-card sequential reveal toggle, and particle effects toggle); new installs default to Standard motion.
- **Native Web Audio Engine**: Replaced harsh WAV loops and `tone` synths with pure Web Audio API harmonic synthesis (warm countdown pulse, brass ratchet clicks, and multi-bounce dice hits).
- **High-Contrast App Icon**: New dark-obsidian and luminous gold astrolabe icon for clear visibility on dark Windows taskbars.

### 中文

- **工作台视觉重铸**：采用一体式下沉星盘大舞台、深邃墨蓝 / 暖灰浅色 / 高对比三套主题，以及无上下箭头的星盘黄铜细滚动条。
- **大窗口等比缩放**：无论窗口如何拉伸或最大化，结果卡牌始终按原始黄金宽高比等比缩放，彻底解决宽屏拉伸变形问题。
- **批次备注与搜索**：支持在“最近批次”右键或点击舞台底栏 `+ 备注` 为抽取结果写备注，并在“数据洞察”中按备注实时筛选。
- **仪式动效子面板**：在设置中选中“仪式”时展开专属配置（`3s`/`5s`/`10s` 倒计时等宽切换、逐个揭示开关、仪式粒子效果开关），首次安装默认启用“标准”动效。
- **原生泛音音效重做**：用原生 Web Audio API 重新合成温润的倒计时心跳脉冲、黄铜棘轮机械音与骰子桌面弹跳声，移除 `tone` 依赖，单文件体积缩减约 40%。
- **暗金高对比图标**：更换深曜石底配流金星盘图标，在深色模式与 Windows 黑色任务栏下清晰醒目。

## 0.6.0 - 2026-08-21

### English

- Added English / Simplified Chinese UI switching in Settings with bundled offline translations.
- Unified public release filenames under `RandDeck` while keeping `zhishutai.*` local storage paths so existing v0.5.0 data upgrades seamlessly.
- Added bilingual user guides, security policy, portable ZIP bundle, and CI E2E checks.

### 中文

- 新增中英文界面实时切换，翻译资源全部随程序离线打包。
- 对外英文名与安装包统一为 `RandDeck`，同时保留 `zhishutai.*` 本地存档标识，从 v0.5.0 升级不丢数据。
- 补充中英文说明文档、安全说明、便携压缩包及自动化端到端测试。

## 0.5.0 - 2026-08-21

- 重新整理抽取台布局，范围池、自定义池和骰子表达式各自独立记忆抽取个数。
- 新增结果卡片固定、局部重掷、一键加入排除和整笔撤销。
- 支持快捷倒计时生成，更换本地主题与音效，状态存档升级至 v5。

## 0.4.0

- 优化 2D 工作台界面与独立展示窗口体验。

## 0.3.0

- 重构为 TypeScript 架构，新增抽取撤销、会话管理、审计回执与概率计算。

## 0.2.0

- 新增骰子表达式、标签分组、带权重自定义池和频次统计。

## 0.1.0

- 首个基于 Tauri + React 的 Windows 桌面版本。
