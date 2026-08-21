import { lazy, Suspense, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3, Dices, PanelTopOpen, Settings, Volume2, VolumeX } from "lucide-react";
import clsx from "clsx";
import type { AppView } from "../domain/types";
import { cancelCeremony, finishCeremonyToNormal, generateDraw, skipCeremonyReveal, startCountdownCeremony } from "./drawController";
import { flushStore, useAppStore } from "./store";
import { applyWindowMaterial, listenDisplayReady, openDisplayWindow } from "../platform/desktop";
import { publishCurrentDisplay } from "./drawController";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { IconButton } from "../components/ui/Button";
import BrandMark from "../components/BrandMark";

import RollWorkspace from "../features/roll/RollWorkspace";
const InsightsView = lazy(() => import("../features/insights/InsightsView"));
const SettingsView = lazy(() => import("../features/settings/SettingsView"));

const views: Array<{ id: AppView; label: string; icon: typeof Dices }> = [
  { id: "roll", label: "抽取台", icon: Dices },
  { id: "insights", label: "数据洞察", icon: BarChart3 },
  { id: "settings", label: "设置", icon: Settings },
];

function LoadingView() {
  return (
    <div className="view-loading" aria-live="polite">
      <span />
      正在准备工作台
    </div>
  );
}

export default function AppShell() {
  const hydrated = useAppStore((state) => state.hydrated);
  const settings = useAppStore((state) => state.settings);
  const ui = useAppStore((state) => state.ui);
  const warnings = useAppStore((state) => state.warnings);
  const error = useAppStore((state) => state.error);
  const toast = useAppStore((state) => state.toast);
  const setView = useAppStore((state) => state.setView);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setToast = useAppStore((state) => state.setToast);
  const setError = useAppStore((state) => state.setError);

  const showDisplay = useCallback(async () => {
    const state = useAppStore.getState();
    try {
      await openDisplayWindow(state.settings.desktop.displayMode);
      await publishCurrentDisplay();
    } catch (displayError) {
      state.setError((displayError as Error).message);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.appearance.theme;
    document.documentElement.dataset.motion = settings.appearance.motion;
    void applyWindowMaterial(settings.appearance.theme);
  }, [settings.appearance.motion, settings.appearance.theme]);

  useEffect(() => {
    import("../platform/audio").then(({ syncMutedAudio }) => syncMutedAudio(settings.muted));
  }, [settings.muted]);

  useEffect(() => {
    let dispose: () => void = () => undefined;
    listenDisplayReady(() => {
      void publishCurrentDisplay();
    }).then((cleanup) => {
      dispose = cleanup;
    });
    return () => dispose();
  }, []);

  // 快捷键只作用于抽取台，且不抢占表单、导航和对话框控件的输入。
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const state = useAppStore.getState();
      if (state.ui.activeView !== "roll" || event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      const inDialog = target instanceof HTMLElement && Boolean(target.closest("dialog, [role='dialog']"));

      const ceremony = state.ceremony;
      if (event.key === "Escape") {
        if (event.defaultPrevented || inDialog) return;
        if (ceremony.phase === "countdown" || ceremony.phase === "revealing") {
          event.preventDefault();
          cancelCeremony();
          return;
        }
        if (ceremony.phase === "finished") {
          event.preventDefault();
          finishCeremonyToNormal();
          return;
        }
        if (state.ui.inspectorOpen && globalThis.matchMedia?.("(max-width: 1039px)").matches) {
          event.preventDefault();
          state.setInspectorOpen(false);
        }
        return;
      }

      if (
        target instanceof HTMLElement && target.closest(
          "input, textarea, select, button, a, summary, nav, dialog, [role='button'], [role='textbox'], [role='dialog'], [contenteditable='true']",
        )
      ) return;

      if (event.code === "Space" || event.code === "Enter") {
        if (event.shiftKey) {
          if (event.code !== "Space" || ceremony.phase !== "idle") return;
          event.preventDefault();
          void startCountdownCeremony(state.settings.timer.durationSec);
          return;
        }
        if (ceremony.phase === "countdown") return;
        event.preventDefault();
        if (ceremony.phase === "revealing") {
          skipCeremonyReveal();
          return;
        }
        if (ceremony.phase === "finished") {
          finishCeremonyToNormal();
          return;
        }
        void generateDraw();
      }
    };

    window.addEventListener("keydown", keydown);
    const beforeUnload = () => {
      void flushStore();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  // 提示与错误自动消失（约 3.2s）
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [setToast, toast]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 3200);
    return () => window.clearTimeout(timer);
  }, [setError, error]);

  if (!hydrated) return <LoadingView />;

  const Panel = ui.activeView === "insights" ? InsightsView : ui.activeView === "settings" ? SettingsView : null;

  return (
    <div className="app-shell workbench">
      <header className="app-header">
        <div className="app-brand">
          <span className="brand-glyph">
            <BrandMark size={26} title="掷数台" />
          </span>
          <div>
            <h1>掷数台</h1>
            <span>本地随机工作台</span>
          </div>
        </div>
        <div className="header-tools">
          <IconButton label="打开展示窗口" onClick={() => void showDisplay()}>
            <PanelTopOpen size={17} />
          </IconButton>
          <IconButton
            label={settings.muted ? "开启音效" : "静音"}
            onClick={() => updateSettings({ muted: !settings.muted })}
          >
            {settings.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </IconButton>
        </div>
      </header>

      <div className="app-body">
        <nav className="primary-nav" aria-label="主导航">
          {views.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={clsx(ui.activeView === id && "active")}
              aria-current={ui.activeView === id ? "page" : undefined}
              onClick={() => {
                if (id !== "roll") cancelCeremony();
                setView(id);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <section className="view-host">
          {warnings.length > 0 && (
            <div className="migration-note" role="status">
              {warnings.join("；")}
            </div>
          )}
          <ErrorBoundary name="当前工作区暂时不可用">
            <div
              className="workbench-home"
              hidden={ui.activeView !== "roll"}
              style={{
                display: ui.activeView === "roll" ? "block" : "none",
              }}
            >
              <RollWorkspace />
            </div>
            {Panel && (
              <Suspense fallback={<LoadingView />}>
                <AnimatePresence>
                  <motion.div
                    key={ui.activeView}
                    className="workbench-panel"
                    initial={{ opacity: 0.96, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: settings.appearance.motion === "instant" ? 0 : 0.16 }}
                  >
                    <Panel />
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            )}
          </ErrorBoundary>
        </section>
      </div>

      {/* 居中自消提示层 (Item 8) */}
      {(error || toast) && (
        <div className={clsx("bottom-notification", error ? "is-error" : "is-toast")} role="status">
          <span>{error || toast}</span>
        </div>
      )}
    </div>
  );
}
