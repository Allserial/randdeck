import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownAZ, ArrowUpAZ, Ban, Copy, Dices, ListOrdered, Pin, RefreshCw, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { displayValue, formatResultList } from "../../lib/labels";
import { copyText } from "../../platform/files";
import { useAppStore } from "../../app/store";
import { cancelCeremony, finishCeremonyToNormal, rerollDraw, skipCeremonyReveal } from "../../app/drawController";
import { Button, IconButton } from "../../components/ui/Button";
import { ResultBoard } from "./ResultVisual";
import { BurstParticles, type BurstOrigin } from "../fx/BurstParticles";

const EMPTY_INDEX_SET = new Set<number>();
const DEFAULT_CEREMONY = { phase: "idle" as const, remainingSeconds: 0, revealedCount: 0, targetTransaction: null };

export default function ResultStage() {
  const { t } = useTranslation();
  const mode = useAppStore((state) => state.settings.mode);
  const settings = useAppStore((state) => state.settings);
  const results = useAppStore((state) => state.currentResults);
  const isDrawing = useAppStore((state) => state.isDrawing);
  const rawCeremony = useAppStore((state) => state.ceremony);
  const ceremony = rawCeremony || DEFAULT_CEREMONY;
  const history = useAppStore((state) => state.history);
  const transactionId = useAppStore((state) => state.drawState.lastTransactionId);
  const resultInteraction = useAppStore((state) => state.resultInteraction);
  const copyFormat = useAppStore((state) => state.ui.copyFormat);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setToast = useAppStore((state) => state.setToast);
  const setError = useAppStore((state) => state.setError);
  const revertTransaction = useAppStore((state) => state.revertTransaction);
  const setResultInteraction = useAppStore((state) => state.setResultInteraction);
  const clearResultInteraction = useAppStore((state) => state.clearResultInteraction);

  const [sort, setSort] = useState<"original" | "asc" | "desc">("original");

  const stageContentRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const [singleBurstOrigin, setSingleBurstOrigin] = useState<BurstOrigin | null>(null);
  const [burstToken, setBurstToken] = useState("");

  const interactionIsCurrent = resultInteraction.transactionId === transactionId;
  const selected = useMemo(
    () => (interactionIsCurrent ? new Set(resultInteraction.selectedIndices) : EMPTY_INDEX_SET),
    [interactionIsCurrent, resultInteraction.selectedIndices]
  );
  const pinned = useMemo(
    () => (interactionIsCurrent ? new Set(resultInteraction.pinnedIndices) : EMPTY_INDEX_SET),
    [interactionIsCurrent, resultInteraction.pinnedIndices]
  );
  const rollingIndices = interactionIsCurrent ? resultInteraction.rollingIndices : null;

  const isCeremonyActive = ceremony.phase !== "idle";
  const ceremonyResults = ceremony.targetTransaction?.results || results;
  const displayResults = isCeremonyActive ? ceremonyResults : results;

  // 单张揭晓：在绘制前量卡中心，且仅在 origin 对应本张时才激活粒子
  useLayoutEffect(() => {
    if (ceremony.phase === "revealing" && ceremony.revealedCount > 0) {
      const idx = ceremony.revealedCount - 1;
      const cardEl = cardRefs.current[idx];
      const stageEl = stageContentRef.current;
      if (cardEl && stageEl) {
        const cardRect = cardEl.getBoundingClientRect();
        const stageRect = stageEl.getBoundingClientRect();
        const originX = cardRect.left + cardRect.width / 2 - stageRect.left;
        const originY = cardRect.top + cardRect.height / 2 - stageRect.top;
        if (Number.isFinite(originX) && Number.isFinite(originY)) {
          setSingleBurstOrigin({ x: originX, y: originY });
          setBurstToken(`card-reveal-${idx}-${ceremony.targetTransaction?.id || ""}`);
          return;
        }
      }
    }
    setSingleBurstOrigin(null);
  }, [ceremony.phase, ceremony.revealedCount, ceremony.targetTransaction?.id]);

  const sorted = useMemo(() => {
    const indexed = displayResults.map((result, originalIndex) => ({ result, originalIndex }));
    return sort === "original"
      ? indexed
      : [...indexed].sort((left, right) =>
          sort === "asc"
            ? displayValue(left.result) - displayValue(right.result)
            : displayValue(right.result) - displayValue(left.result)
        );
  }, [displayResults, sort]);

  const latest = history.find((entry) => entry.transactionId && entry.transactionId === transactionId) || history[0];

  const rerollIndices = useMemo(() => {
    if (selected.size) return [...selected].filter((index) => !pinned.has(index));
    if (pinned.size) return results.map((_, index) => index).filter((index) => !pinned.has(index));
    return [];
  }, [pinned, results, selected]);

  const toggleSelection = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setResultInteraction({ transactionId, selectedIndices: [...next] });
  };

  const copy = async (text: string, message: string) => {
    try {
      await copyText(text);
      setToast(message);
    } catch {
      setError(t("errors.copy"));
    }
  };

  const addExclusions = () => {
    const values = [...selected].map((index) => results[index]?.value).filter((value): value is number => Number.isFinite(value));
    if (!values.length) return;
    updateSettings({ excludeInput: [settings.excludeInput.trim(), values.join(",")].filter(Boolean).join(",") });
    setResultInteraction({ transactionId, selectedIndices: [] });
    setToast(t("roll.addSelectedExclude") + ` (${values.length})`);
  };

  const undo = () => {
    if (!latest?.transactionId || !revertTransaction(latest.transactionId)) setError(t("errors.cannotUndo"));
    else {
      clearResultInteraction();
      setToast(t("roll.undoDraw"));
    }
  };

  const reroll = async () => {
    const nextTransactionId = await rerollDraw(rerollIndices);
    if (!nextTransactionId) return;
    setToast(`${t("roll.rerollSelected")} (${rerollIndices.length})`);
  };

  const togglePinned = () => {
    if (!selected.size) return;
    const shouldUnpin = [...selected].every((index) => pinned.has(index));
    const next = new Set(pinned);
    selected.forEach((index) => (shouldUnpin ? next.delete(index) : next.add(index)));
    setResultInteraction({ transactionId, pinnedIndices: [...next] });
  };

  let stageTitle = t("roll.waiting");
  if (ceremony.phase === "countdown") {
    stageTitle = t("roll.countdown", { seconds: ceremony.remainingSeconds });
  } else if (ceremony.phase === "revealing") {
    stageTitle = t("roll.revealing");
  } else if (ceremony.phase === "finished") {
    stageTitle = t("roll.finished");
  } else if (isDrawing) {
    stageTitle = t("roll.drawing");
  } else if (results.length) {
    stageTitle = t("roll.currentResult");
  }

  const hasVisibleCards = isDrawing || isCeremonyActive || results.length > 0;

  return (
    <section className={clsx("result-stage", `result-stage--${mode}`, isDrawing && "is-drawing")} aria-labelledby="result-stage-title">
      <div className="stage-toolbar">
        <div>
          <span className="section-label">{t("roll.stage")}</span>
          <h2 id="result-stage-title">{stageTitle}</h2>
        </div>
        {!isCeremonyActive && results.length > 0 && !isDrawing && (
          <div className="stage-actions">
            <div className="compact-segment">
              <IconButton label={t("roll.originalOrder")} className={sort === "original" ? "active" : ""} onClick={() => setSort("original")}>
                <ListOrdered size={16} />
              </IconButton>
              <IconButton label={t("roll.ascending")} className={sort === "asc" ? "active" : ""} onClick={() => setSort("asc")}>
                <ArrowUpAZ size={16} />
              </IconButton>
              <IconButton label={t("roll.descending")} className={sort === "desc" ? "active" : ""} onClick={() => setSort("desc")}>
                <ArrowDownAZ size={16} />
              </IconButton>
            </div>
            <IconButton label={t("roll.copyAll")} onClick={() => void copy(formatResultList(results, copyFormat), t("roll.copiedAll"))}>
              <Copy size={16} />
            </IconButton>
          </div>
        )}
        {isCeremonyActive && (
          <div className="stage-actions">
            <button type="button" className="ceremony-exit-btn" onClick={cancelCeremony} title={t("roll.stopCeremony")}>
              <X size={15} />
              {t("roll.stopCeremony")}
            </button>
          </div>
        )}
      </div>

      <div className="stage-content" ref={stageContentRef}>
        {/* 单张卡片局部礼花 (仅在 origin 就绪时触发，严禁正中误炸) */}
        <BurstParticles
          active={
            ceremony.phase === "revealing" &&
            ceremony.revealedCount > 0 &&
            singleBurstOrigin !== null &&
            burstToken.startsWith(`card-reveal-${ceremony.revealedCount - 1}-`)
          }
          token={burstToken}
          origin={singleBurstOrigin}
          fullscreen={false}
        />

        {/* 终场全屏大礼花 (缺口 B: 仅在 ceremony.phase === 'finished' 时触发，普通抽取不误炸) */}
        <BurstParticles
          active={ceremony.phase === "finished"}
          token={`ceremony-finished-${ceremony.targetTransaction?.id || transactionId || ""}`}
          fullscreen={true}
        />

        {/* 倒计时阶段上方超大倒计时 */}
        {ceremony.phase === "countdown" && (
          <div className="ceremony-countdown-hero">
            <div className="ceremony-big-number">{ceremony.remainingSeconds}</div>
            <p>{t("roll.aboutToReveal")}</p>
          </div>
        )}

        {/* 揭晓阶段上方庆祝大字 */}
        {(ceremony.phase === "revealing" || ceremony.phase === "finished") && (
          <div className="ceremony-title-banner">
            <Sparkles size={20} className="banner-sparkle" />
            <span>{ceremony.phase === "finished" ? t("roll.revealDone") : t("roll.revealTitle")}</span>
            <Sparkles size={20} className="banner-sparkle" />
          </div>
        )}

        {/* 空状态 */}
        {!hasVisibleCards && (
          <div className="stage-empty">
            <span className="empty-die" aria-hidden="true">
              <Dices size={48} />
            </span>
            <strong>{t("roll.emptyTitle")}</strong>
            <p>{t("roll.emptyDescription")}</p>
          </div>
        )}

        {/* 卡牌渲染 */}
        {hasVisibleCards && (
          <ResultBoard
            mode={mode}
            results={sorted.map((item) => item.result)}
            isRolling={isDrawing}
            isCeremony={isCeremonyActive}
            ceremonyRevealedCount={ceremony.revealedCount}
            count={isCeremonyActive ? ceremony.targetTransaction?.results.length || settings.count : settings.count}
            selected={new Set(sorted.filter((item) => selected.has(item.originalIndex)).map((item) => sorted.indexOf(item)))}
            pinned={new Set(sorted.filter((item) => pinned.has(item.originalIndex)).map((item) => sorted.indexOf(item)))}
            rollingIndices={
              rollingIndices === null
                ? null
                : new Set(sorted.filter((item) => rollingIndices.includes(item.originalIndex)).map((item) => sorted.indexOf(item)))
            }
            cardRefs={cardRefs}
            onSelect={(index) => !isDrawing && !isCeremonyActive && toggleSelection(sorted[index].originalIndex)}
            onCopy={(result) => void copy(String(displayValue(result)), t("roll.copiedResult", { value: displayValue(result) }))}
          />
        )}

        {/* 仪式全程预留同一块底部操作空间（约 56px 占位），未到 finished 时 visibility: hidden (Item 3) */}
        {isCeremonyActive && (
          <div
            className="ceremony-finish-action"
            style={{ visibility: ceremony.phase === "finished" ? "visible" : "hidden" }}
          >
            <Button
              variant="primary"
              className="ceremony-return-btn"
              tabIndex={ceremony.phase === "finished" ? 0 : -1}
              onClick={finishCeremonyToNormal}
            >
              <span>{t("roll.return")}</span>
              <small className="btn-key-hint">{t("roll.keyboardSpace")}</small>
            </Button>
          </div>
        )}
      </div>

      {/* 仪式状态下的控制栏 */}
      {isCeremonyActive && (
        <div className="stage-bottom-bar ceremony-status-bar">
          {ceremony.phase === "countdown" && <span>{t("roll.countdownStatus")}</span>}
          {ceremony.phase === "revealing" && (
            <>
              <span>{t("roll.revealingStatus", { current: ceremony.revealedCount, total: ceremony.targetTransaction?.results.length || settings.count })}</span>
              <button type="button" onClick={skipCeremonyReveal}>{t("roll.revealAll")}</button>
            </>
          )}
          {ceremony.phase === "finished" && (
            <span>✨ {t("roll.finishedStatus")}</span>
          )}
        </div>
      )}

      {/* 普通有结果时的操作栏 (缺口 D: 底栏始终固定占位，抽取中 visibility:hidden，绝无卡片跳动) */}
      {!isCeremonyActive && (
        <div
          className={clsx("stage-bottom-bar selection-actions", !results.length && "is-placeholder")}
          style={{ visibility: isDrawing ? "hidden" : "visible" }}
        >
          {results.length > 0 ? (
            <>
              <span>
                {selected.size
                  ? pinned.size ? t("roll.selectedPinned", { selected: selected.size, pinned: pinned.size }) : t("roll.selected", { count: selected.size })
                  : pinned.size
                    ? t("roll.pinned", { count: pinned.size })
                    : t("roll.selectHint")}
              </span>
              <button type="button" disabled={!rerollIndices.length} onClick={() => void reroll()}>
                <RefreshCw size={14} />
                {selected.size ? t("roll.rerollSelected") : t("roll.rerollUnpinned")}
              </button>
              <button type="button" disabled={!selected.size} onClick={addExclusions}>
                <Ban size={14} />
                {t("roll.addSelectedExclude")}
              </button>
              <button type="button" disabled={!selected.size} onClick={togglePinned}>
                <Pin size={14} />
                {selected.size && [...selected].every((index) => pinned.has(index)) ? t("roll.unpinSelected") : t("roll.pinSelected")}
              </button>
              <button type="button" onClick={undo}>
                {t("roll.undoDraw")}
              </button>
            </>
          ) : (
            <span className="stage-bottom-hint">{t("roll.stageHint")}</span>
          )}
        </div>
      )}
    </section>
  );
}
