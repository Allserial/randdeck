import { History, Settings2 } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { ActiveDrawMode } from "../../domain/types";
import { useAppStore } from "../../app/store";
import { Segmented } from "../../components/ui/Segmented";
import ResultStage from "./ResultStage";
import DrawInspector from "./DrawInspector";

const modeOptions: Array<{ value: ActiveDrawMode; label: string }> = [
  { value: "range", label: "范围池" },
  { value: "custom", label: "自定义池" },
  { value: "expression", label: "骰子表达式" },
];

const MODE_DESCRIPTIONS: Record<string, string> = {
  range: "从最小到最大抽整数，可排除、可抽后移除",
  custom: "只从你列出的数字清单中随机抽取",
  expression: "支持 2d6、4d6kh3 等常用骰子式子",
};

export default function RollWorkspace() {
  const settings = useAppStore((state) => state.settings);
  const history = useAppStore((state) => state.history);
  const inspectorOpen = useAppStore((state) => state.ui.inspectorOpen);
  const ceremony = useAppStore((state) => state.ceremony) || { phase: "idle" as const, remainingSeconds: 0, revealedCount: 0 };
  const update = useAppStore((state) => state.updateSettings);
  const setInspectorOpen = useAppStore((state) => state.setInspectorOpen);
  const recallHistory = useAppStore((state) => state.recallHistory);
  const setInsightsTab = useAppStore((state) => state.setInsightsTab);

  const activeMode: ActiveDrawMode = settings.mode === "weighted" ? "custom" : (settings.mode as ActiveDrawMode);
  const isCeremonyActive = ceremony.phase !== "idle";
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const [isNarrow, setIsNarrow] = useState(() => globalThis.matchMedia?.("(max-width: 1039px)").matches ?? false);

  useEffect(() => {
    const media = globalThis.matchMedia?.("(max-width: 1039px)");
    if (!media) return;
    const syncLayout = (matches: boolean) => {
      setIsNarrow(matches);
      if (!matches && !useAppStore.getState().ui.inspectorOpen) setInspectorOpen(true);
    };
    syncLayout(media.matches);
    const onChange = (event: MediaQueryListEvent) => syncLayout(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [setInspectorOpen]);

  useEffect(() => {
    if (isNarrow) {
      if (inspectorOpen) document.querySelector<HTMLElement>("[data-inspector-heading]")?.focus();
      else inspectorToggleRef.current?.focus();
    }
  }, [inspectorOpen, isNarrow]);

  return (
    <div className="roll-view">
      <div className="roll-main">
        <div className="mode-bar-wrap">
          <div className="mode-bar">
            <Segmented
              label="抽取模式"
              value={activeMode}
              options={modeOptions}
              onChange={(mode) => {
                if (!isCeremonyActive) update({ mode });
              }}
            />
          </div>
          <p className="mode-bar-desc">{MODE_DESCRIPTIONS[activeMode] || ""}</p>
        </div>

        <ResultStage />

        <section
          className="recent-strip"
          aria-label="最近批次"
          style={{ visibility: history.length > 0 && !isCeremonyActive ? "visible" : "hidden" }}
        >
          <div className="recent-strip-label">
            <span className="section-label">
              <History size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              最近批次
            </span>
            <button type="button" onClick={() => setInsightsTab("history")}>
              查看全部 ({history.length})
            </button>
          </div>
          <div className="recent-items">
            {history.slice(0, 10).map((entry) => (
              <button
                type="button"
                key={entry.id}
                title="点击召回此批结果"
                onClick={() => recallHistory(entry.id)}
              >
                <span className="recent-values">
                  {entry.results.slice(0, 5).map((result) => result.total).join(" · ")}
                  {entry.results.length > 5 ? " …" : ""}
                </span>
                <small>
                  {entry.createdAt
                    ? new Date(entry.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
                    : "--:--"} · 召回
                </small>
              </button>
            ))}
          </div>
        </section>
      </div>

      <button
        type="button"
        ref={inspectorToggleRef}
        className={clsx("inspector-toggle", inspectorOpen && "is-open")}
        aria-label="打开抽取设置"
        aria-controls="draw-inspector-panel"
        aria-expanded={inspectorOpen}
        aria-hidden={!isNarrow || inspectorOpen}
        tabIndex={!isNarrow || inspectorOpen ? -1 : 0}
        onClick={() => setInspectorOpen(!inspectorOpen)}
      >
        <Settings2 size={17} />
        <span>抽取设置</span>
      </button>
      <div
        id="draw-inspector-panel"
        className={clsx("inspector-host", inspectorOpen && "open")}
        aria-hidden={isNarrow && !inspectorOpen ? true : undefined}
        inert={isNarrow && !inspectorOpen ? true : undefined}
      >
        <DrawInspector />
      </div>
    </div>
  );
}
