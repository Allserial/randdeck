import { describe, expect, it } from "vitest";
import { createDefaultState } from "../app/state";
import { createReceipt, canonicalize, sha256 } from "./audit";
import { executeDraw, prepareDraw } from "./draw";
import { SeededRandomSource } from "./random";

describe("audit receipts", () => {
  it("canonicalizes object keys recursively", () => {
    expect(canonicalize({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("creates a verifiable receipt digest", async () => {
    const state = createDefaultState(); state.settings.count = 1;
    const transaction = executeDraw(prepareDraw(state), new SeededRandomSource(7)); const receipt = await createReceipt(transaction);
    const { digest, ...unsigned } = receipt;
    expect(digest).toBe(await sha256(canonicalize(unsigned)));
    expect(receipt.schema).toBe("zhishutai.receipt.v1");
    expect(receipt.candidate.digest).toHaveLength(64);
    expect(receipt.operation).toEqual({ kind: "draw" });
  });
});
