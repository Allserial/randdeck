/**
 * 掷数台（RandDeck）高定声学引擎
 * 采用 Web Audio API 物理建模与泛音合成（零外部网络依赖、零低采样率刺耳噪声）：
 * - minimal（极简）：温润水晶泛音双音（Crystal Harmonics）
 * - mechanical（机械）：瑞士陀飞轮黄铜棘轮拨动与大日历瞬跳锁止（Horological Ratchet & Latch）
 * - dice（骰子）：多面骰在实木绒面桌盘上的物理衰减弹跳与清脆落定（Polyhedral Cascading Bounce）
 * - countdown（仪式倒计时）：深邃星盘共鸣低音脉动 + 精密擒纵轮水晶整秒报时（Astrolabe Escapement Chime）
 */
import type { SoundProfile } from "../domain/types";

let sharedCtx: AudioContext | null = null;
let activeDrumLoop: { stop: () => void } | null = null;
let activeTimerIds: number[] = [];

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new Ctor();
  }
  if (sharedCtx.state === "suspended") {
    void sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

function clearScheduledTimers(): void {
  activeTimerIds.forEach((id) => window.clearTimeout(id));
  activeTimerIds = [];
}

/**
 * 播放单次泛音钟声 / 琴弦拨奏基元
 */
function playHarmonicTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  peakGain: number,
  type: OscillatorType = "sine",
  overtoneRatio = 2,
  overtoneGainRatio = 0.22
): void {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, startTime);
  master.gain.linearRampToValueAtTime(peakGain, startTime + 0.004);
  master.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  master.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  osc1.type = type;
  osc1.frequency.setValueAtTime(freq, startTime);
  osc1.connect(master);
  osc1.start(startTime);
  osc1.stop(startTime + duration + 0.01);

  if (overtoneGainRatio > 0) {
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(overtoneGainRatio, startTime);
    subGain.connect(master);

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(freq * overtoneRatio, startTime);
    osc2.connect(subGain);
    osc2.start(startTime);
    osc2.stop(startTime + duration * 0.7 + 0.01);
  }
}

/**
 * 播放精密机械棘齿轻击声（用于机械风格与擒纵轮滴答）
 */
function playMechanicalClick(
  ctx: AudioContext,
  startTime: number,
  pitchFreq: number,
  metallicFreq: number,
  gainAmount: number
): void {
  // 1. 极短促的木质/黄铜冲击包络
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, startTime);
  bodyGain.gain.linearRampToValueAtTime(gainAmount, startTime + 0.0015);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.028);
  bodyGain.connect(ctx.destination);

  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = "triangle";
  bodyOsc.frequency.setValueAtTime(pitchFreq * 1.4, startTime);
  bodyOsc.frequency.exponentialRampToValueAtTime(pitchFreq * 0.55, startTime + 0.025);
  bodyOsc.connect(bodyGain);
  bodyOsc.start(startTime);
  bodyOsc.stop(startTime + 0.03);

  // 2. 清透的金属泛音微光
  const pingGain = ctx.createGain();
  pingGain.gain.setValueAtTime(0.0001, startTime);
  pingGain.gain.linearRampToValueAtTime(gainAmount * 0.38, startTime + 0.001);
  pingGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.045);
  pingGain.connect(ctx.destination);

  const pingOsc = ctx.createOscillator();
  pingOsc.type = "sine";
  pingOsc.frequency.setValueAtTime(metallicFreq, startTime);
  pingOsc.connect(pingGain);
  pingOsc.start(startTime);
  pingOsc.stop(startTime + 0.05);
}

/**
 * 播放单颗多面骰在实木绒面桌盘上的清脆弹跳声（物理共振腔合成）
 */
function playDiceBounceHit(
  ctx: AudioContext,
  startTime: number,
  baseFreq: number,
  gainAmount: number
): void {
  // 实木桌面低频共振 + 骰子硬质外壳清脆高频泛音
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(baseFreq, startTime);
  filter.Q.setValueAtTime(6.5, startTime);
  filter.connect(ctx.destination);

  const hitGain = ctx.createGain();
  hitGain.gain.setValueAtTime(0.0001, startTime);
  hitGain.gain.linearRampToValueAtTime(gainAmount, startTime + 0.0012);
  hitGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.036);
  hitGain.connect(filter);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(baseFreq * 1.35, startTime);
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.48, startTime + 0.032);
  osc.connect(hitGain);
  osc.start(startTime);
  osc.stop(startTime + 0.04);

  // 晶石/亚克力多面骰棱角清脆泛音
  const shellGain = ctx.createGain();
  shellGain.gain.setValueAtTime(0.0001, startTime);
  shellGain.gain.linearRampToValueAtTime(gainAmount * 0.32, startTime + 0.001);
  shellGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.022);
  shellGain.connect(ctx.destination);

  const shellOsc = ctx.createOscillator();
  shellOsc.type = "sine";
  shellOsc.frequency.setValueAtTime(baseFreq * 2.65, startTime);
  shellOsc.connect(shellGain);
  shellOsc.start(startTime);
  shellOsc.stop(startTime + 0.025);
}

export async function playDrawSound(
  profile: SoundProfile,
  muted: boolean,
  phase: "start" | "lock" | "tick" = "start"
): Promise<void> {
  if (muted) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. 仪式倒计时整秒滴答：精密陀飞轮擒纵轻响 + 温润水晶泛音
    if (phase === "tick") {
      playMechanicalClick(ctx, now, 620, 1760, 0.11);
      playHarmonicTone(ctx, 880, now + 0.005, 0.16, 0.065, "sine", 1.5, 0.25);
      return;
    }

    // 2. 极简风格（minimal）：温润通透的双音水晶泛音
    if (profile === "minimal") {
      if (phase === "start") {
        playHarmonicTone(ctx, 587.33, now, 0.14, 0.09, "sine", 2, 0.18); // D5
      } else {
        playHarmonicTone(ctx, 587.33, now, 0.16, 0.08, "sine", 2, 0.15); // D5
        playHarmonicTone(ctx, 880.0, now + 0.045, 0.24, 0.10, "sine", 2, 0.22); // A5
      }
      return;
    }

    // 3. 机械风格（mechanical）：瑞士黄铜棘轮拨动与大日历视窗锁止声
    if (profile === "mechanical") {
      if (phase === "start") {
        // 5 声清脆递增的精密棘轮拨齿声
        const offsets = [0, 0.036, 0.074, 0.116, 0.162];
        offsets.forEach((offset, idx) => {
          playMechanicalClick(ctx, now + offset, 420 + idx * 45, 1320 + idx * 110, 0.12);
        });
      } else {
        // 双层机械卡扣瞬跳锁止 + 黄铜五度共鸣余韵
        playMechanicalClick(ctx, now, 480, 1480, 0.14);
        playMechanicalClick(ctx, now + 0.028, 640, 1980, 0.16);
        playHarmonicTone(ctx, 659.25, now + 0.03, 0.22, 0.075, "triangle", 1.5, 0.28); // E5 + B5
      }
      return;
    }

    // 4. 骰子风格（dice）：实木桌面多面骰滚动弹跳与清脆落定
    if (phase === "start") {
      // 模拟多面骰抛落桌面的自然物理衰减弹跳序列
      const schedule = [
        { t: 0.0, f: 780, g: 0.18 },
        { t: 0.042, f: 920, g: 0.15 },
        { t: 0.088, f: 840, g: 0.14 },
        { t: 0.138, f: 1050, g: 0.12 },
        { t: 0.194, f: 960, g: 0.10 },
        { t: 0.256, f: 1140, g: 0.08 },
      ];
      schedule.forEach(({ t, f, g }) => {
        playDiceBounceHit(ctx, now + t, f, g);
      });
    } else {
      // 骰子最终落定：两声轻巧触底弹跳 + 清亮晶石泛音
      playDiceBounceHit(ctx, now, 880, 0.16);
      playDiceBounceHit(ctx, now + 0.038, 1180, 0.14);
      playHarmonicTone(ctx, 783.99, now + 0.04, 0.20, 0.07, "sine", 1.5, 0.25); // G5
    }
  } catch {
    /* Audio permissions must never block draws */
  }
}

/**
 * 仪式倒计时背景律动：温暖深邃的星盘共鸣脉冲与钟摆微光（替代原有刺耳的 wav 鼓点）
 */
export async function startCountdownDrums(muted: boolean): Promise<void> {
  stopCountdownDrums();
  if (muted) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    let step = 0;
    const triggerPulse = () => {
      try {
        const now = ctx.currentTime;
        const isDownbeat = step % 2 === 0;
        // 温暖深沉的低音大提琴/星盘泛音（D3 / A2），绝不轰头
        const baseFreq = isDownbeat ? 146.83 : 110.0;
        playHarmonicTone(ctx, baseFreq, now, 0.38, isDownbeat ? 0.075 : 0.05, "sine", 2, 0.35);
        // 轻巧的半秒钟摆游丝微响
        playMechanicalClick(ctx, now, isDownbeat ? 520 : 440, isDownbeat ? 1560 : 1320, 0.055);
        step += 1;
      } catch {
        /* ignore */
      }
    };

    triggerPulse();
    const interval = window.setInterval(triggerPulse, 500);

    activeDrumLoop = {
      stop: () => {
        window.clearInterval(interval);
      },
    };
  } catch {
    /* ignore */
  }
}

/**
 * 停止倒计时背景律动
 */
export function stopCountdownDrums(): void {
  clearScheduledTimers();
  if (activeDrumLoop) {
    try {
      activeDrumLoop.stop();
    } catch {
      /* ignore */
    }
    activeDrumLoop = null;
  }
}

/**
 * 倒计时整秒跳动音效
 */
export async function playCountdownTick(muted: boolean): Promise<void> {
  await playDrawSound("minimal", muted, "tick");
}

/**
 * 响应全局静音状态变更
 */
export function syncMutedAudio(muted: boolean): void {
  if (muted) {
    stopCountdownDrums();
  }
}
