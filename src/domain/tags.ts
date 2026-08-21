import type { PoolsState, TagRule } from "./types";
import { createId } from "./random";
import { createRuntimeMessage, messageFromUnknown, runtimeError } from "./runtimeMessage";

const MAX_TAG_EXPRESSION_LENGTH = 256;

type NumericNode = { type: "value" } | { type: "number"; value: number } | { type: "mod"; left: NumericNode; right: NumericNode };
type TagNode =
  | { type: "and" | "or"; left: TagNode; right: TagNode }
  | { type: "not"; value: TagNode }
  | { type: "in"; left: NumericNode; values: number[] }
  | { type: "compare"; operator: "==" | "!=" | ">" | ">=" | "<" | "<="; left: NumericNode; right: NumericNode };
type Token = { type: string; value: string | number; position: number };

function tokenize(source: string): Token[] {
  const text = String(source ?? "").trim();
  if (!text) throw runtimeError("errors.tagExpressionEmpty");
  if (text.length > MAX_TAG_EXPRESSION_LENGTH) throw runtimeError("errors.tagExpressionTooLong", { count: MAX_TAG_EXPRESSION_LENGTH });
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    const two = text.slice(index, index + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(two)) { tokens.push({ type: two, value: two, position: index }); index += 2; continue; }
    const number = text.slice(index).match(/^-?\d+/);
    if (number) { tokens.push({ type: "number", value: Number(number[0]), position: index }); index += number[0].length; continue; }
    const identifier = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      const value = identifier[0];
      if (!["value", "in"].includes(value)) throw runtimeError("errors.unsupportedTagIdentifier", { position: index + 1, identifier: value });
      tokens.push({ type: value, value, position: index }); index += value.length; continue;
    }
    if ("()[]%!,<>".includes(char)) tokens.push({ type: char, value: char, position: index });
    else throw runtimeError("errors.unsupportedCharacter", { position: index + 1, character: char });
    index += 1;
  }
  tokens.push({ type: "eof", value: "", position: text.length });
  return tokens;
}

export function parseTagExpression(source: string): TagNode {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const consume = (type: string) => {
    if (peek().type !== type) throw runtimeError("errors.expectedToken", {
      position: peek().position + 1,
      expected: type,
      actual: peek().value ? String(peek().value) : createRuntimeMessage("errors.expressionEnd"),
    });
    return tokens[position++];
  };
  const primary = (): NumericNode => {
    if (peek().type === "value") { consume("value"); return { type: "value" }; }
    if (peek().type === "number") return { type: "number", value: Number(consume("number").value) };
    throw runtimeError("errors.expectedTagValue", { position: peek().position + 1 });
  };
  const modulo = (): NumericNode => {
    let left = primary();
    while (peek().type === "%") { consume("%"); left = { type: "mod", left, right: primary() }; }
    return left;
  };
  const comparison = (): TagNode => {
    const left = modulo();
    if (peek().type === "in") {
      consume("in"); consume("["); const values: number[] = [];
      if (peek().type !== "]") { values.push(Number(consume("number").value)); while (peek().type === ",") { consume(","); values.push(Number(consume("number").value)); } }
      consume("]"); return { type: "in", left, values: [...new Set(values)] };
    }
    if (["==", "!=", ">", ">=", "<", "<="].includes(peek().type)) {
      const operator = consume(peek().type).type as "==" | "!=" | ">" | ">=" | "<" | "<=";
      return { type: "compare", operator, left, right: modulo() };
    }
    throw runtimeError("errors.tagComparisonRequired", { position: peek().position + 1 });
  };
  const unary = (): TagNode => {
    if (peek().type === "!") { consume("!"); return { type: "not", value: unary() }; }
    if (peek().type === "(") { consume("("); const node = or(); consume(")"); return node; }
    return comparison();
  };
  const and = (): TagNode => { let node = unary(); while (peek().type === "&&") { consume("&&"); node = { type: "and", left: node, right: unary() }; } return node; };
  const or = (): TagNode => { let node = and(); while (peek().type === "||") { consume("||"); node = { type: "or", left: node, right: and() }; } return node; };
  const ast = or();
  if (peek().type !== "eof") throw runtimeError("errors.trailingContent", { position: peek().position + 1, content: String(peek().value) });
  return ast;
}

export function evaluateTagExpression(ast: TagNode, value: number): boolean {
  const numeric = (node: NumericNode): number => {
    if (node.type === "value") return value;
    if (node.type === "number") return node.value;
    const divisor = numeric(node.right);
    if (divisor === 0) throw runtimeError("errors.tagModuloZero");
    return numeric(node.left) % divisor;
  };
  const evaluate = (node: TagNode): boolean => {
    if (node.type === "and") return evaluate(node.left) && evaluate(node.right);
    if (node.type === "or") return evaluate(node.left) || evaluate(node.right);
    if (node.type === "not") return !evaluate(node.value);
    if (node.type === "in") return node.values.includes(numeric(node.left));
    if (node.type === "compare") {
      const left = numeric(node.left); const right = numeric(node.right);
      return { "==": left === right, "!=": left !== right, ">": left > right, ">=": left >= right, "<": left < right, "<=": left <= right }[node.operator];
    }
    return false;
  };
  return evaluate(ast);
}

export function normalizeTagRules(rules: unknown): TagRule[] {
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => {
    if (!rule || typeof rule !== "object") return [];
    const candidate = rule as Partial<TagRule>;
    const label = String(candidate.label ?? "").trim().slice(0, 32);
    const expression = String(candidate.expression ?? "").trim();
    if (!label || !expression) return [];
    try { parseTagExpression(expression); return [{ id: candidate.id || createId("tag"), label, expression }]; } catch { return []; }
  });
}

export function validateTagRules(rules: TagRule[]): string {
  for (const rule of rules) {
    try { parseTagExpression(rule.expression); } catch (error) {
      return createRuntimeMessage("errors.tagRuleInvalid", {
        label: rule.label || createRuntimeMessage("errors.unnamedTag"),
        message: messageFromUnknown(error),
      });
    }
  }
  return "";
}

export function tagsForValue(value: number, rules: TagRule[]): string[] {
  const tags = new Set<string>();
  for (const rule of rules) {
    try { if (evaluateTagExpression(parseTagExpression(rule.expression), value)) tags.add(rule.label); } catch { /* Invalid rules never match. */ }
  }
  return [...tags];
}

export function matchesTagFilter(tags: string[], selectedTags: string[], combine: "any" | "all"): boolean {
  if (!selectedTags.length) return true;
  const available = new Set(tags);
  return combine === "all" ? selectedTags.every((tag) => available.has(tag)) : selectedTags.some((tag) => available.has(tag));
}

export function collectTags(pools: PoolsState): string[] {
  const tags = new Set<string>();
  pools.customEntries.forEach((entry) => entry.tags.forEach((tag) => tags.add(tag)));
  pools.weightedEntries.forEach((entry) => entry.tags.forEach((tag) => tags.add(tag)));
  pools.rangeTagRules.forEach((rule) => tags.add(rule.label));
  pools.expressionTagRules.forEach((rule) => tags.add(rule.label));
  return [...tags].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export const TAG_EXPRESSION_EXAMPLES = ["value >= 1 && value <= 10", "value % 2 == 0", "value in [1, 3, 5, 7]"];
