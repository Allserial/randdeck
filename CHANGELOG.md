# 更新日志

## 0.7.0 - 2026-10-25

### English

- Re-forged the workbench visual architecture with an integrated sunken astrolabe stage, dark/light/high-contrast themes, and custom brass-styled scrollbars.
- Added proportional container-query scaling so result cards maintain their golden aspect ratio across standard and maximized high-DPI windows.
- Added batch notes via right-click context menu on recent batches and quick action bar, synchronized with Data Insights history filtering.
- Upgraded ceremony motion settings with an expandable sub-panel (countdown duration `3s`/`5s`/`10s`, sequential card reveal toggle, and ceremony particle effects toggle) while defaulting first-time installs to Standard motion.
- Rebuilt the audio engine with pure Web Audio API harmonic & physical resonance synthesis (astrolabe countdown pulse, brass ratchet mechanical clicks, and multi-bounce dice acoustics), removing the external `tone` dependency.
- Redesigned the application icon with a dark-obsidian rounded badge and luminous gold astrolabe for high visibility on dark Windows taskbars.

### 中文

- 重铸工作台整体视觉架构：采用一体式下沉星盘大舞台、深邃墨蓝/暖灰浅色/高对比三套主题，以及定制无箭头星盘黄铜细滚动条。
- 新增基于容器查询（Container Queries）的等比流体缩放机制，确保窗口最大化与高分屏下结果卡牌严格保持黄金宽高比。
- 新增历史批次备注功能：支持在“最近批次”右键或通过舞台底栏快捷添加/编辑备注，并在“数据洞察”中实时检索过滤。
- 升级“仪式”动态效果专属子面板（支持 `3s`/`5s`/`10s` 倒计时切换、逐个揭示开关、仪式粒子效果开关），首次启动默认动态效果设为“标准”。
- 基于原生 Web Audio API 物理泛音与共振合成重做音效引擎（星盘低频脉冲倒计时、精密黄铜棘轮机械音、多面骰桌面弹跳序列），移除 `tone` 第三方依赖。
- 重新设计高对比暗金星盘应用图标，大幅提升深色模式与 Windows 黑色任务栏下的辨识度。

## 0.6.0 - 2026-08-21

### English

- Rebranded the public product as RandDeck while retaining `com.zhishutai.desktop`, `zhishutai-v5`, and `zhishutai.*` persistence identifiers for upgrade compatibility.
- Added Simplified Chinese and English UI switching with bundled offline translation resources.
- Renamed the Windows executable and release artifacts to `RandDeck`.
- Added bilingual README, user guide, security policy, portable package contents, and SHA256 validation.
- Added localization, Rust test, and Chromium E2E checks to CI.

### 中文

- 公开产品品牌统一为 RandDeck，同时保留 `com.zhishutai.desktop`、`zhishutai-v5` 和 `zhishutai.*` 持久化标识，保证升级兼容。
- 新增简体中文和 English 切换，翻译资源随程序离线打包。
- Windows 可执行文件和发布产物统一改为 `RandDeck` 命名。
- 新增中英文 README、使用说明、安全策略、便携包内容和 SHA256 校验。
- CI 新增国际化、Rust 测试和 Chromium E2E 检查。

## 0.5.0 - 2026-08-21

- 重组抽取台界面，简化范围池、自定义池和骰子表达式工作流。
- 新增三种模式独立记忆抽取数量、生成前配置摘要和快捷倒计时。
- 改进排除规则，支持一键清空与更明确的候选状态。
- 修复数量步进器遮挡和窄窗口设置面板交互。
- 新增结果固定、局部重掷和仅选中卡片滚动动画。
- 启动时固定进入范围池并清空结果舞台，数据洞察默认进入概览。
- 清空历史时同步清空结果舞台。
- 更新品牌图标、主题颜色、本地音效和离线资源。
- 延续 v1-v4 数据迁移，状态版本升级为 v5。

## 0.4.0

- 完成 2D 工作台视觉与桌面能力优化。

## 0.3.0

- 完成 TypeScript、事务、会话、审计和概率分析架构升级。

## 0.2.0

- 新增骰子表达式、标签、加权池和统计账本。

## 0.1.0

- 首个 Tauri + React Windows 版本。
