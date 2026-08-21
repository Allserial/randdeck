import { History, Settings2 } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActiveDrawMode } from "../../domain/types";
import { useAppStore } from "../../app/store";
import { Segmented } from "../../components/ui/Segmented";
import ResultStage from "./ResultStage";
import DrawInspector from "./DrawInspector";
import { formatLocaleTime } from "../../i18n/messages";

export default function RollWorkspace() {
  const { t } = useTranslation();
  const translate = t as unknown as (key: string) => string;
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
  const modeOptions: Array<{ value: ActiveDrawMode; label: string }> = [
    { value: "range", label: t("modes.range") },
    { value: "custom", label: t("modes.custom") },
    { value: "expression", label: t("modes.expression") },
  ];

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
              label={t("roll.modeLabel")}
              value={activeMode}
              options={modeOptions}
              onChange={(mode) => {
                if (!isCeremonyActive) update({ mode });
              }}
            />
          </div>
          <p className="mode-bar-desc">{translate(`roll.descriptions.${activeMode}`)}</p>
        </div>

        <ResultStage />

        <section
          className="recent-strip"
          aria-label={t("roll.recent")}
          style={{ visibility: history.length > 0 && !isCeremonyActive ? "visible" : "hidden" }}
        >
          <div className="recent-strip-label">
            <span className="section-label">
              <History size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              {t("roll.recent")}
            </span>
            <button type="button" onClick={() => setInsightsTab("history")}>
              {t("roll.viewAll", { count: history.length })}
            </button>
          </div>
          <div className="recent-items">
            {history.slice(0, 10).map((entry) => (
              <button
                type="button"
                key={entry.id}
                title={t("roll.recallTitle")}
                onClick={() => recallHistory(entry.id)}
              >
                <span className="recent-values">
                  {entry.results.slice(0, 5).map((result) => result.total).join(" · ")}
                  {entry.results.length > 5 ? " …" : ""}
                </span>
                <small>
                  {entry.createdAt
                    ? formatLocaleTime(entry.createdAt, useAppStore.getState().ui.locale)
                    : "--:--"} · {t("roll.recall")}
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
        aria-label={t("roll.openInspector")}
        aria-controls="draw-inspector-panel"
        aria-expanded={inspectorOpen}
        aria-hidden={!isNarrow || inspectorOpen}
        tabIndex={!isNarrow || inspectorOpen ? -1 : 0}
        onClick={() => setInspectorOpen(!inspectorOpen)}
      >
        <Settings2 size={17} />
        <span>{t("roll.inspector")}</span>
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
