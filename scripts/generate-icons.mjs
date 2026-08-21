import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src-tauri", "icons", "icon-source.svg");
const output = path.join(root, "src-tauri", "icons");
const favicon = path.join(root, "public", "favicon.svg");
const tauri = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");

if (!fs.existsSync(tauri)) throw new Error(`找不到项目本地 Tauri CLI: ${tauri}`);
if (!fs.existsSync(source)) throw new Error(`找不到正式图标源: ${source}`);

const args = ["icon", source, "-o", output];
const result = spawnSync(process.execPath, [tauri, ...args], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

fs.copyFileSync(source, favicon);
console.log(`已同步正式图标源到 ${favicon}`);
