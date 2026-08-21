# Security Policy

Chinese version: [SECURITY.zh-CN.md](SECURITY.zh-CN.md).

## Supported versions

Only the latest stable release is supported. Before reporting an issue, confirm that it can be reproduced with the latest artifact published in GitHub Releases.

## Reporting a vulnerability privately

Do not publish vulnerability details, credentials, personal data, or directly exploitable reproduction material in a public Issue.

Use **Security > Report a vulnerability** in the GitHub repository to submit a private report. Please include:

- affected RandDeck version
- Windows version and architecture
- reproducible steps
- impact and expected behavior
- temporary mitigations already taken

Ordinary feature defects and visual issues can be reported through a public Issue after removing private data.

## Privacy boundary

RandDeck is designed for offline local operation. Do not attach `%APPDATA%\com.zhishutai.desktop\state-v5.json`, backup files, screenshots containing personal data, PDB files, or local logs unless they have been reviewed and sanitized.
