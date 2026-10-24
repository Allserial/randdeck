import { useEffect, useState, forwardRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { Check, Pin, Copy } from "lucide-react";
import { ResultNumber } from "../../components/ui/ResultNumber";
import { formatRollTrace } from "../../domain/dice";
import { prepareDraw } from "../../domain/draw";
import type { DiceFace, DrawMode, DrawResult } from "../../domain/types";
import { displayValue } from "../../lib/labels";
import { useAppStore } from "../../app/store";

export function StageAstrolabe() {
  return (
    <div className="stage-astrolabe" aria-hidden="true">
      <span className="astrolabe-corner astrolabe-corner--tl" />
      <span className="astrolabe-corner astrolabe-corner--tr" />
      <span className="astrolabe-corner astrolabe-corner--bl" />
      <span className="astrolabe-corner astrolabe-corner--br" />
      <svg className="astrolabe-dial" viewBox="0 0 600 600" fill="none">
        <line x1="24" y1="300" x2="576" y2="300" className="astrolabe-axis" />
        <line x1="300" y1="24" x2="300" y2="576" className="astrolabe-axis" />
        <line x1="105" y1="105" x2="495" y2="495" className="astrolabe-axis-diag" />
        <line x1="495" y1="105" x2="105" y2="495" className="astrolabe-axis-diag" />
        <g className="astrolabe-ring-outer">
          <circle cx="300" cy="300" r="264" className="astrolabe-stroke-main" />
          <circle cx="300" cy="300" r="252" className="astrolabe-stroke-ticks" />
          <circle cx="300" cy="300" r="238" className="astrolabe-stroke-faint" />
          <polygon points="300,28 305,42 300,48 295,42" className="astrolabe-compass-pip" />
          <polygon points="300,572 305,558 300,552 295,558" className="astrolabe-compass-pip" />
          <polygon points="572,300 558,305 552,300 558,295" className="astrolabe-compass-pip" />
          <polygon points="28,300 42,305 48,300 42,295" className="astrolabe-compass-pip" />
        </g>
        <g className="astrolabe-ring-mid">
          <circle cx="300" cy="300" r="198" className="astrolabe-stroke-dashed" />
          <rect x="160" y="160" width="280" height="280" rx="3" className="astrolabe-octagram" />
          <rect x="160" y="160" width="280" height="280" rx="3" transform="rotate(45 300 300)" className="astrolabe-octagram" />
          <circle cx="300" cy="300" r="146" className="astrolabe-stroke-main" />
        </g>
        <circle cx="300" cy="300" r="96" className="astrolabe-stroke-ticks" />
        <circle cx="300" cy="300" r="54" className="astrolabe-stroke-faint" />
      </svg>
    </div>
  );
}

export function DieFace({ face, compact = false }: { face: DiceFace; compact?: boolean }) {
  const sides = face.sides || 6;
  const label = sides === 10 && face.value === 0 ? "00" : String(face.value);
  return (
    <span
      className={clsx(
        "die-face",
        `die-face--d${[4, 6, 8, 10, 12, 20].includes(sides) ? sides : 6}`,
        compact && "is-compact",
        face.kept === false && "is-dropped",
        face.exploded && "is-exploded",
        face.rerolled && "is-rerolled"
      )}
      title={`d${sides}`}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true">
        {sides === 4 && <polygon points="32,6 58,54 6,54" />}
        {sides === 6 && <rect x="8" y="8" width="48" height="48" rx="8" />}
        {sides === 8 && <polygon points="32,4 58,32 32,60 6,32" />}
        {sides === 10 && <polygon points="32,4 60,24 50,58 14,58 4,24" />}
        {sides === 12 && <polygon points="32,4 56,16 60,40 44,60 20,60 4,40 8,16" />}
        {sides === 20 && <polygon points="32,3 58,18 58,46 32,61 6,46 6,18" />}
        {![4, 6, 8, 10, 12, 20].includes(sides) && <rect x="8" y="8" width="48" height="48" rx="10" />}
        <circle className="die-facet-ring" cx="32" cy={sides === 4 ? 38 : 32} r={sides === 4 ? 11 : 16} />
      </svg>
      <strong>{label}</strong>
    </span>
  );
}

// 独立跳动算法：步进 28-90ms，一次跳 1-3 格，偶尔回头
function useRollingDisplay(isRolling: boolean, mode: DrawMode, cardIndex: number): number | string {
  const [rollValue, setRollValue] = useState<number | string>(() => (mode === "expression" ? 6 : 1));

  useEffect(() => {
    if (!isRolling) return;
    const candidates: number[] = [];
    try {
      const plan = prepareDraw(useAppStore.getState());
      if (plan.candidateEntries.length) {
        candidates.push(...plan.candidateEntries.map((e) => e.value));
      }
    } catch {
      /* fallback */
    }
    if (!candidates.length) {
      const sides = mode === "expression" ? 6 : 20;
      for (let i = 1; i <= sides; i++) candidates.push(i);
    }

    let frameId: number;
    let lastTime = performance.now();
    let currentIndex = (cardIndex * 7 + Math.floor(Math.random() * candidates.length)) % candidates.length;
    let currentInterval = 28 + Math.floor(Math.random() * 62);

    const tick = (now: number) => {
      if (now - lastTime >= currentInterval) {
        const step = Math.floor(Math.random() * 3) + 1;
        const goBack = Math.random() < 0.2;
        if (goBack) {
          currentIndex = (currentIndex - step + candidates.length) % candidates.length;
        } else {
          currentIndex = (currentIndex + step) % candidates.length;
        }
        setRollValue(candidates[currentIndex]);
        lastTime = now;
        currentInterval = 28 + Math.floor(Math.random() * 62);
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [cardIndex, isRolling, mode]);

  return rollValue;
}

export const NumberCard = forwardRef<
  HTMLElement,
  {
    result: DrawResult;
    mode: DrawMode;
    cardIndex?: number;
    isRolling?: boolean;
    isCeremonyRevealed?: boolean;
    isJustRevealed?: boolean;
    selected?: boolean;
    pinned?: boolean;
    hidden?: boolean;
    onSelect?: () => void;
    onCopy?: () => void;
  }
>(function NumberCard(
  {
    result,
    mode,
    cardIndex = 0,
    isRolling = false,
    isCeremonyRevealed = false,
    isJustRevealed = false,
    selected,
    pinned,
    hidden,
    onSelect,
    onCopy,
  },
  ref
) {
  const { t } = useTranslation();
  const translate = t as unknown as (key: string) => string;
  const rollingVal = useRollingDisplay(isRolling, mode, cardIndex);
  const faces = result.faces?.length ? result.faces : [];
  const shownValue = hidden ? "?" : isRolling ? rollingVal : displayValue(result);

  const modeBadge = translate(`roll.cardMode.${mode}`);

  const handleCardClick = (e: React.MouseEvent) => {
    if (isRolling || hidden || !onSelect) return;
    if ((e.target as HTMLElement).closest(".tile-copy")) return;
    onSelect();
  };

  return (
    <article
      style={{ "--card-index": Math.min(cardIndex, 11) } as CSSProperties}
      ref={ref}
      onClick={handleCardClick}
      className={clsx(
        "result-tile",
        String(displayValue(result)).length > 12 && "has-long-value",
        `result-tile--${mode}`,
        selected && "selected",
        pinned && "pinned",
        hidden && "is-hidden",
        isRolling && "is-rolling",
        isCeremonyRevealed && "is-ceremony-revealed",
        isJustRevealed && "just-revealed"
      )}
    >
      <div className="tile-copper-rim" aria-hidden="true" />
      <span className="tile-filigree" aria-hidden="true" />
      <div className="tile-head" aria-hidden="true">
        <span className="tile-index">
          NO.{String(cardIndex + 1).padStart(2, "0")}
        </span>
        {(selected || pinned) && (
          <div className="tile-state">
            {selected && <span className="tile-badge tile-badge--selected"><Check size={12} strokeWidth={2.5} /></span>}
            {pinned && <span className="tile-badge tile-badge--pinned"><Pin size={12} strokeWidth={2.5} /></span>}
          </div>
        )}
      </div>
      <button
        type="button"
        className="result-value"
        aria-pressed={selected}
        tabIndex={isRolling || hidden || !onSelect ? -1 : 0}
      >
        <ResultNumber value={shownValue} className={clsx(isRolling && "rolling-glow")} />
      </button>

      {mode === "expression" && faces.length > 0 && !hidden && !isRolling && (
        <div className="die-row">
          {faces.map((face, index) => (
            <DieFace key={`${index}-${face.value}-${face.sides}`} face={face} compact />
          ))}
        </div>
      )}

      {mode === "expression" && Boolean(result.trace) && !hidden && !isRolling && (
        <p className="tile-trace" title={`${t("roll.trace")} ${formatRollTrace(result.trace as never)}`}>
          <span className="sr-only">{t("roll.trace")}</span><code>{formatRollTrace(result.trace as never)}</code>
        </p>
      )}

      {/* 标签锁定固定单行高度，不撑大卡片外框 */}
      {result.tags?.length > 0 && !hidden && !isRolling ? (
        <small className="tile-tags" title={result.tags.join(" · ")}>
          {result.tags.join(" · ")}
        </small>
      ) : (
        <span className="tile-tags-placeholder" aria-hidden="true" />
      )}

      <div className="tile-footer">
        <span className="tile-mode-badge">{modeBadge}</span>
        {onCopy && !hidden && !isRolling ? (
          <button
            type="button"
            className="tile-copy"
            aria-label={t("roll.copyResult", { value: displayValue(result) })}
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
          >
            <Copy size={16} aria-hidden="true" />
          </button>
        ) : (
          <span className="tile-copy-placeholder" aria-hidden="true" />
        )}
      </div>
    </article>
  );
});

export function ResultBoard({
  mode,
  results,
  isRolling = false,
  ceremonyRevealedCount = 0,
  isCeremony = false,
  count = 1,
  hidden,
  selected,
  pinned,
  rollingIndices,
  cardRefs,
  onSelect,
  onCopy,
}: {
  mode: DrawMode;
  results: DrawResult[];
  isRolling?: boolean;
  ceremonyRevealedCount?: number;
  isCeremony?: boolean;
  count?: number;
  hidden?: boolean;
  selected?: Set<number>;
  pinned?: Set<number>;
  rollingIndices?: Set<number> | null;
  cardRefs?: React.MutableRefObject<(HTMLElement | null)[]>;
  onSelect?: (index: number) => void;
  onCopy?: (result: DrawResult) => void;
}) {
  const renderCount = isCeremony ? Math.max(1, count) : isRolling && !rollingIndices ? count : results.length;

  let colsClass: string;
  let density: string;

  if (renderCount === 1) {
    colsClass = "cols-1";
    density = "hero";
  } else if (renderCount === 2) {
    colsClass = "cols-2";
    density = "spacious";
  } else if (renderCount === 3) {
    colsClass = "cols-3";
    density = "spacious";
  } else if (renderCount === 4) {
    colsClass = "cols-2";
    density = "spacious";
  } else if (renderCount <= 6) {
    colsClass = "cols-3";
    density = "normal";
  } else if (renderCount <= 10) {
    colsClass = "cols-5";
    density = "normal";
  } else {
    colsClass = "cols-auto";
    density = "dense";
  }

  const cards = Array.from({ length: renderCount }, (_, index) => {
    if (isCeremony) {
      const isRevealed = index < ceremonyRevealedCount;
      const isJustRevealed = index === ceremonyRevealedCount - 1;
      const res = isRevealed && results[index] ? results[index] : { value: 0, total: 0, faces: [], tags: [] };
      return {
        result: res,
        index,
        cardRolling: !isRevealed,
        cardCeremonyRevealed: isRevealed,
        cardJustRevealed: isJustRevealed,
      };
    }
    if (isRolling) {
      const cardRolling = rollingIndices === null || rollingIndices === undefined || rollingIndices.has(index);
      return {
        result: results[index] || { value: 0, total: 0, faces: [], tags: [] },
        index,
        cardRolling,
        cardCeremonyRevealed: false,
        cardJustRevealed: false,
      };
    }
    return {
      result: results[index] || { value: 0, total: 0, faces: [], tags: [] },
      index,
      cardRolling: false,
      cardCeremonyRevealed: false,
      cardJustRevealed: false,
    };
  });

  return (
    <div className={clsx("result-board", `result-board--${mode}`, `is-${density}`, colsClass)}>
      <div className={clsx("result-grid", density, colsClass)}>
        {cards.map(({ result, index, cardRolling, cardCeremonyRevealed, cardJustRevealed }) => (
          <NumberCard
            key={index}
            ref={(el) => {
              if (cardRefs) cardRefs.current[index] = el;
            }}
            result={result}
            mode={mode}
            cardIndex={index}
            isRolling={cardRolling}
            isCeremonyRevealed={cardCeremonyRevealed}
            isJustRevealed={cardJustRevealed}
            selected={selected?.has(index)}
            pinned={pinned?.has(index)}
            hidden={hidden}
            onSelect={onSelect ? () => onSelect(index) : undefined}
            onCopy={onCopy ? () => onCopy(result) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
