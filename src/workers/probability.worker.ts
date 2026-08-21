/// <reference lib="webworker" />
import { analyzeProbabilityLocal } from "../domain/probability";
import type { ProbabilityRequest } from "../domain/types";

const controllers = new Map<string, AbortController>();

self.addEventListener("message", async (event: MessageEvent<{ type: "analyze" | "cancel"; id: string; request?: ProbabilityRequest; samples?: number; seed?: number }>) => {
  const message = event.data;
  if (message.type === "cancel") { controllers.get(message.id)?.abort(); return; }
  if (!message.request) return;
  const controller = new AbortController(); controllers.set(message.id, controller);
  try {
    const report = await analyzeProbabilityLocal(message.request, { samples: message.samples, seed: message.seed, signal: controller.signal, onProgress: (progress) => self.postMessage({ type: "progress", id: message.id, progress }) });
    self.postMessage({ type: "complete", id: message.id, report });
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, error: (error as Error).message, aborted: (error as Error).name === "AbortError" });
  } finally { controllers.delete(message.id); }
});

export {};
