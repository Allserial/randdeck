import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultState } from "../../app/state";
import { useAppStore } from "../../app/store";
import DrawInspector from "./DrawInspector";

beforeEach(() => {
  useAppStore.setState({ ...createDefaultState(), hydrated: true, hydrationSource: "test", warnings: [], currentResults: [], previewResults: [], isDrawing: false, error: "", toast: "", revision: 0 });
});

describe("DrawInspector", () => {
  it("shows exclusion tokens and removes one without splitting 357", () => {
    useAppStore.getState().updateSettings({ excludeInput: "3,5,357" });
    render(<DrawInspector />);
    fireEvent.click(screen.getByRole("button", { name: /3×/ }));
    expect(useAppStore.getState().settings.excludeInput).toBe("5,357");
  });

  it("keeps range controls editable on the inspector", () => {
    render(<DrawInspector />);
    expect(screen.getByRole("spinbutton", { name: "最小值" })).toBeEnabled();
    expect(screen.queryByText("已锁定")).toBeNull();
  });

  it("renders advanced tags section ONLY in custom mode", () => {
    // 范围模式下不渲染高级标签
    useAppStore.getState().updateSettings({ mode: "range" });
    const { unmount } = render(<DrawInspector />);
    expect(screen.queryByRole("button", { name: /高级标签/ })).toBeNull();
    unmount();

    // 骰子模式下不渲染高级标签
    useAppStore.getState().updateSettings({ mode: "expression" });
    const { unmount: unmountDice } = render(<DrawInspector />);
    expect(screen.queryByRole("button", { name: /高级标签/ })).toBeNull();
    unmountDice();

    // 自定义模式下渲染高级标签
    useAppStore.getState().updateSettings({ mode: "custom" });
    render(<DrawInspector />);
    expect(screen.getByRole("button", { name: /高级标签/ })).toBeVisible();
  });

  it("renders dice presets grouped into categories", () => {
    useAppStore.getState().updateSettings({ mode: "expression" });
    render(<DrawInspector />);
    expect(screen.getByText("基础骰面")).toBeVisible();
    expect(screen.getByText("检定")).toBeVisible();
    expect(screen.getByText("属性")).toBeVisible();
    expect(screen.getByText("伤害")).toBeVisible();
    expect(screen.getByRole("button", { name: "4d6kh3" })).toBeVisible();
  });

  it("keeps count input draft local and restores invalid or escaped edits", () => {
    render(<DrawInspector />);
    const input = screen.getByRole("textbox", { name: "生成数量" });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("5");
    expect(screen.getByText("请输入 1–50 的整数")).toBeVisible();

    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(useAppStore.getState().settings.count).toBe(50);

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("50");
  });

  it("shows a two-purpose summary and clears all exclusion source text", () => {
    useAppStore.getState().updateSettings({ excludeInput: "3,5" });
    render(<DrawInspector />);
    expect(screen.getByText(/范围 1–100 · 可抽/)).toBeVisible();
    const clear = screen.getByRole("button", { name: "清空排除规则" });
    fireEvent.click(clear);
    expect(useAppStore.getState().settings.excludeInput).toBe("");
    expect(screen.getByRole("textbox", { name: "排除数字" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "清空排除规则" })).toBeNull();
  });
});
