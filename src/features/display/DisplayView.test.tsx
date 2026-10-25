import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DisplayView from "./DisplayView";
import type { DisplayPayload } from "../../platform/desktop";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), drag: vi.fn(), title: vi.fn(), close: vi.fn() }));
vi.mock("../../platform/desktop", () => ({
  listenDisplayState: mocks.listen, startDisplayWindowDrag: mocks.drag,
  setDisplayWindowTitle: mocks.title, closeCurrentDisplayWindow: mocks.close,
}));
vi.mock("../roll/ResultVisual", () => ({ ResultBoard: () => <div />, StageAstrolabe: () => <div /> }));
vi.mock("../fx/BurstParticles", () => ({ BurstParticles: ({ appearance }: { appearance: unknown }) => <div data-testid="particles" data-appearance={JSON.stringify(appearance)} /> }));

const snapshot: DisplayPayload = {
  results: [], mode: "range", locale: "zh-CN", summary: "", theme: "contrast", animationToken: "initial",
  windowMode: "overlay", appearance: { particles: false, motion: "instant" },
  ceremony: { phase: "finished", remainingSeconds: 0, revealedCount: 0, totalCount: 0 },
};

beforeEach(() => vi.resetAllMocks());

describe("display synchronization", () => {
  it("recovers overlay mode and appearance from the ready snapshot even if the initial mode event was missed", async () => {
    mocks.listen.mockResolvedValue(vi.fn());
    const view = render(<DisplayView />);
    await act(async () => { mocks.listen.mock.calls[0][0](snapshot); });
    expect(view.container.querySelector("main")).toHaveClass("display-view--overlay");
    expect(document.documentElement.dataset.theme).toBe("contrast");
    expect(document.documentElement.dataset.motion).toBe("instant");
    for (const canvas of screen.getAllByTestId("particles")) {
      expect(JSON.parse(canvas.getAttribute("data-appearance")!)).toEqual({ theme: "contrast", particles: false, motion: "instant" });
    }
  });

  it("provides a native drag handle in normal mode without turning close or overlay actions into dragging", async () => {
    mocks.listen.mockResolvedValue(vi.fn());
    const view = render(<DisplayView />);
    const handle = screen.getByTitle("拖动以移动展示窗");
    fireEvent.mouseDown(handle, { button: 0 });
    expect(mocks.drag).toHaveBeenCalledOnce();
    fireEvent.mouseDown(handle, { button: 2 });
    fireEvent.mouseDown(screen.getByRole("button", { name: "关闭展示窗口" }), { button: 0 });
    expect(mocks.drag).toHaveBeenCalledOnce();
    await act(async () => { mocks.listen.mock.calls[0][0](snapshot); });
    fireEvent.mouseDown(view.container.querySelector(".display-brand")!, { button: 0 });
    expect(mocks.drag).toHaveBeenCalledOnce();
  });

  it("releases an asynchronously registered state listener when unmounted early", async () => {
    let finishSubscribe!: (cleanup: () => void) => void;
    mocks.listen.mockReturnValue(new Promise<() => void>((resolve) => { finishSubscribe = resolve; }));
    const view = render(<DisplayView />);
    view.unmount();
    const cleanup = vi.fn();
    await act(async () => { finishSubscribe(cleanup); });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
