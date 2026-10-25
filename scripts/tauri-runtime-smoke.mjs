import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { LogicalSize, PhysicalSize, Size } from "@tauri-apps/api/dpi";

// The caller owns startup, isolated AppData/profile, EXE-exit/restart checks and restoration.
// All UI/IPC checks below run in its real WebView2; no HTTP server is started here.
const root = fileURLToPath(new URL("../", import.meta.url));
const endpoint = process.env.TAURI_CDP_URL || "http://127.0.0.1:9222";
const reportDir = resolve(root, process.env.TAURI_RUNTIME_REPORT_DIR || "reports/tauri-runtime/0.7.2");
const executable = resolve(root, process.env.TAURI_EXECUTABLE || "src-tauri/target/release/randdeck.exe");
const targetProcessId = Number(process.env.TAURI_PROCESS_ID);
const runtimeSessionId = process.env.TAURI_RUNTIME_SESSION_ID || null;
const stateFile = process.env.TAURI_STATE_FILE ? resolve(process.env.TAURI_STATE_FILE) : null;
const closeExpectedFile = resolve(reportDir, "close-expected-state.json");
const repoPath = (path) => relative(root, path).replaceAll("\\", "/");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
const cleanSource = () => git("status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)reports") === "";
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
await mkdir(reportDir, { recursive: true });

const report = {
  schema: "zhishutai.tauri-runtime-smoke.v1", generatedAt: new Date().toISOString(), passed: false,
  sourceCommit: git("rev-parse", "HEAD"), cleanSource: cleanSource(),
  executablePath: repoPath(executable), executableSha256: null, processId: targetProcessId, sessionId: runtimeSessionId, endpoint,
  checks: [], screenshots: [], consoleErrors: [], ipcCalls: [], ipcErrors: [],
  externalValidation: ["Primary EXE exit and restart: caller guard", "Physical external-monitor placement: user hardware acceptance"],
};
let browser;
let main;
let display;
let slowClose;
const watched = new WeakSet();

async function until(predicate, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 75));
  } while (Date.now() < deadline);
  throw new Error(message);
}

function isDisplay(page) {
  try { return new URL(page.url()).searchParams.get("view") === "display"; }
  catch { return false; }
}

function watch(page) {
  if (watched.has(page)) return;
  watched.add(page);
  const label = () => isDisplay(page) ? "display" : "main";
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(`${label()} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => report.consoleErrors.push(`${label()} page: ${error.message}`));
}

async function instrumentIpc(page) {
  await page.evaluate(() => {
    if (window.__randdeckRuntimeSmoke?.transport === "fetch") return;
    const internals = window.__TAURI_INTERNALS__;
    if (!internals?.invoke) throw new Error("Real Tauri IPC is unavailable");
    // Tauri 2.11.5 defines invoke/ipc/postMessage as read-only. Its native
    // ipc-protocol.js calls the writable global fetch for the custom protocol.
    const trace = window.__randdeckRuntimeSmoke = { transport: "fetch", calls: [] };
    const originalFetch = window.fetch;
    const observedFetch = async function (input, options) {
      const address = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
      let command;
      try {
        const url = new URL(address);
        if (url.protocol === "ipc:" || ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === "ipc.localhost")) {
          command = decodeURIComponent(url.pathname.replace(/^\//, ""));
        }
      } catch { /* Non-IPC fetch inputs pass through unchanged. */ }
      if (!command) return Reflect.apply(originalFetch, this, [input, options]);
      const record = { command, completed: false };
      // Never inspect request headers or the invoke key. Only window commands
      // expose their small argument objects; store/event payloads remain private.
      if (command.startsWith("plugin:window|")) {
        try {
          const body = options?.body;
          const text = typeof body === "string" ? body
            : body instanceof ArrayBuffer ? new TextDecoder().decode(body)
              : ArrayBuffer.isView(body) ? new TextDecoder().decode(body) : undefined;
          if (text !== undefined) record.args = JSON.parse(text);
        } catch (error) { record.argsParseError = String(error?.message || error); }
      }
      trace.calls.push(record);
      try {
        const response = await Reflect.apply(originalFetch, this, [input, options]);
        // Match the local native protocol implementation, not HTTP status alone.
        record.tauriResponse = response.headers.get("Tauri-Response");
        record.succeeded = record.tauriResponse === "ok";
        if (!record.succeeded) {
          try {
            const copy = response.clone();
            const contentType = (copy.headers.get("content-type") || "").split(",")[0];
            const data = contentType === "application/json" ? await copy.json() : await copy.text();
            record.error = typeof data === "string" ? data : JSON.stringify(data);
          } catch (error) { record.error = `Could not inspect IPC error response: ${String(error?.message || error)}`; }
        }
        record.completed = true;
        return response;
      } catch (error) {
        record.completed = true;
        record.succeeded = false;
        record.error = String(error?.message || error);
        throw error;
      }
    };
    window.fetch = observedFetch;
    if (window.fetch !== observedFetch) throw new Error("The IPC fetch observer could not be installed");
  });
}

async function collectIpc() {
  for (const [page, label] of [[main, "main"], [display, "display"]]) {
    if (!page || page.isClosed()) continue;
    const calls = await page.evaluate(() => window.__randdeckRuntimeSmoke?.calls || []);
    report.ipcCalls = [...report.ipcCalls.filter((call) => call.window !== label), ...calls.map((call) => ({ window: label, ...call }))];
  }
  report.ipcErrors = report.ipcCalls.filter((call) => call.error && (
    /denied|permission|not allowed|not permitted|forbidden/i.test(call.error)
    || (call.command.startsWith("plugin:window|") && call.command !== "plugin:window|set_effects")
  ));
}

async function assertNoErrors() {
  await collectIpc();
  assert.equal(report.consoleErrors.length, 0, report.consoleErrors.join("\n"));
  assert.equal(report.ipcErrors.length, 0, `Native IPC failed: ${JSON.stringify(report.ipcErrors)}`);
  if (main && !main.isClosed()) {
    const toast = main.locator(".bottom-notification.is-error");
    assert.equal(await toast.count(), 0, await toast.count() ? await toast.textContent() : "");
  }
}

async function check(id, action) {
  const row = { id, status: "running", startedAt: new Date().toISOString() };
  report.checks.push(row);
  process.stdout.write(`[runtime] ${id}\n`);
  try {
    row.evidence = await action();
    await assertNoErrors();
    row.status = "passed";
  } catch (error) {
    row.status = "failed";
    row.error = error?.stack || String(error);
    throw error;
  } finally { row.finishedAt = new Date().toISOString(); }
}

async function screenshot(page, name) {
  const path = resolve(reportDir, `${name}.png`);
  await page.screenshot({ path });
  report.screenshots.push(repoPath(path));
}

async function exposeRuntimeStore(page) {
  const asset = (await readdir(resolve(root, "dist/assets"))).find((name) => /^store-.*\.js$/.test(name));
  assert(asset, "Production store asset was not found for the runtime fixture");
  await page.evaluate(async (url) => {
    const module = await import(url);
    const store = Object.values(module).find((value) => typeof value === "function" && typeof value.getState === "function" && typeof value.setState === "function");
    if (!store) throw new Error("Production Zustand store export was not found");
    window.__randdeckRuntimeStore = store;
  }, new URL(`assets/${asset}`, page.url()).href);
}

// This is the production store's persisted shape, rather than its transient UI,
// pending ceremony or test instrumentation. This reader never writes to it.
async function persistentRuntimeSnapshot(page) {
  return page.evaluate(() => {
    const state = window.__randdeckRuntimeStore.getState();
    return Object.fromEntries(["version", "settings", "pools", "history", "stats", "presets", "pinnedPresetIds", "drawState", "sessionArchive", "ui", "migrationNotes"]
      .map((key) => [key, structuredClone(state[key])]).concat([["activeSession", null]]));
  });
}

async function verifySavedOrReopenedState(mode) {
  const verification = { schema: "zhishutai.close-persistence-verification.v1", mode, passed: false,
    generatedAt: new Date().toISOString(), sourceCommit: git("rev-parse", "HEAD"),
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"), sessionId: runtimeSessionId };
  let reopenedBrowser;
  try {
    assert(stateFile, "The caller must identify its protected state-v5.json");
    const expected = JSON.parse(await readFile(closeExpectedFile, "utf8"));
    assert.equal(expected.sourceCommit, verification.sourceCommit, "Close expectation belongs to a different source commit");
    assert.equal(expected.executableSha256, verification.executableSha256, "Close expectation belongs to a different EXE");
    assert.equal(expected.sessionId, runtimeSessionId, "Close expectation belongs to a different protected session");
    if (mode === "saved") {
      const disk = JSON.parse(await readFile(stateFile, "utf8"));
      assert.deepEqual(disk.current, expected.snapshot, "Real native state-v5.json lost or changed the accepted pre-close state");
      verification.actualStateSha256 = createHash("sha256").update(JSON.stringify(disk.current)).digest("hex");
      verification.historyCount = disk.current.history.length;
      verification.exactPersistentSnapshotMatched = true;
    } else {
      reopenedBrowser = await chromium.connectOverCDP(endpoint);
      const page = reopenedBrowser.contexts()[0]?.pages().find((candidate) => !isDisplay(candidate) && !candidate.url().startsWith("devtools:"));
      assert(page, "Reopened real main WebView was not found");
      await page.locator(".app-brand h1").waitFor();
      await exposeRuntimeStore(page);
      await until(() => page.evaluate(() => window.__randdeckRuntimeStore.getState().hydrated), "Reopened store did not hydrate");
      // initializeStore intentionally starts on the range draw page and clears
      // the current-result pointer while retaining history, pools and statistics.
      const normalized = structuredClone(expected.snapshot);
      normalized.settings.mode = "range";
      normalized.settings.count = normalized.ui.countByMode.range;
      normalized.drawState.lastTransactionId = null;
      normalized.ui.activeView = "roll";
      normalized.ui.insightsTab = "overview";
      if (await page.evaluate(() => matchMedia("(max-width: 1039px)").matches)) normalized.ui.inspectorOpen = false;
      assert.deepEqual(await persistentRuntimeSnapshot(page), normalized, "Reopened production store did not restore the saved state");
      assert.equal(await page.evaluate(() => window.__randdeckRuntimeStore.getState().isClosing), false, "Reopened store retained a stale close lock");
      assert.equal(await page.locator(".app-shell").evaluate((element) => element.inert), false, "Reopened UI remained inert");
      assert.equal(await page.evaluate(() => document.body.inert), false, "Reopened body and its Portal UI remained inert");
      verification.exactHydratedSnapshotMatched = true;
      verification.historyCount = normalized.history.length;
      verification.stateClosing = false;
      const reopenedQuantity = page.locator(".count-control input");
      if (!await reopenedQuantity.isVisible()) await page.locator(".inspector-toggle:visible").click();
      const reopenedBounds = await reopenedQuantity.boundingBox();
      assert(reopenedBounds, "The reopened quantity field is unavailable for actual pointer and keyboard verification");
      const initialQuantity = await reopenedQuantity.inputValue();
      await page.mouse.click(reopenedBounds.x + reopenedBounds.width / 2, reopenedBounds.y + reopenedBounds.height / 2);
      assert.equal(await reopenedQuantity.evaluate((element) => document.activeElement === element), true, "Reopened pointer input remained blocked");
      await page.keyboard.press("Control+A");
      await page.keyboard.type(initialQuantity === "7" ? "8" : "7");
      assert.equal(await reopenedQuantity.inputValue(), initialQuantity === "7" ? "8" : "7", "Reopened keyboard editing remained blocked");
      await page.keyboard.press("Escape");
      assert.equal(await reopenedQuantity.inputValue(), initialQuantity, "Reopened Escape did not restore the local quantity draft");
      assert.equal(await page.evaluate(() => window.__randdeckRuntimeStore.getState().settings.count), normalized.settings.count, "Reopened input verification committed its temporary draft");
      verification.reopenedPointerAndKeyboardResponsive = true;
      await page.screenshot({ path: resolve(reportDir, "reopened-saved-state.png") });
    }
    verification.passed = true;
  } catch (error) {
    verification.error = error?.stack || String(error);
    process.exitCode = 1;
  } finally {
    if (reopenedBrowser?.isConnected()) await reopenedBrowser.close();
    verification.finishedAt = new Date().toISOString();
    await writeFile(resolve(reportDir, mode === "saved" ? "closed-saved-state.json" : "reopened-saved-state.json"), `${JSON.stringify(verification, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  }
}

async function native(command, args = {}) {
  return main.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
}

function windowsPowerShellEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra };
  // PS 7's Utility module cannot be loaded by Windows PowerShell 5.1.
  // Let powershell.exe initialize its own compatible default module paths.
  for (const key of Object.keys(environment)) if (key.toLowerCase() === "psmodulepath") delete environment[key];
  return environment;
}

async function nativeProbe(drag = false) {
  const title = await native("plugin:window|title", { label: "display" });
  const args = ["-NoLogo", "-NoProfile", "-File", resolve(root, "scripts/native-window-probe.ps1"), "-AppProcessId", String(targetProcessId), "-Title", title];
  if (drag) args.push("-Drag");
  return new Promise((done, reject) => {
    execFile("powershell.exe", args, { windowsHide: true, timeout: 20_000, encoding: "utf8", env: windowsPowerShellEnvironment() }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Native window probe failed: ${stderr || error.message}`));
      else { try { done(JSON.parse(stdout.trim())); } catch (parseError) { reject(parseError); } }
    });
  });
}

async function settings() {
  await main.getByLabel(/主导航|Main navigation/).getByRole("button", { name: /设置|Settings/ }).click();
  await main.locator(".settings-view").waitFor({ state: "visible" });
}

async function selectMotion(name) {
  await main.getByRole("group", { name: "动态效果", exact: true }).getByRole("button", { name, exact: true }).click();
}

async function selectTheme(name) {
  await main.getByRole("group", { name: "主题", exact: true }).getByRole("button", { name, exact: true }).click();
}

const clickThrough = () => main.locator(".display-settings label.setting-toggle input");
const particleToggle = () => main.locator("label.ceremony-toggle").filter({ hasText: "仪式粒子效果" }).locator("input");

async function openDisplay() {
  await main.locator(".display-settings").getByRole("button", { name: "打开展示窗口", exact: true }).click();
  display = await until(() => browser.contexts()[0].pages().find((page) => isDisplay(page) && !page.isClosed()), "Display WebView was not created");
  watch(display);
  await display.locator(".display-view").waitFor();
  await instrumentIpc(display);
  return display;
}

async function windowState() {
  return { fullscreen: await native("plugin:window|is_fullscreen", { label: "display" }),
    alwaysOnTop: await native("plugin:window|is_always_on_top", { label: "display" }) };
}

async function setMode(mode, label) {
  await main.locator(".display-modes").getByRole("button", { name: label, exact: true }).click();
  await until(() => display.locator(`.display-view--${mode}`).count(), `Display CSS did not change to ${mode}`);
  await until(async () => {
    const actual = await windowState();
    return actual.fullscreen === (mode === "fullscreen") && actual.alwaysOnTop === (mode === "overlay");
  }, `Native window properties did not change to ${mode}`);
  return windowState();
}

async function canvasPixels() {
  return display.locator("canvas.burst-canvas").evaluateAll((canvases) => ({
    canvases: canvases.length,
    opaquePixels: canvases.reduce((total, canvas) => {
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) return total;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count += 1;
      return total + count;
    }, 0),
    theme: document.documentElement.dataset.theme, motion: document.documentElement.dataset.motion,
  }));
}

async function prepareParticleScenario() {
  await selectMotion("仪式");
  await selectTheme("标准墨蓝");
  await particleToggle().check();
  // A bounded synthetic phase uses the real UI-generated transaction without committing another draw.
  await main.evaluate(() => {
    const store = window.__randdeckRuntimeStore.getState();
    const entry = store.history.find((row) => row.transactionId === store.drawState.lastTransactionId);
    if (!entry) throw new Error("No UI-generated transaction is available for the particle fixture");
    const transaction = {
      id: `runtime-particle-${Date.now()}`, createdAt: new Date().toISOString(), mode: entry.mode,
      configSnapshot: structuredClone(entry.config), poolsSnapshot: structuredClone(store.pools),
      poolFingerprint: entry.poolFingerprint, results: structuredClone(entry.results),
      operation: entry.operation || { kind: "draw" }, statsDelta: entry.statsDelta, usedAdded: [],
      candidateCount: 100, candidateSpec: { mode: entry.mode }, algorithmVersion: "webcrypto-rejection-v1",
    };
    store.setCeremony({ phase: "finished", remainingSeconds: 0, revealedCount: entry.results.length, targetTransaction: transaction });
  });
  // Real Settings changes exercise production publishCurrentDisplay -> native event -> display rendering.
  await particleToggle().uncheck();
  await particleToggle().check();
  return until(async () => {
    const pixels = await canvasPixels();
    return pixels.canvases > 0 && pixels.opaquePixels > 0 ? pixels : false;
  }, "No particle pixels were drawn in the real display WebView");
}

function closeMainViaWmClose(title) {
  // PID + native title uniquely identify the caller-owned main window; never send a broad close.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class RuntimeWindowClose {
  private delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc proc, IntPtr data);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  public static IntPtr[] Find(uint pid, string title) {
    var matches = new List<IntPtr>();
    EnumWindows((hwnd, _) => {
      uint owner; GetWindowThreadProcessId(hwnd, out owner);
      var text = new StringBuilder(2048); GetWindowText(hwnd, text, text.Capacity);
      if (owner == pid && IsWindowVisible(hwnd) && text.ToString() == title) matches.Add(hwnd);
      return true;
    }, IntPtr.Zero);
    return matches.ToArray();
  }
}
'@
$runtimeTargetPid = [uint32]$env:TAURI_PROCESS_ID
$runtimeNativeTitle = $env:TAURI_MAIN_WINDOW_TITLE
$runtimeMatches = @([RuntimeWindowClose]::Find($runtimeTargetPid, $runtimeNativeTitle))
if ($runtimeMatches.Count -ne 1) { throw "Expected one exact PID/title main window, found $($runtimeMatches.Count)" }
$runtimeHandle = $runtimeMatches[0]
if (![RuntimeWindowClose]::PostMessage($runtimeHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw "WM_CLOSE failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
[pscustomobject]@{ processId=$runtimeTargetPid; title=$runtimeNativeTitle; handle=('0x{0:X}' -f $runtimeHandle.ToInt64()); message='WM_CLOSE'; posted=$true } | ConvertTo-Json -Compress
`;
  return new Promise((done, reject) => {
    execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      windowsHide: true, timeout: 20_000, encoding: "utf8",
      env: windowsPowerShellEnvironment({ TAURI_PROCESS_ID: String(targetProcessId), TAURI_MAIN_WINDOW_TITLE: title }),
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Native WM_CLOSE helper failed: ${stderr || error.message}`));
      else { try { done(JSON.parse(stdout.trim())); } catch (parseError) { reject(parseError); } }
    });
  });
}

const verificationMode = process.argv.includes("--verify-saved-state") ? "saved" : process.argv.includes("--verify-reopen") ? "reopen" : null;
if (verificationMode) {
  await verifySavedOrReopenedState(verificationMode);
} else {
try {
  assert(report.cleanSource, "Source tree must be clean before release EXE verification");
  assert(Number.isSafeInteger(targetProcessId) && targetProcessId > 0, "TAURI_PROCESS_ID must identify the caller-owned primary EXE");
  assert.match(runtimeSessionId || "", /^[0-9a-f]{32}$/, "TAURI_RUNTIME_SESSION_ID must identify the caller-owned protected session");
  report.executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  assert(context, "No WebView2 browser context was found");
  context.pages().forEach(watch);
  context.on("page", watch);
  main = context.pages().find((page) => !isDisplay(page) && !page.url().startsWith("devtools:"));
  assert(main, "Tauri main window was not found");
  await main.bringToFront();
  await main.locator(".app-brand h1").waitFor();
  await instrumentIpc(main);
  report.normalSize = await main.evaluate(() => ({ width: innerWidth, height: innerHeight }));

  await check("ui-generation", async () => {
    await settings();
    await main.getByRole("button", { name: "简体中文", exact: true }).click();
    await until(async () => (await main.evaluate(() => window.__randdeckRuntimeSmoke.calls)).some((call) =>
      call.command === "plugin:window|set_title" && call.args?.label === "main" && call.succeeded
    ), "The fetch observer did not capture the real Settings native title setter");
    await selectMotion("即时");
    await selectTheme("标准墨蓝");
    await main.getByLabel("主导航").getByRole("button", { name: "抽取台", exact: true }).click();
    await main.getByLabel("抽取模式").getByRole("button", { name: "范围池", exact: true }).click();
    await main.getByRole("textbox", { name: "生成数量", exact: true }).fill("3");
    await main.getByRole("textbox", { name: "生成数量", exact: true }).press("Enter");
    await main.locator(".generate-main-btn:visible").click();
    await until(async () => await main.locator(".result-tile:not(.is-rolling)").count() === 3, "UI draw did not produce three results");
    report.generatedResultCount = await main.locator(".result-tile").count();
    report.generatedValues = await main.locator(".result-value .fit-number").allTextContents();
    assert(report.generatedValues.every((value) => /^-?\d+$/.test(value)), "Draw contains an unreadable result");
    await screenshot(main, "ui-generated-main");
    return { count: report.generatedResultCount, values: report.generatedValues };
  });

  await check("first-overlay-and-result-handshake", async () => {
    await settings();
    const oldDisplay = context.pages().find(isDisplay);
    if (oldDisplay) {
      const closed = oldDisplay.waitForEvent("close");
      await oldDisplay.getByRole("button", { name: /关闭展示窗口|Close display window/ }).click();
      await closed;
    }
    await clickThrough().uncheck();
    await main.locator(".display-modes").getByRole("button", { name: "透明置顶", exact: true }).click();
    await openDisplay();
    report.displayUrl = display.url();
    await until(() => display.locator(".display-view--overlay").count(), "First overlay open did not receive its CSS mode");
    await until(async () => await display.locator(".result-tile").count() === report.generatedResultCount, "Display handshake did not synchronize generated results");
    assert.deepEqual(await display.locator(".result-value .fit-number").allTextContents(), report.generatedValues);
    const state = await windowState();
    assert.equal(state.fullscreen, false);
    assert.equal(state.alwaysOnTop, true);
    const background = await display.locator(".display-view").evaluate((element) => getComputedStyle(element).backgroundColor);
    assert(/rgba\(/.test(background) && !background.endsWith(", 1)"), `Overlay background is opaque: ${background}`);
    const probe = await nativeProbe();
    assert.equal(probe.alwaysOnTop, true);
    assert.equal(probe.clickThrough, false);
    await screenshot(display, "first-overlay-display");
    return { ...state, background, matchingResults: true, nativeProbe: probe };
  });

  await check("repeat-open-preserves-click-through", async () => {
    await clickThrough().check();
    const accepted = () => main.evaluate(() => window.__randdeckRuntimeSmoke.calls.filter((call) =>
      call.command === "plugin:window|set_ignore_cursor_events" && call.args?.label === "display" && call.args.value === true && call.succeeded));
    await until(async () => (await accepted()).length >= 1, "Click-through setter was not accepted by Tauri");
    const enabledProbe = await nativeProbe();
    assert.equal(enabledProbe.clickThrough, true);
    assert.equal(enabledProbe.alwaysOnTop, true);
    for (let index = 0; index < 2; index += 1) await openDisplay();
    await until(async () => (await accepted()).length >= 3, "Repeated open did not preserve native click-through calls");
    assert.equal(await clickThrough().isChecked(), true);
    assert.equal(context.pages().filter((page) => isDisplay(page) && !page.isClosed()).length, 1);
    const calls = await accepted();
    const repeatedProbe = await nativeProbe();
    assert.equal(repeatedProbe.clickThrough, true);
    assert.equal(repeatedProbe.alwaysOnTop, true);
    await clickThrough().uncheck();
    const disabledProbe = await nativeProbe();
    assert.equal(disabledProbe.clickThrough, false);
    return { settingPreserved: true, displayCount: 1, acceptedCalls: calls, nativeProbes: { enabled: enabledProbe, repeated: repeatedProbe, disabled: disabledProbe } };
  });

  await check("live-native-window-modes-and-drag-handle", async () => {
    const normal = await setMode("normal", "普通窗口");
    const brand = await display.locator(".display-brand").evaluate((element) => ({ title: element.title, cursor: getComputedStyle(element).cursor }));
    assert.equal(brand.cursor, "grab");
    assert(brand.title, "Normal display drag affordance has no title");
    const position = await native("plugin:window|outer_position", { label: "display" });
    const dragProbe = await nativeProbe(true);
    assert.equal(dragProbe.clickThrough, false);
    assert.equal(dragProbe.alwaysOnTop, false);
    assert.equal(dragProbe.dragMoved, true, `Native brand-bar drag did not move the window: ${JSON.stringify(dragProbe)}`);
    await until(async () => (await display.evaluate(() => window.__randdeckRuntimeSmoke.calls)).some((call) =>
      call.command === "plugin:window|start_dragging" && call.succeeded
    ), "Native drag IPC was not accepted");
    await screenshot(display, "normal-display");
    const fullscreen = await setMode("fullscreen", "全屏演示");
    await screenshot(display, "fullscreen-display");
    const overlay = await setMode("overlay", "透明置顶");
    await setMode("normal", "普通窗口");
    return { normal, fullscreen, overlay, dragAffordance: brand, nativePositionQuery: position, nativeDragProbe: dragProbe };
  });

  await check("localized-native-window-titles", async () => {
    const titles = {};
    for (const [locale, label, mainTitle, displayTitle] of [
      ["en-US", "English", "RandDeck", "RandDeck · Display"], ["zh-CN", "简体中文", "掷数台", "掷数台 · 展示"],
    ]) {
      await main.getByRole("button", { name: label, exact: true }).click();
      await until(async () => (await native("plugin:window|title", { label: "main" })) === mainTitle, `Native main title did not switch to ${locale}`);
      await until(async () => (await native("plugin:window|title", { label: "display" })) === displayTitle, `Native display title did not switch to ${locale}`);
      titles[locale] = { main: await native("plugin:window|title", { label: "main" }), display: await native("plugin:window|title", { label: "display" }) };
      await screenshot(display, `native-title-${locale}-display`);
    }
    return titles;
  });

  await check("display-particle-settings-and-canvas-clear", async () => {
    await exposeRuntimeStore(main);
    const systemReducedMotion = await display.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (systemReducedMotion) await display.emulateMedia({ reducedMotion: "no-preference" });
    const cases = [];
    for (const name of ["particles-off", "instant", "contrast"]) {
      const before = await prepareParticleScenario();
      await screenshot(display, `${name}-before`);
      if (name === "particles-off") await particleToggle().uncheck();
      else if (name === "instant") await selectMotion("即时");
      else await selectTheme("高对比");
      const after = await until(async () => {
        const pixels = await canvasPixels();
        return pixels.canvases > 0 && pixels.opaquePixels === 0 ? pixels : false;
      }, `${name} did not clear display canvas pixels`);
      if (name === "instant") assert.equal(after.motion, "instant");
      if (name === "contrast") assert.equal(after.theme, "contrast");
      cases.push({ name, before, after });
      await screenshot(display, `${name}-cleared`);
    }
    await main.evaluate(() => window.__randdeckRuntimeStore.getState().resetCeremony());
    await selectMotion("即时");
    await selectTheme("标准墨蓝");
    return { fixture: "Synthetic finished phase, UI-generated transaction; real Settings appearance changes and Tauri IPC", systemReducedMotion, mediaOverride: systemReducedMotion ? "no-preference" : null, cases };
  });

  await check("native-dense-dice-result-geometry", async () => {
    const frame = () => main.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio }));
    const originalPhysicalSize = await native("plugin:window|inner_size", { label: "main" });
    const originalFrame = await frame();
    const scaleFactor = await native("plugin:window|scale_factor", { label: "main" });
    report.denseDice = { originalPhysicalSize, originalFrame, scaleFactor, scenarios: [], restoration: null,
      scope: "Real release EXE WebView2, native logical client sizes on the current monitor; not physical multi-monitor acceptance" };
    const resizeLogical = async (width, height) => {
      // Use the installed SDK's Size serialization, exactly as Window.setSize does.
      await native("plugin:window|set_size", { label: "main", value: new Size(new LogicalSize(width, height)).toJSON() });
      await until(async () => {
        const actual = await frame();
        return Math.abs(actual.innerWidth - width) <= 2 && Math.abs(actual.innerHeight - height) <= 2;
      }, `Native main resize did not reach requested logical size ${width}x${height}`);
      await main.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      return { requestedLogicalSize: { width, height }, actual: await frame(),
        nativePhysicalSize: await native("plugin:window|inner_size", { label: "main" }) };
    };
    try {
      await resizeLogical(1180, 820);
      await main.getByLabel("主导航").getByRole("button", { name: "抽取台", exact: true }).click();
      await main.getByLabel("抽取模式").getByRole("button", { name: "骰子表达式", exact: true }).click();
      await main.getByRole("group", { name: "求值方式", exact: true }).getByRole("button", { name: "批量求值", exact: true }).click();
      await main.getByRole("textbox", { name: "表达式", exact: true }).fill("1d20+5+2d6+2+1d4");
      for (const count of [11, 20, 50]) {
        await resizeLogical(1180, 820);
        const quantity = main.getByRole("textbox", { name: "生成数量", exact: true });
        if (!await quantity.isVisible()) await main.locator(".inspector-toggle:visible").click();
        await quantity.fill(String(count));
        await quantity.press("Enter");
        await main.locator(".generate-main-btn:visible").click();
        await until(async () => await main.locator(".result-tile--expression:not(.is-rolling)").count() === count,
          `Real dice draw did not produce ${count} cards`);
        for (const width of [680, 760]) {
          const dimensions = await resizeLogical(width, 700);
          if (await main.locator(".inspector-close:visible").count()) await main.locator(".inspector-close:visible").click();
          const metrics = await main.locator(".result-tile").evaluateAll((tiles) => tiles.map((tile, index) => {
            const value = tile.querySelector(".result-value").getBoundingClientRect();
            const textElement = tile.querySelector(".fit-number");
            const text = textElement.getBoundingClientRect();
            const footer = tile.querySelector(".tile-footer").getBoundingClientRect();
            const card = tile.getBoundingClientRect();
            return { index, text: textElement.textContent, valueHeight: value.height, textHeight: text.height,
              topInset: text.top - value.top, bottomInset: value.bottom - text.bottom,
              leftInset: text.left - value.left, rightInset: value.right - text.right,
              footerInset: card.bottom - footer.bottom, overflow: tile.scrollHeight - tile.clientHeight };
          }));
          report.denseDice.scenarios.push({ count, ...dimensions, metrics });
          assert.equal(metrics.length, count);
          for (const metric of metrics) {
            const detail = `${count} cards at logical ${width}px, ${JSON.stringify(dimensions.actual)}: ${JSON.stringify(metric)}`;
            assert(/^-?\d+$/.test(metric.text), `Unreadable native dice value: ${detail}`);
            assert(metric.topInset >= -0.5, `Dice value clipped at top: ${detail}`);
            assert(metric.bottomInset >= -0.5, `Dice value clipped at bottom: ${detail}`);
            assert(metric.leftInset >= -0.5, `Dice value clipped at left: ${detail}`);
            assert(metric.rightInset >= -0.5, `Dice value clipped at right: ${detail}`);
            assert(metric.footerInset >= -0.5, `Dice footer clipped: ${detail}`);
            assert(metric.overflow <= 1, `Dice card content overflow: ${detail}`);
          }
          if (count === 50) await screenshot(main, `native-dense-dice-50-${width}`);
        }
      }
    } catch (error) {
      await screenshot(main, "native-dense-dice-failure").catch(() => undefined);
      throw error;
    } finally {
      await native("plugin:window|set_size", { label: "main", value: new Size(new PhysicalSize(originalPhysicalSize)).toJSON() });
      await until(async () => {
        const actual = await frame();
        return Math.abs(actual.innerWidth - originalFrame.innerWidth) <= 2 && Math.abs(actual.innerHeight - originalFrame.innerHeight) <= 2;
      }, "Native main window did not restore its original client size");
      report.denseDice.restoration = { actual: await frame(), nativePhysicalSize: await native("plugin:window|inner_size", { label: "main" }) };
      await settings();
    }
    return report.denseDice;
  });

  await check("single-instance", async () => {
    const second = spawn(executable, [], { windowsHide: true, stdio: "ignore", env: process.env });
    const secondInstanceExitCode = await new Promise((done, reject) => {
      const timeout = setTimeout(() => { second.kill(); reject(new Error("Second instance did not exit within five seconds")); }, 5_000);
      second.once("error", (error) => { clearTimeout(timeout); reject(error); });
      second.once("exit", (code) => { clearTimeout(timeout); done(code); });
    });
    assert.equal(secondInstanceExitCode, 0);
    await main.locator(".settings-view").waitFor({ state: "visible" });
    await screenshot(main, "main-before-close");
    report.singleInstance = { secondInstanceExitCode, mainWindowResponsive: true };
    return report.singleInstance;
  });

  await check("native-close-during-slow-save", async () => {
    assert(stateFile, "The caller must identify its protected state-v5.json");
    await main.getByLabel("主导航").getByRole("button", { name: "抽取台", exact: true }).click();
    await main.getByLabel("抽取模式").getByRole("button", { name: "范围池", exact: true }).click();
    const quantity = main.getByRole("textbox", { name: "生成数量", exact: true });
    if (!await quantity.isVisible()) await main.locator(".inspector-toggle:visible").click();
    await quantity.fill("4");
    await quantity.press("Enter");
    await until(async () => {
      try {
        const disk = JSON.parse(await readFile(stateFile, "utf8"));
        return disk.current.settings.mode === "range" && disk.current.settings.count === 4;
      } catch { return false; }
    }, "The real native store did not save the slow-close scenario configuration");
    await main.evaluate(() => {
      const originalFetch = window.fetch;
      let release;
      const barrier = new Promise((done) => { release = done; });
      const gate = window.__randdeckCloseSaveGate = { armed: true, blocked: false, released: false, forwarded: false,
        release() { gate.released = true; release(); } };
      window.fetch = async function (input, options) {
        const address = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
        let command;
        try {
          const url = new URL(address);
          if (url.protocol === "ipc:" || ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === "ipc.localhost")) command = decodeURIComponent(url.pathname.replace(/^\//, ""));
        } catch { /* Non-IPC requests pass through unchanged. */ }
        if (gate.armed && command === "plugin:store|save") {
          gate.armed = false;
          gate.blocked = true;
          await barrier;
          gate.forwarded = true;
        }
        // Preserve the exact native request and response. The fixture delays one
        // real store save; it never fakes a successful save or edits app state.
        return Reflect.apply(originalFetch, this, [input, options]);
      };
    });
    await main.locator(".generate-main-btn:visible").click();
    await until(async () => await main.locator(".result-tile:not(.is-rolling)").count() === 4, "The slow-close scenario did not commit a real four-result draw");
    await until(() => main.evaluate(() => window.__randdeckCloseSaveGate.blocked), "The real native store save was not delayed");
    const expectedSnapshot = await persistentRuntimeSnapshot(main);
    const generatedTransactionId = await main.evaluate(() => window.__randdeckRuntimeStore.getState().drawState.lastTransactionId);
    assert(expectedSnapshot.history.some((entry) => entry.transactionId === generatedTransactionId), "The accepted draw is missing from the expected close snapshot");
    // Radix renders this dialog directly below body, outside the main shell.
    // Keep a real unsaved component draft open across WM_CLOSE so a store-only
    // guard cannot conceal an interactive Portal that silently discards edits.
    await main.locator(".stage-note-btn").click();
    const noteDialog = main.locator(".dialog-content");
    await noteDialog.waitFor({ state: "visible" });
    const noteInput = noteDialog.locator("input.note-input");
    const noteDraft = `RUNTIME-CLOSE-UNSAVED-DRAFT-${generatedTransactionId}`;
    await noteInput.fill(noteDraft);
    assert.equal(await noteDialog.evaluate((element) => element.closest(".app-shell") === null), true, "The close fixture must exercise a real body-level Portal");
    const noteSave = noteDialog.locator(".dialog-footer button").filter({ hasText: /^保存$/ });
    const noteInputBounds = await noteInput.boundingBox();
    const noteSaveBounds = await noteSave.boundingBox();
    const noteDialogBounds = await noteDialog.boundingBox();
    assert(noteInputBounds && noteSaveBounds && noteDialogBounds, "The Portal note draft and Save control must be visible before native close");
    const viewport = await main.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const outsidePoint = [{ x: 4, y: 4 }, { x: viewport.width - 4, y: 4 }, { x: 4, y: viewport.height - 4 }]
      .find((point) => point.x < noteDialogBounds.x || point.x > noteDialogBounds.x + noteDialogBounds.width
        || point.y < noteDialogBounds.y || point.y > noteDialogBounds.y + noteDialogBounds.height);
    assert(outsidePoint, "A real pointer target outside the Portal dialog was not found");
    const title = await native("plugin:window|title", { label: "main" });
    const nativeRequest = await closeMainViaWmClose(title);
    assert.equal(nativeRequest.posted, true);
    await until(() => main.evaluate(() => window.__randdeckRuntimeStore.getState().isClosing
      && window.__randdeckRuntimeStore.getState().ceremony.phase === "idle"
      && document.querySelector(".app-shell")?.inert
      && document.body.inert), "WM_CLOSE did not freeze the main shell and body-level Portal UI while a native save was pending");
    assert.equal(main.isClosed(), false, "Main was destroyed before its pending native save completed");
    assert.equal(display.isClosed(), false, "Display was destroyed before the main close was ready");
    assert.deepEqual(await persistentRuntimeSnapshot(main), expectedSnapshot, "Beginning close changed an accepted persistent state");
    const revisionBeforeAttempts = await main.evaluate(() => window.__randdeckRuntimeStore.getState().revision);
    const portalInertAncestor = await noteSave.evaluate((element) => element.closest("[inert]")?.tagName);
    assert.equal(portalInertAncestor, "BODY", "The Portal Save control is outside the actual inert close boundary");
    // Raw mouse/keyboard delivery intentionally bypasses Playwright's locator
    // actionability wait without bypassing the browser's real inert behavior.
    await main.mouse.click(noteInputBounds.x + noteInputBounds.width / 2, noteInputBounds.y + noteInputBounds.height / 2);
    await main.keyboard.press("Control+A");
    await main.keyboard.type("REJECTED-LATE-DRAFT-EDIT");
    await main.keyboard.press("Enter");
    await main.mouse.click(noteSaveBounds.x + noteSaveBounds.width / 2, noteSaveBounds.y + noteSaveBounds.height / 2);
    await main.keyboard.press("Enter");
    await main.keyboard.press("Escape");
    await main.keyboard.press("Space");
    await main.mouse.click(outsidePoint.x, outsidePoint.y);
    await main.keyboard.press("Escape");
    assert.equal(await noteDialog.count(), 1, "Frozen Portal Save, Enter, Escape, Space or outside pointer dismissed the unsaved note dialog");
    assert.equal(await noteInput.inputValue(), noteDraft, "Frozen Portal keyboard or outside pointer input lost the existing note draft");
    // Exercise real keyboard and pointer delivery against the now inert UI.
    // Use a CSS locator here: ARIA role locators omit genuinely inert controls.
    const frozenQuantity = main.locator(".count-control input");
    const bounds = await frozenQuantity.boundingBox();
    assert(bounds, "The visible quantity field is missing from the frozen UI");
    await main.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await main.keyboard.press("Control+A");
    await main.keyboard.type("49");
    assert.equal(await frozenQuantity.inputValue(), "4", "Frozen UI accepted a late quantity edit");
    assert.equal(await noteDialog.count(), 1, "Late shell keyboard delivery dismissed the inert Portal dialog");
    assert.equal(await noteInput.inputValue(), noteDraft, "Late shell keyboard delivery changed the inert Portal draft");
    const attemptedActions = await main.evaluate(() => {
      const store = window.__randdeckRuntimeStore.getState();
      const entry = store.history.find((item) => item.transactionId === store.drawState.lastTransactionId);
      if (!entry) throw new Error("The real draw is missing for the late-commit guard test");
      const transaction = {
        id: `runtime-rejected-late-${Date.now()}`, createdAt: new Date().toISOString(), mode: entry.mode,
        configSnapshot: structuredClone(entry.config), poolsSnapshot: structuredClone(store.pools),
        poolFingerprint: entry.poolFingerprint, results: structuredClone(entry.results),
        operation: entry.operation || { kind: "draw" }, statsDelta: structuredClone(entry.statsDelta),
        usedAdded: structuredClone(entry.usedAdded || []), candidateCount: 100,
        candidateSpec: { mode: entry.mode, exclusions: "", selectedTags: [], tagCombine: "any" },
        algorithmVersion: "webcrypto-rejection-v1",
      };
      store.updateSettings({ count: 49 });
      store.updatePools({ customEntries: [{ id: "runtime-rejected-late-pool", value: 999, tags: [] }] });
      store.commitTransaction(transaction);
      store.updateHistoryNote(entry.id, "runtime-rejected-late-note");
      store.setView("settings");
      store.clearHistory();
      return ["updateSettings", "updatePools", "commitTransaction", "updateHistoryNote", "setView", "clearHistory"];
    });
    assert.deepEqual(await persistentRuntimeSnapshot(main), expectedSnapshot, "A persistent action was accepted after native close began");
    assert.equal(await main.evaluate(() => window.__randdeckRuntimeStore.getState().revision), revisionBeforeAttempts, "Rejected close-period actions changed the store revision");
    assert.equal(await main.evaluate(() => window.__randdeckCloseSaveGate.released), false, "Slow save was released before the guard assertions completed");
    await writeFile(closeExpectedFile, `${JSON.stringify({ sourceCommit: report.sourceCommit, sessionId: runtimeSessionId,
      executableSha256: report.executableSha256, generatedTransactionId, snapshot: expectedSnapshot }, null, 2)}\n`, "utf8");
    await screenshot(main, "native-close-pending-save-frozen");
    slowClose = { nativeRequest, pendingSaveBlocked: true, mainRetainedUntilSaved: true,
      displayRetainedUntilSaved: true, inert: true, acceptedTransactionId: generatedTransactionId,
      bodyInert: true, portalNote: { outsideAppShell: true, inertAncestor: portalInertAncestor,
        saveAndEnterBlocked: true, escapeSpaceAndOutsidePointerBlocked: true, outsidePointerCoordinates: outsidePoint,
        draftRetained: true, dialogRetained: true },
      historyCount: expectedSnapshot.history.length, rejectedActions: attemptedActions,
      rejectedKeyboardEdit: true, revisionBeforeAttempts, revisionAfterAttempts: revisionBeforeAttempts,
      expectedSnapshot: repoPath(closeExpectedFile),
      fixture: "One real plugin:store|save delayed before forwarding unchanged request/response; genuine WM_CLOSE, real store actions and keyboard/pointer attempts" };
    report.slowClose = slowClose;
    return slowClose;
  });

  await check("native-main-close-closes-display", async () => {
    assert.equal(display.isClosed(), false, "Display must remain open when closing main");
    assert(slowClose?.pendingSaveBlocked, "The native close must exercise the pending save scenario");
    await collectIpc();
    const disconnected = new Promise((done, reject) => {
      if (!browser.isConnected()) { done(); return; }
      const timeout = setTimeout(() => reject(new Error("WebView2 did not disconnect after closing main")), 15_000);
      browser.once("disconnected", () => { clearTimeout(timeout); done(); });
    });
    const closed = Promise.all([main.waitForEvent("close", { timeout: 15_000 }), display.waitForEvent("close", { timeout: 15_000 }), disconnected]);
    void closed.catch(() => undefined);
    report.nativeClose = slowClose.nativeRequest;
    assert.equal(report.nativeClose.posted, true);
    await main.evaluate(() => window.__randdeckCloseSaveGate.release());
    await closed;
    report.shutdown = { mainClosed: main.isClosed(), displayClosed: display.isClosed(), cdpDisconnected: !browser.isConnected(),
      pendingSaveReleasedToNative: true, savedSnapshotAndReopen: "caller guard verifies full persisted and hydrated snapshots", exeProcessExitAndRestart: "caller guard" };
    assert(report.shutdown.mainClosed && report.shutdown.displayClosed && report.shutdown.cdpDisconnected);
    return report.shutdown;
  });

  report.cleanSource = report.cleanSource && cleanSource() && report.sourceCommit === git("rev-parse", "HEAD");
  assert(report.cleanSource, "Source changed while verifying the release EXE");
  assert.equal(createHash("sha256").update(await readFile(executable)).digest("hex"), report.executableSha256, "Executable changed during verification");
  report.passed = true;
} catch (error) {
  report.failure = error?.stack || String(error);
  process.exitCode = 1;
  if (main && !main.isClosed()) await screenshot(main, "failure-main").catch(() => undefined);
  if (display && !display.isClosed()) await screenshot(display, "failure-display").catch(() => undefined);
  await collectIpc().catch((failure) => { report.consoleErrors.push(`Evidence collection: ${failure.message}`); });
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(reportDir, "runtime-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (browser?.isConnected()) await browser.close();
}
}
