# RandDeck

Draw numbers, pick from a list you type in, or roll dice. It runs on Windows 11 x64 and works fully offline — no account, no internet, no auto-update.

Chinese name: **掷数台**. 中文说明：[README.zh-CN.md](README.zh-CN.md).

![RandDeck interface](docs/images/掷数台界面.png)

## What it can do

- Draw from a number range, a custom list, or a dice expression such as `2d6+3`
- Skip one number, a range, odds, or evens; optionally take a number out of the pool after it is drawn
- Numbers are generated on this computer. The animation is only for watching.
- Reroll just the results you select, pin a result so the next draw keeps it, add a number to the skip list, or undo the last draw
- Each mode remembers how many numbers you last asked for
- `Space` or `Enter` draws immediately; `Shift+Space` starts a countdown first
- History, plus frequency, coverage, trend, and probability views
- Export JSON, CSV, or PNG; make a full backup in Settings
- Dark, light, and high-contrast themes; reduced-motion is supported
- Switch the whole UI between Chinese and English in Settings
- No accounts, no telemetry, no auto-update, no cloud. Data stays on this computer.

## Downloads

Get it from [GitHub Releases](https://github.com/Allserial/randdeck/releases):

- `RandDeck.exe`: one file. Microsoft Edge WebView2 Runtime must already be installed.
- `RandDeck-v0.6.0-portable.zip`: unzip and run. Includes docs, license, a manifest, and SHA256 checksums.
- `RandDeck-v0.6.0-offline-setup.exe`: installer. Can install WebView2 if the PC does not have it.

This release is not code-signed. Windows SmartScreen may warn about an unknown publisher. Check the published SHA256 before you run a file.

## Local development

You need Node.js 24 LTS, npm 11, stable Rust, Microsoft C++ Build Tools, and WebView2 Runtime.

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
- Receipt and release schema identifiers still use the `zhishutai.*` namespace.

Those paths and IDs are left as they were so a v0.5.0 install can upgrade without losing data. They are old internal names, not the public product name. Nothing here is uploaded. Export a full backup in Settings before you move or uninstall the app.

## Security

This repo should not contain real credentials, private keys, local absolute paths, application data, or personal test records. To report a vulnerability privately, see [SECURITY.md](SECURITY.md).

## License

RandDeck is released under the [MIT License](LICENSE). Third-party libraries keep their own licenses; release packages include a dependency license report.
