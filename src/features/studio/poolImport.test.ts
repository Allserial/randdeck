import { describe, expect, it } from "vitest";
import { exportPoolCsv, parsePoolImport } from "./poolImport";

describe("pool file import", () => {
  it("round-trips CSV values and numeric, quoted, comma and newline labels", () => {
    const entries = [
      { id: "a", value: -3, tags: ["2026", "红色", 'a,"b"', "两\n行"] },
      { id: "b", value: 42, tags: [] },
    ];
    const restored = parsePoolImport(exportPoolCsv(entries), "pool.csv");
    expect(restored.map(({ value, tags }) => ({ value, tags }))).toEqual(entries.map(({ value, tags }) => ({ value, tags })));
    expect(restored.map((entry) => entry.value)).toEqual([-3, 42]);
  });

  it.each([
    '[{"value":1,"tags":["2026"]}]',
    '{"entries":[{"value":1,"tags":["2026"]}]}',
    '{"pools":{"customEntries":[{"value":1,"tags":["2026"]}]}}',
  ])("accepts each documented JSON shape: %s", (source) => {
    expect(parsePoolImport(source, "pool.json")).toEqual([{ id: expect.any(String), value: 1, tags: ["2026"] }]);
  });

  it("accepts English CSV columns and legacy numeric-only CSV", () => {
    expect(parsePoolImport("value,tags\n1,2026|red\n2,", "pool.csv").map(({ value, tags }) => ({ value, tags }))).toEqual([
      { value: 1, tags: ["2026", "red"] }, { value: 2, tags: [] },
    ]);
    expect(parsePoolImport("1,2\n3,4", "pool.csv").map(({ value }) => value)).toEqual([1, 2, 3, 4]);
    expect(parsePoolImport("1\n2\n3", "pool.csv").map(({ value }) => value)).toEqual([1, 2, 3]);
  });

  it.each([
    ['{"entries":{}}', "pool.json"],
    ['[{"value":"1"}]', "pool.json"],
    ['[{"value":1,"tags":[1]}]', "pool.json"],
    ["数字,标签\n,2026", "pool.csv"],
    ["数字,标签\n1.5,red", "pool.csv"],
    ["数字,标签\n1,red,2026", "pool.csv"],
    ["wrong,headers\n1,2026", "pool.csv"],
  ])("rejects malformed data without creating accidental candidates", (source, name) => {
    expect(() => parsePoolImport(source, name)).toThrow();
  });

  it("rejects excess rows and replaces duplicate identifiers", () => {
    expect(() => parsePoolImport(JSON.stringify(Array.from({ length: 501 }, (_, value) => ({ value }))), "pool.json")).toThrow();
    const entries = parsePoolImport('[{"id":"a","value":1},{"id":"a","value":2}]', "pool.json");
    expect(new Set(entries.map(({ id }) => id)).size).toBe(2);
  });
});
