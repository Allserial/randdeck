import { afterEach, expect, it, vi } from "vitest";
import { closeCurrentDisplayWindow, listenDisplayState } from "./desktop";

vi.mock("./persistence", () => ({ isTauriRuntime: () => false }));

afterEach(() => vi.unstubAllGlobals());

it("unsubscribes without closing another display subscription during StrictMode remount", async () => {
  const channels: FakeChannel[] = [];
  class FakeChannel {
    listeners = new Set<(event: MessageEvent) => void>();
    constructor() { channels.push(this); }
    addEventListener(_type: string, listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
    removeEventListener(_type: string, listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
    postMessage(data: unknown) {
      for (const peer of channels) {
        if (peer !== this) for (const listener of peer.listeners) listener({ data } as MessageEvent);
      }
    }
    close() { this.listeners.clear(); }
  }
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  const close = vi.fn();
  vi.stubGlobal("window", { close });
  const disposeFirst = await listenDisplayState(vi.fn());
  const receive = vi.fn();
  const disposeSecond = await listenDisplayState(receive);
  disposeFirst();
  expect(close).not.toHaveBeenCalled();
  const sender = new FakeChannel();
  sender.postMessage({ type: "state", payload: { summary: "current" } });
  expect(receive).toHaveBeenCalledWith({ summary: "current" });
  await closeCurrentDisplayWindow();
  expect(close).toHaveBeenCalled();
  disposeSecond();
});
