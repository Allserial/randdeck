import type { DiceAstNode, DiceFace } from "./types";
import type { RandomSource } from "./random";
import { randomIndex } from "./random";

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
  if (!text) throw new Error("请输入骰子表达式");
  if (text.length > DICE_LIMITS.expressionLength) throw new Error(`表达式不能超过 ${DICE_LIMITS.expressionLength} 个字符`);
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
      if (!["d", "kh", "kl", "dh", "dl", "r"].includes(value)) throw new Error(`第 ${index + 1} 个字符：不支持的骰子标识符 ${value}`);
      tokens.push({ type: value, value, position: index }); index += value.length; continue;
    }
    if ("()+-*/!<>,".includes(char)) tokens.push({ type: char, value: char, position: index });
    else throw new Error(`第 ${index + 1} 个字符：不支持 ${char}`);
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
    if (peek().type !== type) throw new Error(`第 ${peek().position + 1} 个字符：期待 ${type}，实际为 ${peek().value || "表达式结尾"}`);
    return tokens[position++];
  };
  const optionalNumber = (fallback = 1) => peek().type === "number" ? Number(consume("number").value) : fallback;

  const primary = (): DiceAstNode => {
    if (peek().type === "(") {
      depth += 1;
      if (depth > DICE_LIMITS.depth) throw new Error(`表达式嵌套不能超过 ${DICE_LIMITS.depth} 层`);
      consume("("); const node = additive(); consume(")"); depth -= 1; return node;
    }
    let count: number;
    if (peek().type === "d") count = 1;
    else if (peek().type === "number") count = Number(consume("number").value);
    else throw new Error(`第 ${peek().position + 1} 个字符：期待数字、骰子或括号`);
    if (peek().type !== "d") return { type: "number", value: count };
    consume("d"); const sides = Number(consume("number").value);
    if (!Number.isInteger(count) || count < 1 || count > DICE_LIMITS.diceCount) throw new Error(`每项骰子数量必须在 1 至 ${DICE_LIMITS.diceCount} 之间`);
    if (!Number.isInteger(sides) || sides < 1 || sides > DICE_LIMITS.sides) throw new Error(`骰面数必须在 1 至 ${DICE_LIMITS.sides.toLocaleString()} 之间`);
    const modifiers: Extract<DiceAstNode, { type: "dice" }>["modifiers"] = {};
    while (["kh", "kl", "dh", "dl", "!", "r"].includes(peek().type)) {
      if (peek().type === "!") { consume("!"); modifiers.explode = true; continue; }
      if (["kh", "kl", "dh", "dl"].includes(peek().type)) {
        const type = consume(peek().type).type as "kh" | "kl" | "dh" | "dl";
        const keepCount = optionalNumber(1);
        if (!Number.isInteger(keepCount) || keepCount < 0) throw new Error("保留或丢弃数量必须是非负整数");
        modifiers.keep = { type, count: keepCount }; continue;
      }
      consume("r"); const operator = consume(peek().type).type;
      if (!["<", ">"].includes(operator)) throw new Error("重掷规则需要使用 r<数字 或 r>数字");
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
  if (peek().type !== "eof") throw new Error(`第 ${peek().position + 1} 个字符：存在多余内容 ${peek().value}`);
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
      if (node.operator === "/" && right.value === 0) throw new Error("表达式不能除以零");
      const value = { "+": left.value + right.value, "-": left.value - right.value, "*": left.value * right.value, "/": left.value / right.value }[node.operator];
      if (!Number.isFinite(value)) throw new Error("表达式结果不是有限数字");
      return { value, trace: { type: "binary", operator: node.operator, value, left: left.trace, right: right.trace } };
    }
    const rolls: NonNullable<DiceTrace["rolls"]> = [];
    for (let index = 0; index < node.count; index += 1) {
      let value = randomIndex(node.sides, source) + 1; let rerolls = 0;
      while (node.modifiers.reroll && compareDice(value, node.modifiers.reroll.operator, node.modifiers.reroll.threshold)) {
        if (rerolls >= DICE_LIMITS.rerolls) throw new Error("重掷次数超过安全上限");
        value = randomIndex(node.sides, source) + 1; rerolls += 1;
      }
      rolls.push({ value, rerolls, exploded: false, kept: true, sides: node.sides });
      if (node.modifiers.explode && value === node.sides) {
        let explosions = 0;
        while (value === node.sides) {
          if (explosions >= DICE_LIMITS.explosions) throw new Error("爆骰次数超过安全上限");
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

export function describeDiceExpression(ast: DiceAstNode): string {
  if (ast.type === "number") return `常量 ${ast.value}`;
  if (ast.type === "unary") return `${ast.operator === "-" ? "取负" : "取正"}（${describeDiceExpression(ast.value)}）`;
  if (ast.type === "binary") return `${describeDiceExpression(ast.left)} ${({ "+": "加", "-": "减", "*": "乘", "/": "除以" } as const)[ast.operator]} ${describeDiceExpression(ast.right)}`;
  const modifier = ast.modifiers.keep ? `，${ast.modifiers.keep.type} ${ast.modifiers.keep.count}` : ast.modifiers.explode ? "，最大值爆骰" : ast.modifiers.reroll ? `，按 ${ast.modifiers.reroll.operator}${ast.modifiers.reroll.threshold} 重掷` : "";
  return `投掷 ${ast.count} 个 ${ast.sides} 面骰${modifier}${ast.success ? `，统计 ${ast.success.operator}${ast.success.threshold} 的成功数` : ""}`;
}

export function diceNodes(ast: DiceAstNode): Array<Extract<DiceAstNode, { type: "dice" }>> {
  if (ast.type === "dice") return [ast];
  if (ast.type === "unary") return diceNodes(ast.value);
  if (ast.type === "binary") return [...diceNodes(ast.left), ...diceNodes(ast.right)];
  return [];
}
