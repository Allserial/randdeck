# RandDeck User Guide

## Installation & Launch

- **Single-file portable (`RandDeck.exe`)**: Double-click to run directly on any PC with Microsoft Edge WebView2 Runtime installed (included by default on Windows 11).
- **Portable ZIP (`RandDeck-v0.7.0-portable.zip`)**: Extract the entire folder first, then launch `RandDeck.exe`.
- **Offline installer (`RandDeck-v0.7.0-offline-setup.exe`)**: Use this if the target PC might need the bundled offline WebView2 runtime, or if you want desktop/Start Menu shortcuts and seamless in-place upgrades from older versions.

Because the binaries are unsigned, Windows SmartScreen may show an unknown-publisher warning on first launch. Verify the file's SHA256 hash against the GitHub Release page before running.

## Language & Appearance

Open **Settings** from the top bar to switch between **简体中文** and **English**, or choose **Dark**, **Light**, or **High-Contrast** themes.
Motion defaults to **Standard**. For live events, switch to **Ceremony** to unlock the countdown selector (`3s` / `5s` / `10s`), card-by-card sequential reveal toggle, and gold confetti particles.

## Draw Modes

- **Range Pool**: Pick a minimum and maximum integer. Exclude specific numbers, ranges (`1..10`), odds, or evens, and toggle **Draw and remove** for non-repeating draws.
- **Custom Pool**: Enter items manually or import a CSV file, with optional weights and tags for each entry.
- **Dice Expression**: Roll tabletop expressions like `2d6+3`, `2d20kh1` (keep highest), or `4d6kh3`. Cards display the total, 2D polyhedral die faces, and the roll breakdown.

Press `Space` or `Enter` to draw immediately, or `Shift+Space` to start a countdown draw.

## Card Actions & Batch Notes

- **Card selection**: Click any result card to select it for **Reroll selected**, **Pin selected** (keeps the card locked during the next normal draw), or **Add to exclusions**. Use **Undo draw** to roll back the entire draw transaction.
- **Batch notes**: Click **+ Note** on the stage footer or right-click any card in **Recent batches** to label a draw (e.g., "Round 1 Raffle" or "Initiative"). You can search and filter by notes in **Data Insights**.

## Local Storage & Backups

All history, statistics, and presets stay on your computer (`%APPDATA%\com.zhishutai.desktop\state-v5.json`). RandDeck never connects to the internet.
Clearing history clears the stage and history list without wiping the cumulative statistics ledger (which can be reset separately in Data Insights). Use **Settings > Export backup** before moving to a new computer.
