# Security Policy

Chinese version: [SECURITY.zh-CN.md](SECURITY.zh-CN.md).

## Supported versions

Only the latest release on GitHub Releases is actively maintained. Please verify that the issue still occurs on the latest version before reporting.

## Reporting a vulnerability privately

Please do not post security vulnerabilities, exploit details, or personal data in public GitHub Issues.

Instead, use **Security > Report a vulnerability** on this repository to open a private advisory. Helpful details include:

- RandDeck version
- Windows version
- Steps to reproduce and what happens

Regular bugs or UI suggestions can be opened as normal public Issues once any personal data is removed.

## Local data reminder

RandDeck runs offline and stores everything locally. When filing an Issue, avoid attaching your raw state file (`%APPDATA%\com.zhishutai.desktop\state-v5.json`), backups containing private name lists, or unsanitized logs.
