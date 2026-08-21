import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Plus, Trash2 } from "lucide-react";
import type { TagRule } from "../../domain/types";
import { createId } from "../../domain/random";
import { parseTagExpression } from "../../domain/tags";
import { useAppStore } from "../../app/store";
import { Button } from "../../components/ui/Button";
import { Segmented } from "../../components/ui/Segmented";

type RuleKind = "compare" | "between" | "even" | "odd" | "in";

export default function TagRuleStudio() {
  const { t } = useTranslation();
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
  const add = () => { try { parseTagExpression(expression); const clean = label.trim(); if (!clean) throw new Error(t("errors.labelRequired")); saveRules([...rules, { id: createId("tag"), label: clean.slice(0, 32), expression }]); setLabel(""); setToast(t("studio.addRule")); } catch (error) { setError((error as Error).message); } };
  const updateRule = (id: string, updates: Partial<TagRule>) => { const next = rules.map((rule) => rule.id === id ? { ...rule, ...updates } : rule); try { next.forEach((rule) => parseTagExpression(rule.expression)); saveRules(next); } catch (error) { setError((error as Error).message); } };
  return <section className="tag-studio"><div className="editor-toolbar"><div><span className="section-label">{t("studio.declarative")}</span><h2>{t("studio.ruleBuilder")}</h2><p>{t("studio.ruleDescription")}</p></div><Segmented<"range" | "expression"> label={t("studio.ruleTarget")} value={target} options={[{ value: "range", label: t("studio.rangeResult") }, { value: "expression", label: t("studio.diceTotal") }]} onChange={setTarget} /></div>
    <div className="rule-builder"><label><span>{t("studio.labelName")}</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("studio.labelPlaceholder")} disabled={locked} /></label><label><span>{t("studio.ruleType")}</span><select value={kind} onChange={(event) => setKind(event.target.value as RuleKind)} disabled={locked || advanced}><option value="compare">{t("studio.compare")}</option><option value="between">{t("studio.between")}</option><option value="even">{t("studio.even")}</option><option value="odd">{t("studio.odd")}</option><option value="in">{t("studio.inSet")}</option></select></label>{kind === "compare" && !advanced && <label><span>{t("studio.operator")}</span><select value={operator} onChange={(event) => setOperator(event.target.value)}><option>&gt;=</option><option>&lt;=</option><option>&gt;</option><option>&lt;</option><option>==</option><option>!=</option></select></label>}{!["even", "odd"].includes(kind) && !advanced && <label className="rule-value"><span>{kind === "in" ? t("studio.inSet") : t("studio.value")}</span><input value={first} onChange={(event) => setFirst(event.target.value)} /></label>}{kind === "between" && !advanced && <label className="rule-value"><span>{t("studio.upper")}</span><input value={second} onChange={(event) => setSecond(event.target.value)} /></label>}<button type="button" className={`raw-toggle ${advanced ? "active" : ""}`} onClick={() => setAdvanced((value) => !value)}><Code2 size={15} />{t("studio.advancedExpression")}</button>{advanced && <label className="raw-expression"><span>{t("studio.expression")}</span><input value={raw} onChange={(event) => setRaw(event.target.value)} /></label>}<div className="rule-preview"><span>{t("studio.saveAs")}</span><code>{expression}</code></div><Button variant="primary" icon={<Plus size={16} />} onClick={add} disabled={locked}>{t("studio.addRule")}</Button></div>
    <div className="rules-list">{rules.length ? rules.map((rule) => <article key={rule.id}><label><span>{t("studio.ruleLabel")}</span><input value={rule.label} disabled={locked} onChange={(event) => updateRule(rule.id, { label: event.target.value })} /></label><label><span>{t("studio.expression")}</span><input value={rule.expression} disabled={locked} onBlur={(event) => updateRule(rule.id, { expression: event.target.value })} onChange={(event) => saveRules(rules.map((item) => item.id === rule.id ? { ...item, expression: event.target.value } : item))} /></label><button type="button" aria-label={t("studio.deleteRule", { label: rule.label })} disabled={locked} onClick={() => saveRules(rules.filter((item) => item.id !== rule.id))}><Trash2 size={16} /></button></article>) : <div className="empty-editor">{t("studio.noRules")}</div>}</div>
  </section>;
}
