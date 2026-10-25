import { beforeEach, describe, expect, it, vi } from "vitest";
import { listenDisplayState, listenMainWindowClose, openDisplayWindow, startDisplayWindowDrag, type DisplayPayload } from "./desktop";

const mocks = vi.hoisted(() => ({
  display: {
    setFullscreen: vi.fn(), setAlwaysOnTop: vi.fn(), setIgnoreCursorEvents: vi.fn(),
    show: vi.fn(), setFocus: vi.fn(),
  },
  main: { onCloseRequested: vi.fn(), destroy: vi.fn(), startDragging: vi.fn() },
  listen: vi.fn(), emitTo: vi.fn(),
}));

vi.mock("./persistence", () => ({ isTauriRuntime: () => true }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: { getByLabel: vi.fn(() => mocks.display) } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks.main }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, emitTo: mocks.emitTo }));

beforeEach(() => vi.resetAllMocks());

describe("desktop window lifecycle", () => {
  it("preserves overlay click-through every time an existing display is reopened", async () => {
    await openDisplayWindow("overlay", true);
    await openDisplayWindow("overlay", true);
    expect(mocks.display.setIgnoreCursorEvents.mock.calls).toEqual([[true], [true]]);
    expect(mocks.display.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    await openDisplayWindow("normal", true);
    expect(mocks.display.setIgnoreCursorEvents).toHaveBeenLastCalledWith(false);
  });

  it("flushes once before destroying the main window and ignores repeated close requests while saving", async () => {
    let finishSave!: () => void;
    const flush = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const onError = vi.fn();
    const cleanup = vi.fn();
    mocks.main.onCloseRequested.mockResolvedValue(cleanup);
    expect(await listenMainWindowClose(flush, onError)).toBe(cleanup);
    const close = mocks.main.onCloseRequested.mock.calls[0][0];
    const event = { preventDefault: vi.fn() };
    const pending = close(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.main.destroy).not.toHaveBeenCalled();
    await close(event);
    expect(flush).toHaveBeenCalledOnce();
    finishSave();
    await pending;
    expect(mocks.main.destroy).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the main window alive after save failure and permits another close attempt", async () => {
    const failure = new Error("disk unavailable");
    const flush = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    await listenMainWindowClose(flush, onError);
    const close = mocks.main.onCloseRequested.mock.calls[0][0];
    await close({ preventDefault: vi.fn() });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(mocks.main.destroy).not.toHaveBeenCalled();
    await close({ preventDefault: vi.fn() });
    expect(mocks.main.destroy).toHaveBeenCalledOnce();
  });

  it("uses the native window dragging API", async () => {
    await startDisplayWindowDrag();
    expect(mocks.main.startDragging).toHaveBeenCalledOnce();
  });

  it("requests a complete snapshot only after the state listener is ready", async () => {
    let subscribe!: (cleanup: () => void) => void;
    const cleanup = vi.fn();
    mocks.listen.mockReturnValue(new Promise<() => void>((resolve) => { subscribe = resolve; }));
    const receive = vi.fn();
    const pending = listenDisplayState(receive);
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());
    expect(mocks.emitTo).not.toHaveBeenCalled();
    subscribe(cleanup);
    expect(await pending).toBe(cleanup);
    expect(mocks.emitTo).toHaveBeenCalledWith("main", "display://ready", {});
    const payload: DisplayPayload = {
      results: [], mode: "range", locale: "zh-CN", summary: "", theme: "contrast", animationToken: "initial",
      windowMode: "overlay", appearance: { particles: false, motion: "instant" },
    };
    mocks.listen.mock.calls[0][1]({ payload });
    expect(receive).toHaveBeenCalledWith(payload);
  });
});
