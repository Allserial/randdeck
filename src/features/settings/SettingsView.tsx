import { useRef, useState } from "react";
import { Contrast, Database, Download, MonitorUp, Sparkles, Upload, Volume2 } from "lucide-react";
import type { SoundProfile } from "../../domain/types";
import { buildBackup, parseBackup, summarizeState } from "../../app/state";
import { snapshotState, useAppStore } from "../../app/store";
import { openDisplayWindow, setDisplayWindowMode } from "../../platform/desktop";
import { saveLocalFile } from "../../platform/files";
import { playDrawSound } from "../../platform/audio";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Segmented } from "../../components/ui/Segmented";

const MOTION_DESCRIPTIONS: Record<string, string> = {
  instant: "无跳动、无仪式、无礼花；倒计时结束后一次揭晓。",
  standard: "短跳动；倒计时后生成仍逐张揭晓，礼花较弱。",
  ceremony: "完整揭晓节奏与全屏礼花。",
};

export default function SettingsView() {
  const settings = useAppStore((state) => state.settings);
  const migrationNotes = useAppStore((state) => state.migrationNotes);
  const update = useAppStore((state) => state.updateSettings);
  const replaceState = useAppStore((state) => state.replacePersistentState);
  const setToast = useAppStore((state) => state.setToast);
  const setError = useAppStore((state) => state.setError);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreState, setRestoreState] = useState<ReturnType<typeof parseBackup> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSoundChange = (soundProfile: SoundProfile) => {
    update({ appearance: { ...settings.appearance, soundProfile } });
    if (settings.muted) {
      setToast("当前已静音");
    } else {
      void playDrawSound(soundProfile, false, "lock");
    }
  };

  const exportBackup = async () => {
    try {
      await saveLocalFile(
        "掷数台-v0.5.0-完整备份.json",
        JSON.stringify(buildBackup(snapshotState()), null, 2),
        "application/json"
      );
      setToast("完整备份已导出");
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
      setError(`备份无法恢复：${(error as Error).message}`);
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
          <span className="section-label">系统设置</span>
          <h1>外观、展示与本地数据</h1>
        </div>
        <span className="version-chip">v0.5.0</span>
      </header>

      {/* 外观与反馈 */}
      <section className="settings-band">
        <div className="settings-band-title">
          <Contrast size={19} />
          <div>
            <h2>外观与反馈</h2>
            <p>墨蓝底 + 琥珀铜金属质感 2D 工作台。</p>
          </div>
        </div>
        <div className="settings-grid">
          <div className="setting-item">
            <span>主题</span>
            <Segmented
              label="主题"
              value={settings.appearance.theme}
              options={[
                { value: "dark", label: "标准墨蓝" },
                { value: "light", label: "暖灰浅色" },
                { value: "contrast", label: "高对比" },
              ]}
              onChange={(theme) => update({ appearance: { ...settings.appearance, theme } })}
            />
          </div>
          <div className="setting-item setting-item--stacked">
            <div className="setting-item-top">
              <span>动态效果</span>
              <Segmented
                label="动态效果"
                value={settings.appearance.motion}
                options={[
                  { value: "instant", label: "即时" },
                  { value: "standard", label: "标准" },
                  { value: "ceremony", label: "仪式" },
                ]}
                onChange={(motion) => update({ appearance: { ...settings.appearance, motion } })}
              />
            </div>
            <small className="setting-hint">
              {MOTION_DESCRIPTIONS[settings.appearance.motion] || ""}
            </small>
          </div>
          <div className="setting-item">
            <span>
              <Volume2 size={15} />
              音效风格（切换试听）
            </span>
            <Segmented
              label="音效风格"
              value={settings.appearance.soundProfile}
              options={[
                { value: "minimal", label: "极简" },
                { value: "mechanical", label: "机械" },
                { value: "dice", label: "骰子" },
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
                仪式粒子效果
              </strong>
              <small>仅在抽取完成时迸发 2D 铜金碎屑</small>
            </span>
          </label>
        </div>
      </section>

      {/* 展示窗口 */}
      <section className="settings-band">
        <div className="settings-band-title">
          <MonitorUp size={19} />
          <div>
            <h2>独立展示窗口</h2>
            <p>可投屏演示或透明置顶悬浮。</p>
          </div>
        </div>
        <div className="display-settings">
          <div>
            <strong>展示模式选择</strong>
            <span>支持普通视窗、全屏横向演示与无边框透明置顶</span>
          </div>
          <div className="display-modes">
            <button
              type="button"
              className={settings.desktop.displayMode === "normal" ? "active" : ""}
              onClick={() => void setDisplay("normal")}
            >
              普通窗口
            </button>
            <button
              type="button"
              className={settings.desktop.displayMode === "fullscreen" ? "active" : ""}
              onClick={() => void setDisplay("fullscreen")}
            >
              全屏演示
            </button>
            <button
              type="button"
              className={settings.desktop.displayMode === "overlay" ? "active" : ""}
              onClick={() => void setDisplay("overlay")}
            >
              透明置顶
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
              <strong>透明置顶鼠标穿透</strong>
              <small>开启后鼠标点击可直接穿透展示窗口到下层窗口</small>
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
              立即关闭鼠标穿透
            </Button>
          )}
        </div>
      </section>

      {/* 本地数据 */}
      <section className="settings-band">
        <div className="settings-band-title">
          <Database size={19} />
          <div>
            <h2>本地数据与备份</h2>
            <p>纯本地加密级生成，支持导出/导入版本化完整数据。</p>
          </div>
        </div>
        <div className="data-actions">
          <Button icon={<Download size={15} />} onClick={() => void exportBackup()}>
            导出完整备份
          </Button>
          <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            恢复备份
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
            <strong>数据迁移记录</strong>
            {migrationNotes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </div>
        )}
      </section>

      {/* 恢复备份确认对话框 */}
      <Dialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title="恢复完整备份"
        description="恢复备份将整体替换当前应用的历史、池配置与统计数据。"
        footer={
          <>
            <Button variant="quiet" onClick={() => setRestoreOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (restoreState) {
                  replaceState(restoreState);
                  setRestoreOpen(false);
                  setRestoreState(null);
                  setToast("备份已恢复");
                }
              }}
            >
              确认替换
            </Button>
          </>
        }
      >
        <p>{restoreState ? summarizeState(restoreState) : "正在校验备份文件…"}</p>
      </Dialog>
    </div>
  );
}
