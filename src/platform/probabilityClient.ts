import type { ProbabilityReport, ProbabilityRequest } from "../domain/types";
import { createId } from "../domain/random";
import { createRuntimeMessage } from "../domain/runtimeMessage";

interface WorkerMessage {
  type: "progress" | "complete" | "error";
  id: string;
  progress?: number;
  report?: ProbabilityReport;
  error?: string;
  aborted?: boolean;
}

export function analyzeProbability(
  request: ProbabilityRequest,
  options: { samples?: number; seed?: number; signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<ProbabilityReport> {
  const id = createId("probability");
  const worker = new Worker(new URL("../workers/probability.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const close = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort); };
    const abort = () => { worker.postMessage({ type: "cancel", id }); close(); reject(new DOMException("Probability analysis cancelled", "AbortError")); };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.id !== id) return;
      if (event.data.type === "progress") options.onProgress?.(event.data.progress || 0);
      if (event.data.type === "complete" && event.data.report) { close(); resolve(event.data.report); }
      if (event.data.type === "error") { close(); reject(new Error(event.data.error || createRuntimeMessage("errors.probabilityFailed"))); }
    };
    worker.onerror = (event) => { close(); reject(new Error(event.message || createRuntimeMessage("errors.probabilityWorkerFailed"))); };
    worker.postMessage({ type: "analyze", id, request, samples: options.samples, seed: options.seed });
  });
}
