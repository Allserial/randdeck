import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Contrast, Database, Download, MonitorUp, Sparkles, Upload, Volume2 } from "lucide-react";
import type { SoundProfile } from "../../domain/types";
import { buildBackup, parseBackup } from "../../app/state";
import { snapshotState, useAppStore } from "../../app/store";
import { openDisplayWindow, setApplicationWindowTitle, setDisplayWindowMode } from "../../platform/desktop";
import { saveLocalFile } from "../../platform/files";
import { playDrawSound } from "../../platform/audio";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";
import { setAppLocale } from "../../i18n";
import { translateRuntimeMessage } from "../../i18n/messages";
import type { AppLocale } from "../../domain/types";
import { APP_VERSION } from "../../app/version";

export default function SettingsView() {
  const { t } = useTranslation();
  const translate = t as unknown as (key: string) => string;
  const settings = useAppStore((state) => state.settings);
  const migrationNotes = useAppStore((state) => state.migrationNotes);
  const update = useAppStore((state) => state.updateSettings);
  const replaceState = useAppStore((state) => state.replacePersistentState);
  const setToast = useAppStore((state) => state.setToast);
  const setError = useAppStore((state) => state.setError);
  const setLocale = useAppStore((state) => state.setLocale);
  const locale = useAppStore((state) => state.ui.locale);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreState, setRestoreState] = useState<ReturnType<typeof parseBackup> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const changeLocale = async (next: AppLocale) => {
    await setAppLocale(next);
    setLocale(next);
    await setApplicationWindowTitle(next);
  };

  const handleSoundChange = (soundProfile: SoundProfile) => {
    update({ appearance: { ...settings.appearance, soundProfile } });
    if (settings.muted) {
      setToast(t("settings.mutedNotice"));
    } else {
      void playDrawSound(soundProfile, false, "lock");
    }
  };

  const exportBackup = async () => {
    try {
      await saveLocalFile(
        `${locale === "en-US" ? "RandDeck" : "掷数台"}-v${APP_VERSION}-backup.json`,
        JSON.stringify(buildBackup(snapshotState()), null, 2),
        "application/json"
      );
      setToast(t("settings.exportBackup"));
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const readBackup = async (file?: File) => {
    if (!file) return;
    try {
      const state = parseBackup(JSON.parse(await file.text()));
      setRestoreState(state);
      setRestoreOpen(true);
    } catch (error) {
      setError(t("errors.restoreFailed", { message: (error as Error).message }));
    }
  };

  const setDisplay = async (mode: "normal" | "fullscreen" | "overlay") => {
    try {
      update({ desktop: { ...settings.desktop, displayMode: mode } });
      await openDisplayWindow(mode);
      await setDisplayWindowMode(mode, mode === "overlay" && settings.desktop.displayClickThrough);
    } catch (error) {
      setError((error as Error).message);
    }
  };

  return (
    <div className="settings-view">
      <header className="view-heading">
        <div>
          <span className="section-label">{t("settings.system")}</span>
          <h1>{t("settings.heading")}</h1>
        </div>
        <span className="version-chip">v{APP_VERSION}</span>
      </header>

      {/* 外观与反馈 */}
      <section className="settings-band">
        <div className="settings-band-title">
          <Contrast size={19} />
          <div>
          <h2>{t("settings.appearance")}</h2>
            <p>{t("settings.appearanceDescription")}</p>
          </div>
        </div>
        <div className="settings-grid">
          <div className="setting-item">
            <span>{t("settings.language.label")}</span>
            <Segmented
              label={t("settings.language.label")}
              value={locale}
              options={[
                { value: "zh-CN", label: t("settings.language.zhCN") },
                { value: "en-US", label: t("settings.language.enUS") },
              ]}
              onChange={(next) => void changeLocale(next as AppLocale)}
            />
          </div>
          <div className="setting-item">
            <span>{t("settings.theme")}</span>
            <Segmented
              label={t("settings.theme")}
              value={settings.appearance.theme}
              options={[
                { value: "dark", label: t("settings.themes.dark") },
                { value: "light", label: t("settings.themes.light") },
                { value: "contrast", label: t("settings.themes.contrast") },
              ]}
              onChange={(theme) => update({ appearance: { ...settings.appearance, theme } })}
            />
          </div>
          <div className="setting-item setting-item--stacked">
            <div className="setting-item-top">
              <span>{t("settings.motion")}</span>
              <Segmented
                label={t("settings.motion")}
                value={settings.appearance.motion}
                options={[
                  { value: "instant", label: t("settings.motions.instant") },
                  { value: "standard", label: t("settings.motions.standard") },
                  { value: "ceremony", label: t("settings.motions.ceremony") },
                ]}
                onChange={(motion) => update({ appearance: { ...settings.appearance, motion } })}
              />
            </div>
            <small className="setting-hint">
              {translate(`settings.motionDescriptions.${settings.appearance.motion}`)}
            </small>
          </div>
          <div className="setting-item">
            <span>
              <Volume2 size={15} />
              {t("settings.sound")}
            </span>
            <Segmented
              label={t("settings.sound")}
              value={settings.appearance.soundProfile}
              options={[
                { value: "minimal", label: t("settings.sounds.minimal") },
                { value: "mechanical", label: t("settings.sounds.mechanical") },
                { value: "dice", label: t("settings.sounds.dice") },
              ]}
              onChange={handleSoundChange}
            />
          </div>
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={settings.appearance.particles}
              onChange={(event) => update({ appearance: { ...settings.appearance, particles: event.target.checked } })}
            />
            <span>
              <strong>
                <Sparkles size={15} />
                {t("settings.particles")}
              </strong>
              <small>{t("settings.particlesHelp")}</small>
            </span>
          </label>
        </div>
      </section>

      {/* 展示窗口 */}
      <section className="settings-band">
        <div className="settings-band-title">
          <MonitorUp size={19} />
          <div>
            <h2>{t("settings.displayWindow")}</h2>
            <p>{t("settings.displayDescription")}</p>
          </div>
        </div>
        <div className="display-settings">
          <div>
            <strong>{t("settings.displayMode")}</strong>
            <span>{t("settings.displayModeHelp")}</span>
          </div>
          <div className="display-modes">
            <button
              type="button"
              className={settings.desktop.displayMode === "normal" ? "active" : ""}
              onClick={() => void setDisplay("normal")}
            >
              {t("settings.normalWindow")}
            </button>
            <button
              type="button"
              className={settings.desktop.displayMode === "fullscreen" ? "active" : ""}
              onClick={() => void setDisplay("fullscreen")}
            >
              {t("settings.fullscreen")}
            </button>
            <button
              type="button"
              className={settings.desktop.displayMode === "overlay" ? "active" : ""}
              onClick={() => void setDisplay("overlay")}
            >
              {t("settings.overlay")}
            </button>
          </div>
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={settings.desktop.displayClickThrough}
              onChange={async (event) => {
                update({ desktop: { ...settings.desktop, displayClickThrough: event.target.checked } });
                await setDisplayWindowMode(
                  settings.desktop.displayMode,
                  event.target.checked && settings.desktop.displayMode === "overlay"
                );
              }}
            />
            <span>
                <strong>{t("settings.clickThrough")}</strong>
              <small>{t("settings.clickThroughHelp")}</small>
            </span>
          </label>
          {settings.desktop.displayClickThrough && (
            <Button
              variant="danger"
              onClick={async () => {
                update({ desktop: { ...settings.desktop, displayClickThrough: false } });
                await setDisplayWindowMode(settings.desktop.displayMode, false);
              }}
            >
              {t("settings.disableClickThrough")}
            </Button>
          )}
        </div>
      </section>

      {/* 本地数据 */}
      <section className="settings-band">
        <div className="settings-band-title">
          <Database size={19} />
          <div>
            <h2>{t("settings.localData")}</h2>
            <p>{t("settings.localDataDescription")}</p>
          </div>
        </div>
        <div className="data-actions">
          <Button icon={<Download size={15} />} onClick={() => void exportBackup()}>
            {t("settings.exportBackup")}
          </Button>
          <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            {t("settings.restoreBackup")}
          </Button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void readBackup(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
        {migrationNotes.length > 0 && (
          <div className="migration-log">
            <strong>{t("settings.migrationLog")}</strong>
            {migrationNotes.map((note) => (
              <span key={note}>{translateRuntimeMessage(note, t)}</span>
            ))}
          </div>
        )}
      </section>

      {/* 恢复备份确认对话框 */}
      <Dialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={t("settings.restoreTitle")}
        description={t("settings.restoreDescription")}
        footer={
          <>
            <Button variant="quiet" onClick={() => setRestoreOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (restoreState) {
                  replaceState(restoreState);
                  setRestoreOpen(false);
                  setRestoreState(null);
                  setToast(t("settings.restoreBackup"));
                }
              }}
            >
              {t("settings.replaceConfirm")}
            </Button>
          </>
        }
      >
        <p>{restoreState ? t("settings.restoreSummary", { history: restoreState.history.length, custom: restoreState.pools.customEntries.length, sessions: restoreState.sessionArchive.length }) : t("settings.restorePending")}</p>
      </Dialog>
    </div>
  );
}
