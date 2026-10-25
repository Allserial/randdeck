import Papa from "papaparse";
import type { PoolEntry } from "../../domain/types";
import { createId } from "../../domain/random";
import { runtimeError } from "../../domain/runtimeMessage";

function validateEntries(rows: unknown): PoolEntry[] {
  if (!Array.isArray(rows)) throw runtimeError("errors.poolImportFormat");
  if (!rows.length) throw runtimeError("errors.noNumbers");
  if (rows.length > 500) throw runtimeError("errors.poolRowsLimit", { count: 500 });
  const ids = new Set<string>();
  return rows.map((raw: unknown, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw runtimeError("errors.rowInvalid", { row: index + 1 });
    const entry = raw as Record<string, unknown>;
    if (typeof entry.value !== "number" || !Number.isSafeInteger(entry.value)
      || (entry.tags !== undefined && (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== "string")))) {
      throw runtimeError("errors.rowInvalid", { row: index + 1 });
    }
    const suppliedId = typeof entry.id === "string" && entry.id.trim() ? entry.id : undefined;
    const id = suppliedId && !ids.has(suppliedId) ? suppliedId : createId("custom");
    ids.add(id);
    return { id, value: entry.value, tags: entry.tags === undefined ? [] : [...entry.tags as string[]] };
  });
}

export function parsePoolImport(text: string, filename: string): PoolEntry[] {
  const source = text.replace(/^\uFEFF/, "");
  if (filename.toLowerCase().endsWith(".json")) {
    const data: unknown = JSON.parse(source);
    if (Array.isArray(data)) return validateEntries(data);
    if (!data || typeof data !== "object") throw runtimeError("errors.poolImportFormat");
    const object = data as Record<string, unknown>;
    const pools = object.pools && typeof object.pools === "object" ? object.pools as Record<string, unknown> : undefined;
    return validateEntries(Array.isArray(object.entries) ? object.entries : pools?.customEntries);
  }

  const csv = Papa.parse<string[]>(source, { delimiter: ",", skipEmptyLines: "greedy" });
  if (csv.errors.length) throw runtimeError("errors.rowInvalid", { row: (csv.errors[0].row ?? 0) + 1 });
  if (!csv.data.length) throw runtimeError("errors.noNumbers");
  const header = csv.data[0].map((cell) => cell.trim().toLowerCase());
  const valueColumn = header.findIndex((cell) => cell === "数字" || cell === "value");
  const tagsColumn = header.findIndex((cell) => cell === "标签" || cell === "tags");
  const parseValue = (cell: string | undefined, row: number) => {
    if (cell === undefined || !/^[+-]?\d+$/.test(cell.trim()) || !Number.isSafeInteger(Number(cell))) {
      throw runtimeError("errors.rowInvalid", { row });
    }
    return Number(cell);
  };
  // Numeric-only CSV is retained for simple pools; tagged files require named columns.
  if (valueColumn < 0) {
    if (!csv.data.every((row) => row.every((cell) => /^[+-]?\d+$/.test(cell.trim())))) throw runtimeError("errors.poolImportFormat");
    return validateEntries(csv.data.flatMap((row, index) => row.map((cell) => ({ value: parseValue(cell, index + 1), tags: [] }))));
  }
  return validateEntries(csv.data.slice(1).map((row, index) => {
    if (row.length !== header.length) throw runtimeError("errors.rowInvalid", { row: index + 2 });
    return {
      value: parseValue(row[valueColumn], index + 2),
      tags: tagsColumn < 0 || !row[tagsColumn] ? [] : row[tagsColumn].split("|"),
    };
  }));
}

export function exportPoolCsv(entries: PoolEntry[]): string {
  return `\uFEFF${Papa.unparse(entries.map((entry) => ({ 数字: entry.value, 标签: entry.tags.join("|") })))}`;
}
