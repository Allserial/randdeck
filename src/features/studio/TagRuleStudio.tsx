import { useMemo, useState } from "react";
import { Code2, Plus, Trash2 } from "lucide-react";
import type { TagRule } from "../../domain/types";
import { createId } from "../../domain/random";
import { parseTagExpression } from "../../domain/tags";
import { useAppStore } from "../../app/store";
import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";

type RuleKind = "compare" | "between" | "even" | "odd" | "in";

export default function TagRuleStudio() {
  const pools = useAppStore((state) => state.pools); const updatePools = useAppStore((state) => state.updatePools); const setToast = useAppStore((state) => state.setToast); const setError = useAppStore((state) => state.setError); const locked = Boolean(useAppStore((state) => state.activeSession));
  const [target, setTarget] = useState<"range" | "expression">("range"); const [label, setLabel] = useState(""); const [kind, setKind] = useState<RuleKind>("compare"); const [operator, setOperator] = useState(">="); const [first, setFirst] = useState("1"); const [second, setSecond] = useState("10"); const [advanced, setAdvanced] = useState(false); const [raw, setRaw] = useState("value >= 1");
  const rules = target === "range" ? pools.rangeTagRules : pools.expressionTagRules;
  const expression = useMemo(() => {
    if (advanced) return raw;
    if (kind === "even") return "value % 2 == 0";
    if (kind === "odd") return "value % 2 != 0";
    if (kind === "between") return `value >= ${Number(first) || 0} && value <= ${Number(second) || 0}`;
    if (kind === "in") return `value in [${first.split(/[,，\s]+/).filter(Boolean).map(Number).filter(Number.isFinite).join(", ")}]`;
    return `value ${operator} ${Number(first) || 0}`;
  }, [advanced, first, kind, operator, raw, second]);
  const saveRules = (next: TagRule[]) => updatePools(target === "range" ? { rangeTagRules: next } : { expressionTagRules: next });
  const add = () => { try { parseTagExpression(expression); const clean = label.trim(); if (!clean) throw new Error("请输入标签名称"); saveRules([...rules, { id: createId("tag"), label: clean.slice(0, 32), expression }]); setLabel(""); setToast("标签规则已添加"); } catch (error) { setError((error as Error).message); } };
  const updateRule = (id: string, updates: Partial<TagRule>) => { const next = rules.map((rule) => rule.id === id ? { ...rule, ...updates } : rule); try { next.forEach((rule) => parseTagExpression(rule.expression)); saveRules(next); } catch (error) { setError((error as Error).message); } };
  return <section className="tag-studio"><div className="editor-toolbar"><div><span className="section-label">声明式筛选</span><h2>标签规则构建器</h2><p>规则只读取 value，不执行脚本。</p></div><Segmented<"range" | "expression"> label="规则目标" value={target} options={[{ value: "range", label: "范围结果" }, { value: "expression", label: "骰子总和" }]} onChange={setTarget} /></div>
    <div className="rule-builder"><label><span>标签名称</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：偶数" disabled={locked} /></label><label><span>规则类型</span><select value={kind} onChange={(event) => setKind(event.target.value as RuleKind)} disabled={locked || advanced}><option value="compare">比较</option><option value="between">区间</option><option value="even">偶数</option><option value="odd">奇数</option><option value="in">集合</option></select></label>{kind === "compare" && !advanced && <label><span>运算</span><select value={operator} onChange={(event) => setOperator(event.target.value)}><option>&gt;=</option><option>&lt;=</option><option>&gt;</option><option>&lt;</option><option>==</option><option>!=</option></select></label>}{!["even", "odd"].includes(kind) && !advanced && <label className="rule-value"><span>{kind === "in" ? "集合" : "数值"}</span><input value={first} onChange={(event) => setFirst(event.target.value)} /></label>}{kind === "between" && !advanced && <label className="rule-value"><span>上限</span><input value={second} onChange={(event) => setSecond(event.target.value)} /></label>}<button type="button" className={`raw-toggle ${advanced ? "active" : ""}`} onClick={() => setAdvanced((value) => !value)}><Code2 size={15} />高级表达式</button>{advanced && <label className="raw-expression"><span>表达式</span><input value={raw} onChange={(event) => setRaw(event.target.value)} /></label>}<div className="rule-preview"><span>将保存为</span><code>{expression}</code></div><Button variant="primary" icon={<Plus size={16} />} onClick={add} disabled={locked}>添加规则</Button></div>
    <div className="rules-list">{rules.length ? rules.map((rule) => <article key={rule.id}><label><span>标签</span><input value={rule.label} disabled={locked} onChange={(event) => updateRule(rule.id, { label: event.target.value })} /></label><label><span>表达式</span><input value={rule.expression} disabled={locked} onBlur={(event) => updateRule(rule.id, { expression: event.target.value })} onChange={(event) => saveRules(rules.map((item) => item.id === rule.id ? { ...item, expression: event.target.value } : item))} /></label><button type="button" aria-label={`删除规则 ${rule.label}`} disabled={locked} onClick={() => saveRules(rules.filter((item) => item.id !== rule.id))}><Trash2 size={16} /></button></article>) : <div className="empty-editor">当前还没有标签规则</div>}</div>
  </section>;
}
