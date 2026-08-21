import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "src-tauri", "icons");
const sourcePath = path.join(iconsDir, "icon-source.svg");
const faviconPath = path.join(root, "public", "favicon.svg");
const allowedColors = new Set(["080D16", "172235", "0E1624", "30415A", "B97931", "E8B85C", "F6D88F"]);

function fail(message) {
  console.error(`图标校验失败: ${message}`);
  process.exit(1);
}

function readPng(file) {
  try {
    return PNG.sync.read(fs.readFileSync(file));
  } catch (error) {
    fail(`${path.basename(file)} 不是有效 PNG (${error.message})`);
  }
}

function findFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(entryPath, extension);
    return entry.name.toLowerCase().endsWith(extension) ? [entryPath] : [];
  });
}

const source = fs.readFileSync(sourcePath, "utf8");
const normalized = source.toUpperCase();
if (!/<SVG\b[^>]*VIEWBOX=["']0 0 256 256["']/.test(normalized)) fail("源 SVG 必须使用 viewBox 0 0 256 256");
for (const token of ["<TEXT", "<IMAGE", "FILTER", "URL(", "LINEARGRADIENT", "RADIALGRADIENT", "<MASK"]) {
  if (normalized.includes(token)) fail(`源 SVG 包含禁止内容: ${token}`);
}
if (/<(?:image|use)\b[^>]+(?:href|xlink:href)\s*=\s*["'][^"']*(?:https?:)?\/\//i.test(source)) fail("源 SVG 包含远程资源");
const colors = [...normalized.matchAll(/#[0-9A-F]{6}\b/g)].map((match) => match[0].slice(1));
if (colors.some((color) => !allowedColors.has(color))) fail(`源 SVG 使用了未批准颜色: ${colors.find((color) => !allowedColors.has(color))}`);
if (!/data-role=["']selector-spark["']/i.test(source)) fail("源 SVG 缺少选择火花主体");
if ((source.match(/data-role=["']candidate-token["']/gi) ?? []).length !== 3) fail("源 SVG 必须包含三枚候选方块");
if ((source.match(/<rect\b/gi) ?? []).length < 6) fail("源 SVG 缺少仪器底板或候选方块");
if (source !== fs.readFileSync(faviconPath, "utf8")) fail("public/favicon.svg 必须与 icon-source.svg 完全一致");

const pngFiles = findFiles(iconsDir, ".png");
if (!pngFiles.length) fail("图标目录没有 PNG 资源");
for (const file of pngFiles) {
  const png = readPng(file);
  const name = path.relative(iconsDir, file);
  if (png.width !== png.height) fail(`${name} 不是正方形 (${png.width}x${png.height})`);
  if (png.data.length !== png.width * png.height * 4) fail(`${name} 不是 RGBA PNG`);
}

const ico = fs.readFileSync(path.join(iconsDir, "icon.ico"));
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) fail("icon.ico 头部无效");
const count = ico.readUInt16LE(4);
const layers = [];
for (let index = 0; index < count; index += 1) {
  const offset = 6 + index * 16;
  if (offset + 16 > ico.length) fail("icon.ico 条目超出文件范围");
  layers.push({ width: ico[offset] || 256, height: ico[offset + 1] || 256 });
}
const expectedLayers = [16, 24, 32, 48, 64, 256];
const actualLayers = [...new Set(layers.filter((layer) => layer.width === layer.height).map((layer) => layer.width))].sort((a, b) => a - b);
if (expectedLayers.some((size) => !actualLayers.includes(size))) fail(`icon.ico 缺少尺寸，实际为 ${actualLayers.join(", ")}`);

console.log(JSON.stringify({
  source: path.relative(root, sourcePath),
  faviconSynchronized: true,
  pngCount: pngFiles.length,
  icoLayers: actualLayers,
  icoEntryCount: count,
}, null, 2));
