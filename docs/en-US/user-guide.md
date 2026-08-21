# RandDeck User Guide

## Install

Use `RandDeck.exe` for a portable launch when WebView2 Runtime is already installed. Use `RandDeck-v0.6.0-offline-setup.exe` when the target computer may need the bundled offline WebView2 installer. The multi-file ZIP should be extracted before launching.

Before running a downloaded artifact, compare its SHA256 value with the GitHub Release. The application is currently unsigned, so Windows SmartScreen may show an unknown-publisher warning.

## Language

Open **Settings** and choose **简体中文** or **English**. The change is immediate and is stored locally. Existing v0.5.0 data defaults to Simplified Chinese when it has no locale field.

## Draw modes

- **Range pool**: choose the minimum and maximum values.
- **Custom pool**: enter individual integer values.
- **Dice expression**: enter an expression such as `2d6+3`.

Set the draw count, exclusion rules, and **draw and remove** before generating. `Space` and `Enter` generate immediately. `Shift+Space` starts the configured countdown.

## Results and history

Select result cards for selective rerolls, fixed results, or adding values to the exclusion rule. Undo a draw from the result controls when the complete transaction must be reverted. History and statistics are independent: clearing history also clears the result stage, but does not clear the statistics ledger.

## Data and compatibility

RandDeck stores data locally. Tauri uses `%APPDATA%\com.zhishutai.desktop\state-v5.json`; browser debugging uses IndexedDB `zhishutai-v5`; backups use `zhishutai.backup.v5`. These `zhishutai.*` identifiers are retained for upgrade compatibility and are not the public product name.

Use **Settings > Export backup** before moving or uninstalling the application. Restore a backup only after reviewing its summary.
