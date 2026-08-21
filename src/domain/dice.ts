import type { AppLocale, DiceAstNode, DiceFace } from "./types";
import type { RandomSource } from "./random";
import { randomIndex } from "./random";
import { createRuntimeMessage, runtimeError } from "./runtimeMessage";

export const DICE_LIMITS = { expressionLength: 256, diceCount: 100, sides: 1_000_000, depth: 32, rerolls: 100, explosions: 100 } as const;

type Token = { type: string; value: string | number; position: number };
export interface DiceTrace {
  type: "number" | "unary" | "binary" | "dice";
  value: number;
  operator?: string;
  child?: DiceTrace;
  left?: DiceTrace;
  right?: DiceTrace;
  count?: number;
  sides?: number;
  modifiers?: Extract<DiceAstNode, { type: "dice" }>["modifiers"];
  success?: Extract<DiceAstNode, { type: "dice" }>["success"];
  rolls?: Array<{ value: number; rerolls: number; exploded: boolean; kept: boolean; sides: number }>;
}

function tokenize(source: string): Token[] {
  const text = String(source ?? "").trim();
  if (!text) throw runtimeError("errors.expressionRequired");
  if (text.length > DICE_LIMITS.expressionLength) throw runtimeError("errors.expressionTooLong", { count: DICE_LIMITS.expressionLength });
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    const two = text.slice(index, index + 2);
    if ([">=", "<=", "=="].includes(two)) { tokens.push({ type: two, value: two, position: index }); index += 2; continue; }
    const number = text.slice(index).match(/^\d+(?:\.\d+)?/);
    if (number) { tokens.push({ type: "number", value: Number(number[0]), position: index }); index += number[0].length; continue; }
    const identifier = text.slice(index).match(/^[A-Za-z]+/);
    if (identifier) {
      const value = identifier[0].toLowerCase();
      if (!["d", "kh", "kl", "dh", "dl", "r"].includes(value)) throw runtimeError("errors.unsupportedDiceIdentifier", { position: index + 1, identifier: value });
      tokens.push({ type: value, value, position: index }); index += value.length; continue;
    }
    if ("()+-*/!<>,".includes(char)) tokens.push({ type: char, value: char, position: index });
    else throw runtimeError("errors.unsupportedCharacter", { position: index + 1, character: char });
    index += 1;
  }
  tokens.push({ type: "eof", value: "", position: text.length });
  return tokens;
}

export function parseDiceExpression(source: string): DiceAstNode {
  const tokens = tokenize(source);
  let position = 0; let depth = 0;
  const peek = () => tokens[position];
  const consume = (type: string) => {
    if (peek().type !== type) throw runtimeError("errors.expectedToken", {
      position: peek().position + 1,
      expected: type,
      actual: peek().value ? String(peek().value) : createRuntimeMessage("errors.expressionEnd"),
    });
    return tokens[position++];
  };
  const optionalNumber = (fallback = 1) => peek().type === "number" ? Number(consume("number").value) : fallback;

  const primary = (): DiceAstNode => {
    if (peek().type === "(") {
      depth += 1;
      if (depth > DICE_LIMITS.depth) throw runtimeError("errors.expressionDepth", { count: DICE_LIMITS.depth });
      consume("("); const node = additive(); consume(")"); depth -= 1; return node;
    }
    let count: number;
    if (peek().type === "d") count = 1;
    else if (peek().type === "number") count = Number(consume("number").value);
    else throw runtimeError("errors.expectedDiceValue", { position: peek().position + 1 });
    if (peek().type !== "d") return { type: "number", value: count };
    consume("d"); const sides = Number(consume("number").value);
    if (!Number.isInteger(count) || count < 1 || count > DICE_LIMITS.diceCount) throw runtimeError("errors.diceCountRange", { count: DICE_LIMITS.diceCount });
    if (!Number.isInteger(sides) || sides < 1 || sides > DICE_LIMITS.sides) throw runtimeError("errors.diceSidesRange", { count: DICE_LIMITS.sides });
    const modifiers: Extract<DiceAstNode, { type: "dice" }>["modifiers"] = {};
    while (["kh", "kl", "dh", "dl", "!", "r"].includes(peek().type)) {
      if (peek().type === "!") { consume("!"); modifiers.explode = true; continue; }
      if (["kh", "kl", "dh", "dl"].includes(peek().type)) {
        const type = consume(peek().type).type as "kh" | "kl" | "dh" | "dl";
        const keepCount = optionalNumber(1);
        if (!Number.isInteger(keepCount) || keepCount < 0) throw runtimeError("errors.keepDropCount");
        modifiers.keep = { type, count: keepCount }; continue;
      }
      consume("r"); const operator = consume(peek().type).type;
      if (!["<", ">"].includes(operator)) throw runtimeError("errors.rerollSyntax");
      modifiers.reroll = { operator: operator as "<" | ">", threshold: Number(consume("number").value) };
    }
    let success: Extract<DiceAstNode, { type: "dice" }>["success"];
    if ([">=", "<=", ">", "<", "=="].includes(peek().type)) {
      success = { operator: consume(peek().type).type as ">=" | "<=" | ">" | "<" | "==", threshold: Number(consume("number").value) };
    }
    return { type: "dice", count, sides, modifiers, success };
  };
  const unary = (): DiceAstNode => {
    if (["+", "-"].includes(peek().type)) return { type: "unary", operator: consume(peek().type).type as "+" | "-", value: unary() };
    return primary();
  };
  const multiplicative = (): DiceAstNode => {
    let node = unary();
    while (["*", "/"].includes(peek().type)) node = { type: "binary", operator: consume(peek().type).type as "*" | "/", left: node, right: unary() };
    return node;
  };
  const additive = (): DiceAstNode => {
    let node = multiplicative();
    while (["+", "-"].includes(peek().type)) node = { type: "binary", operator: consume(peek().type).type as "+" | "-", left: node, right: multiplicative() };
    return node;
  };
  const ast = additive();
  if (peek().type !== "eof") throw runtimeError("errors.trailingContent", { position: peek().position + 1, content: String(peek().value) });
  return ast;
}

export function compareDice(value: number, operator: string, threshold: number): boolean {
  return Boolean({ ">=": value >= threshold, "<=": value <= threshold, ">": value > threshold, "<": value < threshold, "==": value === threshold }[operator as ">=" | "<=" | ">" | "<" | "=="]);
}

export function evaluateDiceExpression(ast: DiceAstNode, source: RandomSource): { total: number; trace: DiceTrace; faces: DiceFace[] } {
  const evaluate = (node: DiceAstNode): { value: number; trace: DiceTrace } => {
    if (node.type === "number") return { value: node.value, trace: { type: "number", value: node.value } };
    if (node.type === "unary") {
      const child = evaluate(node.value); const value = node.operator === "-" ? -child.value : child.value;
      return { value, trace: { type: "unary", operator: node.operator, value, child: child.trace } };
    }
    if (node.type === "binary") {
      const left = evaluate(node.left); const right = evaluate(node.right);
      if (node.operator === "/" && right.value === 0) throw runtimeError("errors.divideByZero");
      const value = { "+": left.value + right.value, "-": left.value - right.value, "*": left.value * right.value, "/": left.value / right.value }[node.operator];
      if (!Number.isFinite(value)) throw runtimeError("errors.nonFiniteResult");
      return { value, trace: { type: "binary", operator: node.operator, value, left: left.trace, right: right.trace } };
    }
    const rolls: NonNullable<DiceTrace["rolls"]> = [];
    for (let index = 0; index < node.count; index += 1) {
      let value = randomIndex(node.sides, source) + 1; let rerolls = 0;
      while (node.modifiers.reroll && compareDice(value, node.modifiers.reroll.operator, node.modifiers.reroll.threshold)) {
        if (rerolls >= DICE_LIMITS.rerolls) throw runtimeError("errors.rerollLimit");
        value = randomIndex(node.sides, source) + 1; rerolls += 1;
      }
      rolls.push({ value, rerolls, exploded: false, kept: true, sides: node.sides });
      if (node.modifiers.explode && value === node.sides) {
        let explosions = 0;
        while (value === node.sides) {
          if (explosions >= DICE_LIMITS.explosions) throw runtimeError("errors.explosionLimit");
          value = randomIndex(node.sides, source) + 1;
          rolls.push({ value, rerolls: 0, exploded: true, kept: true, sides: node.sides }); explosions += 1;
        }
      }
    }
    if (node.modifiers.keep) {
      const { type, count } = node.modifiers.keep;
      const indexes = rolls.map((roll, index) => ({ index, value: roll.value })).sort((a, b) => type.endsWith("h") ? b.value - a.value : a.value - b.value).slice(0, count).map((item) => item.index);
      rolls.forEach((roll, index) => { roll.kept = type.startsWith("k") ? indexes.includes(index) : !indexes.includes(index); });
    }
    const kept = rolls.filter((roll) => roll.kept);
    const value = node.success ? kept.filter((roll) => compareDice(roll.value, node.success!.operator, node.success!.threshold)).length : kept.reduce((sum, roll) => sum + roll.value, 0);
    return { value, trace: { type: "dice", value, count: node.count, sides: node.sides, modifiers: node.modifiers, success: node.success, rolls } };
  };
  const result = evaluate(ast);
  return { total: result.value, trace: result.trace, faces: collectFaces(result.trace) };
}

export function collectFaces(trace?: DiceTrace): DiceFace[] {
  if (!trace) return [];
  if (trace.type === "dice") return (trace.rolls || []).map((roll) => ({ value: roll.value, sides: roll.sides, kept: roll.kept, exploded: roll.exploded, rerolled: roll.rerolls > 0 }));
  if (trace.child) return collectFaces(trace.child);
  return [...collectFaces(trace.left), ...collectFaces(trace.right)];
}

export function formatRollTrace(trace?: DiceTrace): string {
  if (!trace) return "";
  if (trace.type === "dice") return `${(trace.rolls || []).map((roll) => `${roll.kept ? "" : "×"}${roll.value}`).join(", ")} → ${trace.value}`;
  if (trace.type === "binary") return `${formatRollTrace(trace.left)} ${trace.operator} ${formatRollTrace(trace.right)} = ${trace.value}`;
  if (trace.type === "unary") return `${trace.operator}${formatRollTrace(trace.child)}`;
  return String(trace.value);
}

export function describeDiceExpression(ast: DiceAstNode, locale: AppLocale = "zh-CN"): string {
  if (ast.type === "number") return locale === "en-US" ? `constant ${ast.value}` : `常量 ${ast.value}`;
  if (ast.type === "unary") {
    const operation = locale === "en-US" ? (ast.operator === "-" ? "negate" : "positive") : (ast.operator === "-" ? "取负" : "取正");
    return locale === "en-US"
      ? `${operation} (${describeDiceExpression(ast.value, locale)})`
      : `${operation}（${describeDiceExpression(ast.value, locale)}）`;
  }
  if (ast.type === "binary") {
    const operators = locale === "en-US"
      ? ({ "+": "plus", "-": "minus", "*": "times", "/": "divided by" } as const)
      : ({ "+": "加", "-": "减", "*": "乘", "/": "除以" } as const);
    return `${describeDiceExpression(ast.left, locale)} ${operators[ast.operator]} ${describeDiceExpression(ast.right, locale)}`;
  }
  if (locale === "en-US") {
    const modifier = ast.modifiers.keep
      ? `, ${ast.modifiers.keep.type} ${ast.modifiers.keep.count}`
      : ast.modifiers.explode
        ? ", exploding on the maximum face"
        : ast.modifiers.reroll
          ? `, reroll ${ast.modifiers.reroll.operator}${ast.modifiers.reroll.threshold}`
          : "";
    return `roll ${ast.count} d${ast.sides}${modifier}${ast.success ? `, count successes ${ast.success.operator}${ast.success.threshold}` : ""}`;
  }
  const modifier = ast.modifiers.keep ? `，${ast.modifiers.keep.type} ${ast.modifiers.keep.count}` : ast.modifiers.explode ? "，最大值爆骰" : ast.modifiers.reroll ? `，按 ${ast.modifiers.reroll.operator}${ast.modifiers.reroll.threshold} 重掷` : "";
  return `投掷 ${ast.count} 个 ${ast.sides} 面骰${modifier}${ast.success ? `，统计 ${ast.success.operator}${ast.success.threshold} 的成功数` : ""}`;
}

export function diceNodes(ast: DiceAstNode): Array<Extract<DiceAstNode, { type: "dice" }>> {
  if (ast.type === "dice") return [ast];
  if (ast.type === "unary") return diceNodes(ast.value);
  if (ast.type === "binary") return [...diceNodes(ast.left), ...diceNodes(ast.right)];
  return [];
}
