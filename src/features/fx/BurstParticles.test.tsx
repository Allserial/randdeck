import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BurstParticles } from "./BurstParticles";
import { createDefaultState } from "../../app/state";
import { useAppStore } from "../../app/store";

const clearRect = vi.fn();

beforeEach(() => {
  useAppStore.setState(createDefaultState("zh-CN"));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect } as unknown as CanvasRenderingContext2D);
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  clearRect.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("display particle appearance", () => {
  it.each([
    { theme: "dark", motion: "ceremony", particles: false },
    { theme: "dark", motion: "instant", particles: true },
    { theme: "contrast", motion: "ceremony", particles: true },
  ] as const)("suppresses particles with the synchronized preference %j", (appearance) => {
    render(<BurstParticles active token="display-finished" fullscreen appearance={appearance} />);
    expect(clearRect).toHaveBeenCalled();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("takes synchronized display preferences rather than the uninitialized display store", () => {
    const state = useAppStore.getState();
    useAppStore.setState({ settings: { ...state.settings, appearance: { ...state.settings.appearance, particles: false, motion: "instant", theme: "contrast" } } });
    const view = render(<BurstParticles active token="display-finished" fullscreen appearance={{ theme: "light", motion: "ceremony", particles: true }} />);
    expect(window.requestAnimationFrame).toHaveBeenCalledOnce();
    view.rerender(<BurstParticles active token="display-finished" fullscreen appearance={{ theme: "light", motion: "ceremony", particles: false }} />);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(clearRect).toHaveBeenCalled();
  });
});
