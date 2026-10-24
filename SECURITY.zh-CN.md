# 安全说明

English version: [SECURITY.md](SECURITY.md)。

## 维护版本

目前仅维护 GitHub Releases 上最新发布的正式版本。反馈问题前，建议先用最新版确认问题是否仍然存在。

## 私密反馈安全漏洞

如果发现了安全漏洞，请不要直接在公开 Issue 里贴出漏洞细节、利用步骤或包含个人隐私的文件。

请打开仓库顶部的 **Security > Report a vulnerability** 提交私密报告，建议附上：

- 使用的 RandDeck 版本号
- Windows 系统版本
- 复现步骤与实际表现

普通的功能 Bug 或界面细节问题，在隐去个人信息后直接提公开 Issue 即可。

## 本地隐私提醒

RandDeck 全程单机离线运行。提 Issue 或贴截图时，请注意不要顺手上传本机存档文件（`%APPDATA%\com.zhishutai.desktop\state-v5.json`）、含私人名单的备份文件或带本机路径的日志。
