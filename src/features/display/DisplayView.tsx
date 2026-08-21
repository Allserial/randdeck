import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dices, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { closeCurrentDisplayWindow, listenDisplayState, type DisplayPayload } from "../../platform/desktop";
import { ResultBoard } from "../roll/ResultVisual";
import { BurstParticles, type BurstOrigin } from "../fx/BurstParticles";
import type { DrawMode } from "../../domain/types";
import BrandMark from "../../components/BrandMark";

function payloadMode(mode: string): DrawMode {
  if (mode === "自定义" || mode === "custom") return "custom";
  if (mode === "加权" || mode === "weighted") return "weighted";
  if (mode === "骰子" || mode === "expression") return "expression";
  return "range";
}

export default function DisplayView() {
  const [payload, setPayload] = useState<DisplayPayload | null>(null);
  const [windowMode, setWindowMode] = useState<"normal" | "fullscreen" | "overlay">("normal");

  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [singleBurstOrigin, setSingleBurstOrigin] = useState<BurstOrigin | null>(null);
  const [singleBurstToken, setSingleBurstToken] = useState<string>("");

  useEffect(() => {
    let dispose: () => void = () => undefined;
    listenDisplayState(setPayload).then((cleanup) => {
      dispose = cleanup;
    });
    let disposeMode: () => void = () => undefined;
    if (window.__TAURI_INTERNALS__) {
      import("@tauri-apps/api/event").then(({ listen }) =>
        listen<{ mode: typeof windowMode }>("display://mode", (event) => setWindowMode(event.payload.mode))
      ).then((cleanup) => {
        disposeMode = cleanup;
      });
    }
    return () => {
      dispose();
      disposeMode();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = payload?.theme || "dark";
    document.body.classList.add("display-body");
    return () => document.body.classList.remove("display-body");
  }, [payload?.theme]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void closeCurrentDisplayWindow();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const ceremony = payload?.ceremony;
  const isCeremonyActive = Boolean(ceremony && ceremony.phase !== "idle");

  // 展示窗单张揭晓时，异步测量卡片中心坐标并触发单张礼花 (Item 3)
  useLayoutEffect(() => {
    let animId: number;
    if (ceremony?.phase === "revealing" && (ceremony.revealedCount || 0) > 0) {
      animId = requestAnimationFrame(() => {
        const targetIdx = (ceremony.revealedCount || 1) - 1;
        if (targetIdx < 0) return;
        const cardEl = cardRefs.current[targetIdx];
        const containerEl = containerRef.current;
        if (!cardEl || !containerEl) return;
        const cardRect = cardEl.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        const originX = cardRect.left + cardRect.width / 2 - containerRect.left;
        const originY = cardRect.top + cardRect.height / 2 - containerRect.top;
        if (Number.isFinite(originX) && Number.isFinite(originY)) {
          setSingleBurstOrigin({ x: originX, y: originY });
          setSingleBurstToken(`display-reveal-${targetIdx}-${Date.now()}`);
        }
      });
    } else {
      animId = requestAnimationFrame(() => {
        setSingleBurstOrigin(null);
      });
    }
    return () => cancelAnimationFrame(animId);
  }, [ceremony?.phase, ceremony?.revealedCount]);

  return (
    <main className={clsx("display-view", `display-view--${windowMode}`, payload && "has-result")}>
      <div className="display-brand">
        <BrandMark size={28} title="掷数台" />
        <span>掷数台 · 展示</span>
      </div>
      <button
        type="button"
        className="display-close"
        aria-label="关闭展示窗口"
        onClick={() => void closeCurrentDisplayWindow()}
      >
        <X size={18} />
      </button>

      {isCeremonyActive && ceremony && (
        <>
          {/* 终场 4 波全屏礼花雨 */}
          <BurstParticles
            active={ceremony.phase === "finished"}
            token={`display-${ceremony.phase}`}
            fullscreen={true}
          />
          {ceremony.phase === "countdown" && (
            <div className="ceremony-countdown-hero">
              <div className="ceremony-big-number">{ceremony.remainingSeconds}</div>
              <p>即将揭晓结果…</p>
            </div>
          )}
          {(ceremony.phase === "revealing" || ceremony.phase === "finished") && (
            <div className="ceremony-title-banner">
              <Sparkles size={22} className="banner-sparkle" />
              <span>{ceremony.phase === "finished" ? "排 名 揭 晓 完 毕" : "排 名 揭 晓"}</span>
              <Sparkles size={22} className="banner-sparkle" />
            </div>
          )}
          <div className="display-results-wrap" ref={containerRef}>
            {/* 单张卡片中心局部礼花 */}
            <BurstParticles
              active={
                ceremony.phase === "revealing" &&
                singleBurstOrigin !== null &&
                singleBurstToken.startsWith(`display-reveal-${(ceremony.revealedCount || 1) - 1}-`)
              }
              token={singleBurstToken}
              origin={singleBurstOrigin}
            />
            <div className="display-results" key={payload?.animationToken}>
              <ResultBoard
                mode={payload ? payloadMode(payload.mode) : "range"}
                results={payload?.results || []}
                isCeremony={true}
                ceremonyRevealedCount={ceremony.revealedCount}
                count={ceremony.totalCount}
                cardRefs={cardRefs}
              />
            </div>
          </div>
          <div className="display-meta">
            <strong>{payload?.mode}</strong>
            <span>{payload?.summary}</span>
          </div>
        </>
      )}

      {!isCeremonyActive && payload && (
        <>
          <div className="display-results-wrap">
            <div className="display-results" key={payload.animationToken}>
              {payload.results.length ? (
                <ResultBoard mode={payloadMode(payload.mode)} results={payload.results} cardRefs={cardRefs} />
              ) : (
                <div className="display-wait">
                  <Dices size={56} />
                  <strong>{payload.summary || "等待主窗口生成结果"}</strong>
                </div>
              )}
            </div>
          </div>
          <div className="display-meta">
            <strong>{payload.mode}</strong>
            <span>{payload.summary}</span>
          </div>
        </>
      )}

      {!payload && (
        <div className="display-wait">
          <Dices size={56} />
          <strong>等待主窗口生成结果</strong>
        </div>
      )}
    </main>
  );
}
