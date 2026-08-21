# 更新日志

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
