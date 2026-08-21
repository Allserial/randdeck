import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const endpoint = process.env.TAURI_CDP_URL || "http://127.0.0.1:9222";
const reportDir = resolve("reports", "tauri-runtime");
const debugExecutable = resolve("src-tauri", "target", "debug", "randdeck.exe");
const localBypass = "127.0.0.1,localhost";
process.env.NO_PROXY = [process.env.NO_PROXY, localBypass].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
await mkdir(reportDir, { recursive: true });

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
assert(context, "没有找到 WebView2 浏览器上下文");

const main = context.pages().find((page) => !new URL(page.url()).searchParams.has("view"));
assert(main, "没有找到 Tauri 主窗口");

const errors = [];
main.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
main.on("pageerror", (error) => errors.push(`page: ${error.message}`));

await main.bringToFront();
await main.getByRole("heading", { name: /RandDeck|掷数台/ }).waitFor();
await main.getByLabel(/主导航|Main navigation/).getByRole("button", { name: /抽取台|Draw/ }).click();
await main.getByLabel(/抽取模式|Draw mode/).getByRole("button", { name: /范围池|Range pool/ }).click();
await main.getByRole("button", { name: /生成结果|Generate result/ }).click();
await main.getByRole("heading", { name: /本次结果|Current result/ }).waitFor();
const generatedResultCount = await main.locator(".result-tile").count();
const normalSize = await main.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

const knownPages = new Set(context.pages());
await main.getByRole("button", { name: /打开展示窗口|Open display window/ }).click();
const display = await context.waitForEvent("page", {
  predicate: (page) => !knownPages.has(page),
  timeout: 10_000,
}).catch(() => context.pages().find((page) => new URL(page.url()).searchParams.get("view") === "display"));
assert(display, "展示窗口未创建");
display.on("console", (message) => {
  if (message.type() === "error") errors.push(`display console: ${message.text()}`);
});
display.on("pageerror", (error) => errors.push(`display page: ${error.message}`));
await display.locator(".display-view").waitFor();
await display.locator(".result-tile, .display-results span").first().waitFor();
const displayUrl = display.url();
await display.screenshot({ path: resolve(reportDir, "display-window.png") });
const displayClosed = display.waitForEvent("close");
await display.getByRole("button", { name: /关闭展示窗口|Close display window/ }).click();
await displayClosed;

await main.getByLabel(/主导航|Main navigation/).getByRole("button", { name: /数据洞察|Insights/ }).click();
await main.locator(".recharts-wrapper").first().waitFor();
await main.screenshot({ path: resolve(reportDir, "insights-window.png") });
await main.getByLabel(/主导航|Main navigation/).getByRole("button", { name: /设置|Settings/ }).click();
await main.getByRole("heading", { name: /外观、展示与本地数据|Appearance, display and local data/ }).waitFor();
await main.screenshot({ path: resolve(reportDir, "main-window.png") });

const secondInstance = spawn(debugExecutable, [], { windowsHide: true, stdio: "ignore" });
const secondInstanceExitCode = await new Promise((resolveExit, rejectExit) => {
  const timeout = setTimeout(() => { secondInstance.kill(); rejectExit(new Error("第二实例未在 5 秒内退出")); }, 5_000);
  secondInstance.once("error", rejectExit);
  secondInstance.once("exit", (code) => { clearTimeout(timeout); resolveExit(code); });
});
assert.equal(secondInstanceExitCode, 0, "第二实例退出码异常");
await main.getByRole("heading", { name: /外观、展示与本地数据|Appearance, display and local data/ }).waitFor();
assert.equal(errors.length, 0, errors.join("\n"));

const report = {
  schema: "zhishutai.tauri-runtime-smoke.v1",
  generatedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  cleanSource: execFileSync("git", ["status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)reports"], { encoding: "utf8" }).trim() === "",
  debugExecutableSha256: createHash("sha256").update(await readFile(debugExecutable)).digest("hex"),
  endpoint,
  normalSize,
  displayUrl,
  generatedResultCount,
  singleInstance: { secondInstanceExitCode, mainWindowResponsive: true },
  consoleErrors: errors,
};
await writeFile(resolve(reportDir, "runtime-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

await browser.close();
