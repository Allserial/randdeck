/**
 * 掷数台音频引擎
 * 音效来源：基于 public/audio/ 本地 CC0 音频素材与 Web Audio API / Tone.js 离线合成，无外网依赖。
 */
import type { SoundProfile } from "../domain/types";

let drumAudio: HTMLAudioElement | null = null;
let toneDrumLoop: { stop: () => void } | null = null;

export async function playDrawSound(
  profile: SoundProfile,
  muted: boolean,
  phase: "start" | "lock" | "tick" = "start"
): Promise<void> {
  if (muted) return;

  // 1. 如果是 tick，优先使用本地 CC0 countdown-tick.wav
  if (phase === "tick") {
    try {
      const tickAudio = new Audio("/audio/countdown-tick.wav");
      tickAudio.volume = 0.8;
      await tickAudio.play();
      return;
    } catch {
      // 失败转入 Tone.js 兜底
    }
  }

  try {
    const Tone = await import("tone");
    if (Tone.getContext().state !== "running") {
      await Tone.start();
    }
    if (phase === "tick") {
      const synth = new Tone.Synth({
        volume: -12,
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
      }).toDestination();
      synth.triggerAttackRelease("E6", "32n");
      window.setTimeout(() => synth.dispose(), 200);
      return;
    }

    if (profile === "minimal") {
      const synth = new Tone.Synth({
        volume: -18,
        oscillator: { type: "sine" },
        envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.08 },
      }).toDestination();
      synth.triggerAttackRelease(phase === "start" ? "C5" : "G5", "32n");
      window.setTimeout(() => synth.dispose(), 350);
      return;
    }

    if (profile === "mechanical") {
      const synth = new Tone.MembraneSynth({
        volume: -16,
        pitchDecay: 0.02,
        octaves: 2,
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 },
      }).toDestination();
      synth.triggerAttackRelease(phase === "start" ? "C2" : "G2", "32n");
      window.setTimeout(() => synth.dispose(), 400);
      return;
    }

    const noise = new Tone.NoiseSynth({
      volume: -22,
      noise: { type: "brown" },
      envelope: { attack: 0.002, decay: phase === "start" ? 0.22 : 0.08, sustain: 0 },
    }).toDestination();
    noise.triggerAttackRelease(phase === "start" ? "16n" : "32n");
    window.setTimeout(() => noise.dispose(), 500);
  } catch {
    /* Audio permissions must never block draws */
  }
}

/**
 * 倒计时循环低音鼓点节奏床
 */
export async function startCountdownDrums(muted: boolean): Promise<void> {
  stopCountdownDrums();
  if (muted) return;

  // 1. 优先尝试本地离线 /audio/countdown-drums.wav
  try {
    const audio = new Audio("/audio/countdown-drums.wav");
    audio.loop = true;
    audio.volume = 0.85;
    await audio.play();
    drumAudio = audio;
    return;
  } catch {
    // 若 HTMLAudioElement 被策略阻止或未就绪，使用 Tone.js 强化合成
  }

  try {
    const Tone = await import("tone");
    if (Tone.getContext().state !== "running") {
      await Tone.start();
    }
    const drumSynth = new Tone.MembraneSynth({
      volume: -12,
      pitchDecay: 0.06,
      octaves: 3,
      envelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.08 },
    }).toDestination();

    const hihat = new Tone.NoiseSynth({
      volume: -26,
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
    }).toDestination();

    let step = 0;
    const interval = window.setInterval(() => {
      try {
        const pitch = step % 4 === 0 ? "A1" : "F1";
        drumSynth.triggerAttackRelease(pitch, "16n");
        if (step % 2 === 1) {
          hihat.triggerAttackRelease("32n");
        }
        step += 1;
      } catch {
        /* ignore */
      }
    }, 250);

    toneDrumLoop = {
      stop: () => {
        window.clearInterval(interval);
        window.setTimeout(() => {
          drumSynth.dispose();
          hihat.dispose();
        }, 200);
      },
    };
  } catch {
    /* ignore */
  }
}

/**
 * 停止倒计时鼓点（无论 HTMLAudioElement 还是 Tone.js loop）
 */
export function stopCountdownDrums(): void {
  if (drumAudio) {
    try {
      drumAudio.pause();
      drumAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    drumAudio = null;
  }
  if (toneDrumLoop) {
    try {
      toneDrumLoop.stop();
    } catch {
      /* ignore */
    }
    toneDrumLoop = null;
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
