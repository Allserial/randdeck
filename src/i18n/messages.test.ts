import { describe, expect, it } from "vitest";
import { resources } from "./resources";
import { translateRuntimeMessage } from "./messages";
import { createRuntimeMessage } from "../domain/runtimeMessage";

function translator(locale: "zh-CN" | "en-US") {
  return ((key: string, options: Record<string, unknown> = {}) => {
    const value = key.split(".").reduce<unknown>((current, part) => (
      current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined
    ), resources[locale].translation);
    return String(value ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(options[name] ?? ""));
  }) as never;
}

describe("translateRuntimeMessage", () => {
  const en = translator("en-US");

  it("translates dice, tag, draw, and probability messages", () => {
    expect(translateRuntimeMessage("请输入骰子表达式", en)).toBe("Enter a dice expression");
    expect(translateRuntimeMessage("第 4 个字符：不支持的骰子标识符 alert", en)).toBe(
      "Character 4: unsupported dice identifier alert",
    );
    expect(translateRuntimeMessage("标签规则“even”无效：标签表达式不能为空", en)).toBe(
      "Tag rule “even” is invalid: The tag expression cannot be empty",
    );
    expect(translateRuntimeMessage("可用数字不足，当前最多只能抽取 3 个", en)).toBe(
      "Not enough numbers are available; at most 3 can be drawn",
    );
    expect(translateRuntimeMessage("骰子状态在精确计算预算内", en)).toBe(
      "Dice states are within the exact-computation budget",
    );
  });

  it("recursively translates wrapped storage and restore errors", () => {
    expect(translateRuntimeMessage("备份无法恢复：备份版本不兼容", en)).toBe(
      "Backup could not be restored: Backup version is incompatible",
    );
    expect(translateRuntimeMessage("当前数据损坏：v5 数据校验失败：未知错误", en)).toBe(
      "Current data is corrupt: v5 data validation failed: Unknown error",
    );
    expect(translateRuntimeMessage("已从 v4 存储升级到 v5", en)).toBe("Upgraded v4 storage to v5");
  });

  it("translates stable runtime codes and nested parameters", () => {
    const message = createRuntimeMessage("errors.tagRuleInvalid", {
      label: "even",
      message: createRuntimeMessage("errors.tagExpressionEmpty"),
    });
    expect(translateRuntimeMessage(message, en)).toBe(
      "Tag rule “even” is invalid: The tag expression cannot be empty",
    );
  });
});
