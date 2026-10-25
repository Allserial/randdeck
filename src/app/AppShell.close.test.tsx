import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AppShell from "./AppShell";
import { createDefaultState } from "./state";
import { beginStoreClose, endStoreClose, flushStore, initializeStore, useAppStore } from "./store";
import { executeDraw, prepareDraw } from "../domain/draw";
import { SeededRandomSource } from "../domain/random";

vi.mock("../platform/desktop", () => ({
  publishDisplayState: vi.fn(async () => undefined), listenDisplayReady: vi.fn(async () => () => undefined),
  listenMainWindowClose: vi.fn(async () => () => undefined), applyWindowMaterial: vi.fn(async () => undefined),
  setApplicationWindowTitle: vi.fn(async () => undefined),
}));
vi.mock("../platform/audio", () => ({ syncMutedAudio: vi.fn() }));
vi.mock("../features/fx/BurstParticles", () => ({ BurstParticles: () => null }));
vi.mock("../features/roll/RollWorkspace", async () => ({ default: (await import("../features/roll/ResultStage")).default }));

beforeEach(async () => {
  endStoreClose();
  document.body.removeAttribute("inert");
  let current = createDefaultState();
  await initializeStore({
    async load() { return { current, lastKnownGood: current }; },
    async save(value) { current = structuredClone(value.current) as typeof current; },
  });
});
afterEach(async () => { endStoreClose(); await flushStore(); document.body.removeAttribute("inert"); });

it("freezes a body portal and preserves its note draft when closing is cancelled", () => {
  const tx = executeDraw(prepareDraw(useAppStore.getState()), new SeededRandomSource(72));
  useAppStore.getState().commitTransaction(tx);
  const { container } = render(<AppShell />);
  fireEvent.click(container.querySelector(".stage-note-btn")!);
  const draft = screen.getByRole("textbox");
  fireEvent.change(draft, { target: { value: "keep my draft after close failure" } });
  const save = screen.getByRole("button", { name: "保存" });
  expect(container.contains(save)).toBe(false);
  act(() => beginStoreClose());
  expect(document.body).toHaveAttribute("inert");
  expect(save.closest("[inert]")).toBe(document.body);
  fireEvent.keyDown(draft, { key: "Escape" });
  fireEvent.click(save);
  fireEvent.pointerDown(document.body);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(draft).toHaveValue("keep my draft after close failure");
  expect(useAppStore.getState().history.find((entry) => entry.transactionId === tx.id)?.note).toBeUndefined();
  act(() => endStoreClose());
  expect(document.body).not.toHaveAttribute("inert");
  expect(draft).toHaveValue("keep my draft after close failure");
  fireEvent.click(save);
  expect(useAppStore.getState().history.find((entry) => entry.transactionId === tx.id)?.note).toBe("keep my draft after close failure");
});

it("restores an existing body inert attribute and cleans up on unmount", () => {
  document.body.setAttribute("inert", "");
  const { unmount } = render(<AppShell />);
  act(() => beginStoreClose());
  unmount();
  expect(document.body).toHaveAttribute("inert");
});
