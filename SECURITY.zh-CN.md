# 安全策略

English version: [SECURITY.md](SECURITY.md)。

## 支持版本

当前仅维护最新正式版本。报告问题前，请先确认能在 GitHub Releases 发布的最新 RandDeck 版本中复现。

## 私密报告安全问题

请不要在公开 Issue 中提交漏洞细节、账号信息、令牌、个人数据或可直接利用的复现材料。

请在仓库的 **Security > Report a vulnerability** 中创建私密安全报告。报告建议包含：

- 受影响的 RandDeck 版本
- Windows 版本和架构
- 可复现步骤
- 影响范围和预期行为
- 已采取的临时规避措施

普通功能缺陷和界面问题可以在移除隐私信息后使用公开 Issue 报告。

## 隐私边界

RandDeck 设计为离线本地运行。除非已经审查并清理，否则不要附加 `%APPDATA%\com.zhishutai.desktop\state-v5.json`、备份文件、含个人信息的截图、PDB 文件或本地日志。
