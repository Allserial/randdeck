import { describe, expect, it } from "vitest";
import { createDefaultState } from "../app/state";
import { executeDraw, prepareDraw } from "./draw";
import { buildCompleteCsv, buildSessionCsv } from "./export";
import { SeededRandomSource } from "./random";
import type { DrawSession } from "./types";

describe("complete exports", () => {
  it("includes configuration, history and independent statistics", () => {
    const state = createDefaultState(); state.settings.count = 1;
    const transaction = executeDraw(prepareDraw(state), new SeededRandomSource(3));
    state.history = [{ id: "h", transactionId: transaction.id, createdAt: transaction.createdAt, mode: transaction.mode, config: transaction.configSnapshot, results: transaction.results, operation: transaction.operation, statsDelta: transaction.statsDelta, poolFingerprint: transaction.poolFingerprint, usedAdded: transaction.usedAdded, legacy: false }];
    state.stats.byMode.range.draws = 1; state.stats.byMode.range.values[String(transaction.results[0].total)] = 1;
    const csv = buildCompleteCsv(state);
    expect(csv).toContain("recordType");
    expect(csv).toContain("history");
    expect(csv).toContain("stats-value");
  });

  it("exports session records independently from ordinary history", () => {
    const state = createDefaultState(); const plan = prepareDraw(state);
    const session: DrawSession = { id: "s", name: "会话", startedAt: new Date(0).toISOString(), configSnapshot: state.settings, poolsSnapshot: state.pools, poolFingerprint: plan.poolFingerprint, transactionIds: [], transactionRecords: [], roundCount: 0 };
    const transaction = executeDraw(plan, new SeededRandomSource(2), session);
    session.transactionIds.push(transaction.id); session.transactionRecords.push({ id: transaction.id, createdAt: transaction.createdAt, results: transaction.results, operation: transaction.operation, statsDelta: transaction.statsDelta, poolFingerprint: transaction.poolFingerprint, usedAdded: transaction.usedAdded }); session.roundCount = 1;
    expect(buildSessionCsv(session)).toContain(transaction.id);
  });
});
