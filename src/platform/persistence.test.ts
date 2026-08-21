import { describe, expect, it } from "vitest";
import { createDefaultState } from "../app/state";
import { loadPersistedState, savePersistedState, type PersistenceAdapter } from "./persistence";

class MemoryAdapter implements PersistenceAdapter {
  envelope: { current?: unknown; lastKnownGood?: unknown } | null = null;
  async load() { return this.envelope; }
  async save(value: { current?: unknown; lastKnownGood?: unknown }) { this.envelope = structuredClone(value); }
}

describe("persistence recovery", () => {
  it("falls back to last known good when current state is corrupt", async () => {
    const adapter = new MemoryAdapter(); const valid = createDefaultState(); valid.settings.min = 9; adapter.envelope = { current: { version: 5, bad: true }, lastKnownGood: valid };
    const loaded = await loadPersistedState(adapter);
    expect(loaded.state.settings.min).toBe(9);
    expect(loaded.source).toBe("v5-last-known-good");
  });

  it("keeps the previous current snapshot as recovery data", async () => {
    const adapter = new MemoryAdapter(); const first = createDefaultState(); first.settings.max = 20; await savePersistedState(first, adapter);
    const second = createDefaultState(); second.settings.max = 30; await savePersistedState(second, adapter);
    expect((adapter.envelope?.current as typeof second).settings.max).toBe(30);
    expect((adapter.envelope?.lastKnownGood as typeof first).settings.max).toBe(20);
  });
});
