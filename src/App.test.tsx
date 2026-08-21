import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { createDefaultState } from "./app/state";
import { useAppStore } from "./app/store";
import { cancelCeremony } from "./app/drawController";

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    ...createDefaultState(),
    hydrated: true,
    hydrationSource: "test",
    warnings: [],
    history: [],
    currentResults: [],
    previewResults: [],
    isDrawing: false,
    error: "",
    toast: "",
    revision: 0,
    ceremony: { phase: "idle", remainingSeconds: 0, revealedCount: 0, targetTransaction: null },
  });
});

describe("application shell", () => {
  it("opens the real roll workspace as the first screen", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "掷数台" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: /等待抽取|本次结果/ }, { timeout: 4000 })).toBeVisible();
    expect(screen.getByRole("button", { name: /生成结果/ })).toBeEnabled();
  });

  it("opens custom pool editing from the roll inspector", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /自定义池/ }));
    expect(await screen.findByRole("button", { name: /编辑数字池/ }, { timeout: 4000 })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /编辑数字池/ }));
    expect(await screen.findByRole("heading", { name: "自定义数字池" }, { timeout: 4000 })).toBeVisible();
  });

  it("uses the card brand mark and starts countdown with Shift+Space", async () => {
    render(<App />);
    expect(screen.getByRole("img", { name: "掷数台" })).toBeVisible();
    await screen.findByRole("heading", { name: /等待抽取|本次结果/ }, { timeout: 4000 });

    fireEvent.keyDown(window, { key: " ", code: "Space", shiftKey: true });
    await waitFor(() => expect(useAppStore.getState().ceremony.phase).toBe("countdown"));
    cancelCeremony();
  });

  it("does not steal shortcuts from inputs or Shift+Enter", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: /等待抽取|本次结果/ }, { timeout: 4000 });
    const exclusionInput = screen.getByRole("textbox", { name: "排除数字" });
    fireEvent.keyDown(exclusionInput, { key: " ", code: "Space" });
    fireEvent.keyDown(window, { key: "Enter", code: "Enter", shiftKey: true });
    expect(useAppStore.getState().ceremony.phase).toBe("idle");
    expect(useAppStore.getState().currentResults).toEqual([]);
  });
});
