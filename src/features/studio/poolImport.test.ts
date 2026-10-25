import { describe, expect, it } from "vitest";
import Papa from "papaparse";
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

  it("round-trips arbitrary JSON-imported strings through JSON-encoded CSV tags", () => {
    const source = [
      { value: 1, tags: ["a|b", "", '["literal JSON"]', '{"key":"value"}', '"quoted"', "line\nnext", "line\r\nnext", "2026", "  "] },
      { value: 2, tags: [""] },
      { value: 3, tags: [] },
    ];
    const fromJson = parsePoolImport(JSON.stringify(source), "pool.json");
    const csv = exportPoolCsv(fromJson);
    const restored = parsePoolImport(csv, "pool.csv");
    expect(restored.map(({ value, tags }) => ({ value, tags }))).toEqual(source);
    const rows = Papa.parse<Record<string, string>>(csv, { header: true }).data;
    expect(JSON.parse(rows[0].标签)).toEqual(source[0].tags);
    expect(rows[1].标签).toBe('[""]');
    expect(rows[2].标签).toBe("[]");
    expect(rows.every((row) => row.标签编码 === "json-array-v1")).toBe(true);
  });

  it("keeps legacy pipe-separated text and numeric labels without creating candidates", () => {
    const csv = Papa.unparse([
      ["value", "tags"], ["7", "2026|red|a,b"], ["8", "123"], ["9", ""], ["10", '{"literal":true}'],
      ["11", "[abc]"], ["12", '["x"]'], ["13", "[]"],
    ]);
    expect(parsePoolImport(csv, "legacy.csv").map(({ value, tags }) => ({ value, tags }))).toEqual([
      { value: 7, tags: ["2026", "red", "a,b"] }, { value: 8, tags: ["123"] },
      { value: 9, tags: [] }, { value: 10, tags: ['{"literal":true}'] },
      { value: 11, tags: ["[abc]"] }, { value: 12, tags: ['["x"]'] }, { value: 13, tags: ["[]"] },
    ]);
  });

  it.each(['[1]', '[null]', '[true]', '[{"label":"red"}]', '[["nested"]]', '["valid",2]', '["broken"'])(
    "rejects malformed or non-string JSON array tag cells: %s", (tags) => {
      const csv = Papa.unparse([["value", "tags", "tagsencoding"], ["1", tags, "json-array-v1"]]);
      expect(() => parsePoolImport(csv, "invalid.csv")).toThrow(/rowInvalid/);
    }
  );

  it("accepts explicitly encoded arrays using the English encoding column alias", () => {
    const csv = Papa.unparse([["value", "tags", "tagsencoding"], ["7", '["a|b",""]', "json-array-v1"]]);
    expect(parsePoolImport(csv, "encoded.csv")).toEqual([{ id: expect.any(String), value: 7, tags: ["a|b", ""] }]);
  });

  it.each(["json-array-v2", "pipe", ""])("rejects unknown explicit tag encoding: %s", (encoding) => {
    const csv = Papa.unparse([["数字", "标签", "标签编码"], ["1", '["red"]', encoding]]);
    expect(() => parsePoolImport(csv, "unknown-encoding.csv")).toThrow(/rowInvalid/);
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
