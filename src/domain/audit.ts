import { APP_VERSION } from "../app/version";
import type { AppLocale } from "./types";
import type { DrawSession, DrawTransaction, ReceiptPayload } from "./types";
import { modeLabel } from "../lib/labels";
import { runtimeError } from "./runtimeMessage";

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createReceipt(transaction: DrawTransaction): Promise<ReceiptPayload> {
  const candidateDigest = await sha256(canonicalize({ count: transaction.candidateCount, spec: transaction.candidateSpec }));
  const unsigned = {
    schema: "zhishutai.receipt.v1" as const,
    appVersion: APP_VERSION,
    algorithmVersion: transaction.algorithmVersion,
    transactionId: transaction.id,
    createdAt: transaction.createdAt,
    mode: transaction.mode,
    config: transaction.configSnapshot,
    candidate: { ...transaction.candidateSpec, count: transaction.candidateCount, digest: candidateDigest },
    results: transaction.results,
    operation: transaction.operation,
    session: transaction.session,
    presetId: transaction.presetId,
  };
  return { ...unsigned, digest: await sha256(canonicalize(unsigned)) };
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

export async function renderReceiptPng(receipt: ReceiptPayload, locale: AppLocale = "zh-CN"): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const context = canvas.getContext("2d");
  if (!context) throw runtimeError("errors.receiptPngUnavailable");

  // 墨蓝底色 + 琥珀铜饰条
  context.fillStyle = "#0b0d12";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#141821";
  roundedRect(context, 48, 42, 1104, 591, 8);
  context.fillStyle = "#d4a054";
  context.fillRect(48, 42, 7, 591);

  context.fillStyle = "#f0e6d6";
  context.font = '600 34px "Segoe UI Variable", "Segoe UI", sans-serif';
  context.fillText(locale === "en-US" ? "RandDeck · Draw Receipt" : "掷数台 · 抽取回执", 92, 100);

  context.fillStyle = "#9ba3af";
  context.font = '18px "Segoe UI Variable", "Segoe UI", sans-serif';
  context.fillText(new Date(receipt.createdAt).toLocaleString(locale), 92, 137);

  context.fillStyle = "#b5bec9";
  context.font = '16px "Segoe UI Variable", "Segoe UI", sans-serif';
  context.fillText(
    locale === "en-US"
      ? `Mode: ${modeLabel(receipt.mode, locale)}    Candidates: ${receipt.candidate.count.toLocaleString(locale)}    Algorithm: ${receipt.algorithmVersion}`
      : `模式：${modeLabel(receipt.mode, locale)}    候选：${receipt.candidate.count.toLocaleString(locale)}    算法：${receipt.algorithmVersion}`,
    92,
    190,
  );

  const values = receipt.results.map((result) => String(result.total)).join("  ·  ");
  let fontSize = values.length > 34 ? 46 : values.length > 18 ? 62 : 88;
  context.font = `700 ${fontSize}px "Cascadia Mono", Consolas, monospace`;
  while (context.measureText(values).width > 1000 && fontSize > 28) {
    fontSize -= 4;
    context.font = `700 ${fontSize}px "Cascadia Mono", Consolas, monospace`;
  }
  context.fillStyle = "#e8c36a";
  context.fillText(values, 92, 340);

  context.fillStyle = "#1e2430";
  roundedRect(context, 92, 410, 1016, 92, 6);
  context.fillStyle = "#d4dce5";
  context.font = '17px "Segoe UI Variable", "Segoe UI", sans-serif';
  const source =
    receipt.mode === "expression"
      ? receipt.config.expression.source
      : receipt.mode === "range"
        ? `${receipt.config.min}..${receipt.config.max}`
        : locale === "en-US"
          ? `${receipt.candidate.entries?.length ?? 0} entries`
          : `${receipt.candidate.entries?.length ?? 0} 个条目`;
  context.fillText(
    locale === "en-US"
      ? `Source: ${source}    Count: ${receipt.config.count.toLocaleString(locale)}    Remove after draw: ${receipt.config.noDup ? "Yes" : "No"}`
      : `来源：${source}    数量：${receipt.config.count.toLocaleString(locale)}    抽后移除：${receipt.config.noDup ? "是" : "否"}`,
    118,
    450,
  );
  context.fillText(
    locale === "en-US"
      ? `Exclude: ${receipt.config.excludeInput || "None"}    Tags: ${receipt.config.tagFilter.selectedTags.join(", ") || "None"}`
      : `排除：${receipt.config.excludeInput || "无"}    标签：${receipt.config.tagFilter.selectedTags.join("、") || "无"}`,
    118,
    482,
  );

  context.fillStyle = "#7b8594";
  context.font = '14px "Cascadia Mono", Consolas, monospace';
  context.fillText(`SHA256 ${receipt.digest}`, 92, 575);
  context.fillText(
    locale === "en-US" ? `RandDeck ${receipt.appVersion} · Fully offline` : `掷数台 ${receipt.appVersion} · 完全离线生成`,
    92,
    605,
  );

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(runtimeError("errors.pngEncodingFailed"))), "image/png")
  );
}

export async function renderSessionSummaryPng(session: DrawSession, values: number[], locale: AppLocale = "zh-CN"): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const context = canvas.getContext("2d");
  if (!context) throw runtimeError("errors.sessionPngUnavailable");

  context.fillStyle = "#0b0d12";
  context.fillRect(0, 0, 1200, 675);
  context.fillStyle = "#d4a054";
  context.fillRect(52, 52, 8, 570);

  context.fillStyle = "#f0e6d6";
  context.font = '700 40px "Segoe UI Variable", "Segoe UI", sans-serif';
  context.fillText(session.name, 100, 118);

  context.fillStyle = "#9ba3af";
  context.font = '20px "Segoe UI Variable", "Segoe UI", sans-serif';
  context.fillText(
    locale === "en-US"
      ? `${session.roundCount.toLocaleString(locale)} rounds · ${values.length.toLocaleString(locale)} results`
      : `${session.roundCount.toLocaleString(locale)} 轮 · ${values.length.toLocaleString(locale)} 个结果`,
    100,
    158,
  );

  context.fillStyle = "#e8c36a";
  context.font = '700 54px "Cascadia Mono", Consolas, monospace';
  const preview = values.slice(0, 30).join("  ·  ");
  context.fillText(preview.slice(0, 44), 100, 300);
  if (preview.length > 44) context.fillText(preview.slice(44, 88), 100, 380);

  context.fillStyle = "#7b8594";
  context.font = '16px "Segoe UI Variable", "Segoe UI", sans-serif';
  context.fillText(
    locale === "en-US"
      ? `Started: ${new Date(session.startedAt).toLocaleString(locale)}`
      : `开始：${new Date(session.startedAt).toLocaleString(locale)}`,
    100,
    545,
  );
  context.fillText(
    locale === "en-US"
      ? `Ended: ${new Date(session.endedAt || Date.now()).toLocaleString(locale)}`
      : `结束：${new Date(session.endedAt || Date.now()).toLocaleString(locale)}`,
    100,
    575,
  );

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(runtimeError("errors.pngEncodingFailed"))), "image/png")
  );
}
