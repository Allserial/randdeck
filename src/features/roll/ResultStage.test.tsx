import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultState } from "../../app/state";
import { snapshotState, useAppStore } from "../../app/store";
import { executeDraw, prepareDraw } from "../../domain/draw";
import { SeededRandomSource } from "../../domain/random";
import ResultStage from "./ResultStage";

vi.mock("../fx/BurstParticles", () => ({ BurstParticles: () => null }));

beforeEach(() => {
  useAppStore.setState({ ...createDefaultState("zh-CN"), hydrated: false, currentResults: [], previewResults: [], resultPresentation: null,
    resultInteraction: { transactionId: null, selectedIndices: [], pinnedIndices: [], rollingIndices: null },
    ceremony: { phase: "idle", remainingSeconds: 0, revealedCount: 0, targetTransaction: null }, isDrawing: false, error: "", toast: "", revision: 0 });
});

function draw(seed: number) {
  const transaction = executeDraw(prepareDraw(snapshotState()), new SeededRandomSource(seed));
  useAppStore.getState().commitTransaction(transaction);
  return useAppStore.getState().history[0];
}

describe("stage transaction notes", () => {
  it("does not offer another transaction's note after the displayed history was removed", () => {
    const first = draw(1);
    const second = draw(2);
    useAppStore.getState().updateHistoryNote(first.id, "A note");
    useAppStore.getState().deleteHistory(second.id);
    const { container } = render(<ResultStage />);
    expect(container.querySelector(".stage-note-btn")).toBeNull();
    expect(useAppStore.getState().history[0].note).toBe("A note");
  });

  it("keeps the open note editor bound to its original history entry", () => {
    const first = draw(1);
    const { container } = render(<ResultStage />);
    fireEvent.click(container.querySelector(".stage-note-btn")!);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A edited" } });
    let secondId = "";
    act(() => { secondId = draw(2).id; });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(useAppStore.getState().history.find(({ id }) => id === first.id)?.note).toBe("A edited");
    expect(useAppStore.getState().history.find(({ id }) => id === secondId)?.note).toBeUndefined();
  });

  it("disables saving if the target entry disappears while the editor is open", () => {
    draw(1);
    const second = draw(2);
    const { container } = render(<ResultStage />);
    fireEvent.click(container.querySelector(".stage-note-btn")!);
    act(() => { useAppStore.getState().deleteHistory(second.id); });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    const form = screen.getByRole("textbox").closest("form")!;
    fireEvent.submit(form);
    expect(useAppStore.getState().history[0].note).toBeUndefined();
  });
});
