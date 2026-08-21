import { describe, expect, it } from "vitest";
import { createRuntimeMessage, messageFromUnknown, parseRuntimeMessage, runtimeError } from "./runtimeMessage";

describe("runtime message protocol", () => {
  it("round-trips stable keys and parameters", () => {
    const message = createRuntimeMessage("errors.notEnough", { available: 3, count: 5 });
    expect(parseRuntimeMessage(message)).toEqual({
      key: "errors.notEnough",
      params: { available: 3, count: 5 },
    });
  });

  it("keeps domain errors language-neutral", () => {
    const error = runtimeError("errors.expressionRequired");
    expect(error.code).toBe("errors.expressionRequired");
    expect(error.message).not.toMatch(/[\u4e00-\u9fff]/u);
    expect(messageFromUnknown(error)).toBe(error.message);
  });
});
