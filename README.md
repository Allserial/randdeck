# RandDeck

RandDeck is an offline random draw workbench for Windows 11 x64. It is built with React, TypeScript, Vite, Tauri 2, and Rust. Results are generated locally with Web Crypto; the application does not use remote fonts, network APIs, accounts, telemetry, or automatic updates.

Chinese documentation: [README.zh-CN.md](README.zh-CN.md). Product name in Chinese: **掷数台**.

![RandDeck interface](docs/images/掷数台界面.png)

## Features

- Range pools, custom number pools, and dice expressions
- Integer, interval, odd, and even exclusion rules with draw-and-remove mode
- Unbiased local Web Crypto randomness; animation never determines the result
- Selective rerolls, fixed results, exclusion shortcuts, and transaction undo
- Independent draw-count memory for each mode
- Countdown generation with `Space`, `Enter`, and `Shift+Space`
- History, frequency, coverage, trend, and probability analysis
- JSON, CSV, PNG receipts, audit receipts, and full backups
- Dark, light, and high-contrast themes with reduced-motion support
- Fully offline local storage

## Downloads

Download releases from [GitHub Releases](https://github.com/Allserial/randdeck/releases):

- `RandDeck.exe`: single-file portable build; Microsoft Edge WebView2 Runtime must already be installed.
- `RandDeck-v0.6.0-portable.zip`: multi-file portable package with bilingual documentation, license, manifest, and SHA256 checksums.
- `RandDeck-v0.6.0-offline-setup.exe`: offline installer with WebView2 installation support.

The release is not code-signed. Windows SmartScreen may show an unknown-publisher warning. Verify the published SHA256 value before running an artifact.

## Local development

Requirements: Node.js 24 LTS, npm 11, stable Rust, Microsoft C++ Build Tools, and WebView2 Runtime.

```powershell
git clone https://github.com/Allserial/randdeck.git
Set-Location .\randdeck
npm install
npm run dev
```

The browser development URL is `http://localhost:5173/`.

Common checks:

```powershell
npm run i18n:verify
npm run icons:verify
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Tauri development and builds:

```powershell
npm run tauri:dev
npm run tauri:build:offline
npm run tauri:build:portable
```

## Local data and compatibility

- Tauri state: `%APPDATA%\com.zhishutai.desktop\state-v5.json`
- Browser debugging state: IndexedDB database `zhishutai-v5`
- Backup format: `zhishutai.backup.v5`
- Receipt and release schema identifiers continue to use the `zhishutai.*` namespace.

These internal identifiers are deliberately unchanged so existing v0.5.0 installations can upgrade without losing data. They are compatibility identifiers, not the public product name. The application does not upload this data. Export a full backup in Settings before moving or uninstalling the application.

## Security and privacy

The repository must not contain real credentials, private keys, local absolute paths, application data, or personal test records. See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

RandDeck is released under the [MIT License](LICENSE). Third-party dependencies retain their own licenses; release packages include a dependency license report.
