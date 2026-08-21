# RandDeck / 掷数台使用说明

## 安装与启动

已有 WebView2 Runtime 时，可以直接使用 `RandDeck.exe` 便携版。目标电脑可能没有 WebView2 时，使用内置离线运行时的 `RandDeck-v0.6.0-offline-setup.exe`。多文件 ZIP 解压完整后再启动。

运行下载的文件前，请将其 SHA256 与 GitHub Release 页面比较。当前版本未进行代码签名，Windows SmartScreen 可能显示“未知发布者”。

## 语言

进入“设置”，选择“简体中文”或“English”。切换立即生效并保存在本地。没有语言字段的 v0.5.0 数据默认使用简体中文。

## 抽取模式

- **范围池**：设置最小值和最大值。
- **自定义池**：输入独立的整数值。
- **骰子表达式**：输入例如 `2d6+3` 的表达式。

生成前设置抽取数量、排除规则和“抽后移除”。`Space` 和 `Enter` 立即生成，`Shift+Space` 启动当前配置的倒计时。

## 结果与历史

选择结果卡片后，可以局部重掷、固定结果或把数字加入排除规则。需要完整回滚时，在结果操作中撤销抽取。历史记录和统计账本相互独立；清空历史会同时清空结果舞台，但不会清空统计账本。

## 数据与兼容性

RandDeck 只在本地保存数据。Tauri 使用 `%APPDATA%\com.zhishutai.desktop\state-v5.json`，浏览器调试版使用 IndexedDB `zhishutai-v5`，备份格式为 `zhishutai.backup.v5`。这些 `zhishutai.*` 标识为了升级兼容而保留，不是公开产品名。

迁移电脑或卸载前，请进入“设置”导出备份。恢复前先查看备份摘要。
