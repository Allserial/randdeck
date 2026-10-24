import { useTranslation } from "react-i18next";
import { Sparkles, ListOrdered, Timer } from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "../../app/store";
import { generateDraw, generateShuffle, startCountdownCeremony } from "../../app/drawController";
import { getPoolStatus } from "../../domain/draw";
import { formatDrawSummary } from "../../lib/drawSummary";
import { Button } from "../../components/ui/Button";
import { Tooltip } from "../../components/ui/Tooltip";

export default function DrawActions() {
  const { t } = useTranslation();
  const state = useAppStore();
  const { settings, pools, isDrawing, ceremony } = state;
  const poolStatus = getPoolStatus(state);
  const disabled = isDrawing || ceremony.phase !== "idle";
  const summary = formatDrawSummary(settings, pools, poolStatus, t);

  return (
    <footer className="inspector-footer">
      <div id="draw-config-summary" className={clsx("draw-config-summary", summary.invalid && "is-invalid")}>
        {summary.visible}
      </div>
      <Button
        variant="primary"
        className="generate-main-btn"
        icon={<Sparkles size={18} />}
        disabled={disabled || Boolean(poolStatus.error && settings.mode !== "expression")}
        aria-describedby="draw-config-summary"
        aria-keyshortcuts="Space Enter"
        onClick={() => void generateDraw()}
      >
        <span>{isDrawing ? t("roll.generating") : ceremony.phase !== "idle" ? t("roll.ceremonyActive") : t("roll.generate")}</span>
        {!isDrawing && ceremony.phase === "idle" && <small className="btn-key-hint">{t("roll.keyboardSpace")}</small>}
      </Button>
      {settings.appearance.motion === "ceremony" && (
        <Button
          variant="secondary"
          className="countdown-sub-btn"
          icon={<Timer size={16} />}
          aria-keyshortcuts="Shift+Space"
          disabled={disabled || Boolean(poolStatus.error)}
          onClick={() => void startCountdownCeremony(settings.timer.durationSec)}
        >
          {t("roll.countdownGenerate", { seconds: settings.timer.durationSec })}
        </Button>
      )}
      {settings.mode !== "expression" && (
        <Tooltip content={t("roll.shuffleTip")}>
          <button
            type="button"
            className="shuffle-sub-btn"
            disabled={disabled || Boolean(poolStatus.error)}
            onClick={() => void generateShuffle()}
          >
            <ListOrdered size={14} />
            <span>{t("roll.shuffle")}</span>
          </button>
        </Tooltip>
      )}
    </footer>
  );
}
