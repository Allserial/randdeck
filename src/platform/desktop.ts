import type { CeremonyPhase, DrawResult, ThemeMode } from "../domain/types";
import { isTauriRuntime } from "./persistence";

export interface DisplayPayload {
  results: DrawResult[];
  mode: string;
  summary: string;
  theme: ThemeMode;
  animationToken: string;
  ceremony?: {
    phase: CeremonyPhase;
    remainingSeconds: number;
    revealedCount: number;
    totalCount: number;
  };
}

let browserDisplay: BroadcastChannel | null = null;

type BrowserDisplayMessage =
  | { type: "state"; payload: DisplayPayload }
  | { type: "ready" }
  | { type: "close" };

function getBrowserDisplayChannel(): BroadcastChannel {
  browserDisplay ??= new BroadcastChannel("zhishutai-display");
  return browserDisplay;
}

export async function applyWindowMaterial(theme: ThemeMode): Promise<void> {
  if (!isTauriRuntime()) return;
  const { Effect, EffectState, getCurrentWindow } = await import("@tauri-apps/api/window");
  try {
    if (theme === "contrast") await getCurrentWindow().clearEffects();
    else await getCurrentWindow().setEffects({ effects: [Effect.Mica], state: EffectState.Active });
  } catch {
    /* Opaque CSS surfaces remain the supported fallback. */
  }
}

export async function openDisplayWindow(mode: "normal" | "fullscreen" | "overlay"): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(`${location.origin}${location.pathname}?view=display`, "zhishutai-display", "width=1280,height=720");
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  let display = await WebviewWindow.getByLabel("display");
  if (!display) {
    display = new WebviewWindow("display", {
      url: "index.html?view=display",
      title: "掷数台 · 展示",
      width: 1280,
      height: 720,
      minWidth: 640,
      minHeight: 360,
      decorations: false,
      transparent: true,
      visible: true,
    });
    await new Promise<void>((resolve, reject) => {
      display!.once("tauri://created", () => resolve());
      display!.once("tauri://error", (event) => reject(new Error(String(event.payload))));
    });
  }
  await setDisplayWindowMode(mode, false);
  await display.show();
  await display.setFocus();
}

export async function setDisplayWindowMode(mode: "normal" | "fullscreen" | "overlay", clickThrough: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const display = await WebviewWindow.getByLabel("display");
  if (!display) return;
  await display.setFullscreen(mode === "fullscreen");
  await display.setAlwaysOnTop(mode === "overlay");
  await display.setIgnoreCursorEvents(mode === "overlay" && clickThrough);
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("display", "display://mode", { mode });
}

export async function closeCurrentDisplayWindow(): Promise<void> {
  if (isTauriRuntime()) {
    const [{ emitTo }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
    ]);
    await emitTo("main", "display://close", {});
    await getCurrentWindow().close();
    return;
  }
  getBrowserDisplayChannel().postMessage({ type: "close" } satisfies BrowserDisplayMessage);
  window.close();
}

export async function publishDisplayState(payload: DisplayPayload): Promise<void> {
  if (isTauriRuntime()) {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("display", "display://state", payload).catch(() => undefined);
    return;
  }
  getBrowserDisplayChannel().postMessage({ type: "state", payload } satisfies BrowserDisplayMessage);
}

export async function listenDisplayReady(callback: () => void): Promise<() => void> {
  if (isTauriRuntime()) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("display://ready", callback);
  }
  const channel = getBrowserDisplayChannel();
  const listener = (event: MessageEvent<BrowserDisplayMessage>) => {
    if (event.data?.type === "ready") callback();
  };
  channel.addEventListener("message", listener);
  return () => channel.removeEventListener("message", listener);
}

export async function listenDisplayState(callback: (payload: DisplayPayload) => void): Promise<() => void> {
  if (isTauriRuntime()) {
    const { listen, emitTo } = await import("@tauri-apps/api/event");
    const unlisten = await listen<DisplayPayload>("display://state", (event) => callback(event.payload));
    await emitTo("main", "display://ready", {});
    return unlisten;
  }
  const channel = new BroadcastChannel("zhishutai-display");
  const listener = (event: MessageEvent<BrowserDisplayMessage>) => {
    if (event.data?.type === "state") callback(event.data.payload);
    if (event.data?.type === "close") window.close();
  };
  channel.addEventListener("message", listener);
  channel.postMessage({ type: "ready" } satisfies BrowserDisplayMessage);
  return () => {
    channel.postMessage({ type: "close" } satisfies BrowserDisplayMessage);
    channel.removeEventListener("message", listener);
    channel.close();
  };
}
