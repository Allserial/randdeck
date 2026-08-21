import fs from "node:fs";
import path from "node:path";

const audioDir = path.join(process.cwd(), "public", "audio");
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

function createWavBuffer(sampleRate, durationSec, sampleFn) {
  const totalSamples = Math.floor(sampleRate * durationSec);
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);

  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = sampleFn(t, i, totalSamples);
    sample = Math.max(-1, Math.min(1, sample));
    const intSample = Math.floor(sample * 32767);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

const sampleRate = 44100;

// 1. countdown-drums.wav: 2.0s 循环激烈低音节奏床 (4/4 拍底鼓 + 弱闭镲节奏脉冲 + Sub-bass 铺底)
const drumWav = createWavBuffer(sampleRate, 2.0, (t) => {
  const beatTime = t % 0.5; // 每 0.5 秒一拍 (120 BPM)
  const beatIndex = Math.floor(t / 0.5);

  let kick = 0;
  if (beatTime < 0.25) {
    const kickFreq = 45 + 85 * Math.exp(-beatTime * 32);
    const env = Math.exp(-beatTime * 16);
    kick = Math.sin(2 * Math.PI * kickFreq * beatTime) * env * 0.95;
  }

  const hihatTime = t % 0.25;
  let hihat = 0;
  if (hihatTime < 0.04) {
    const noise = Math.random() * 2 - 1;
    const env = Math.exp(-hihatTime * 85);
    hihat = noise * env * 0.18;
  }

  const bassFreq = beatIndex % 2 === 0 ? 55 : 49;
  const bass = Math.sin(2 * Math.PI * bassFreq * t) * 0.25;

  return kick + hihat + bass;
});

fs.writeFileSync(path.join(audioDir, "countdown-drums.wav"), drumWav);

// 2. countdown-tick.wav: 0.06s 短促清脆的整秒 tick (高频点击音)
const tickWav = createWavBuffer(sampleRate, 0.06, (t) => {
  const clickFreq = 2200 + 1400 * Math.exp(-t * 140);
  const env = Math.exp(-t * 80);
  const tone = Math.sin(2 * Math.PI * clickFreq * t) * env * 0.85;
  const transient = (Math.random() * 2 - 1) * Math.exp(-t * 220) * 0.45;
  return tone + transient;
});

fs.writeFileSync(path.join(audioDir, "countdown-tick.wav"), tickWav);

const sourcesContent = `# 掷数台 (Zhishutai) 离线音频素材说明

本项目所有音频素材均为本地离线生成与使用，遵循 CC0 1.0 Universal (CC0 1.0) 公共领域许可协议。

## 音频文件清单
1. countdown-drums.wav
   - 描述：倒计时 4/4 拍激烈低音鼓点与节奏床 (120 BPM)
   - 来源：基于标准 PCM WAV 本地离线合成 (CC0 Public Domain)
   - 许可：CC0 1.0 Universal

2. countdown-tick.wav
   - 描述：倒计时整秒跳动清脆高频 tick 音
   - 来源：基于标准 PCM WAV 本地离线合成 (CC0 Public Domain)
   - 许可：CC0 1.0 Universal

没有任何网络依赖，离线完全可用。
`;

fs.writeFileSync(path.join(audioDir, "SOURCES.txt"), sourcesContent, "utf-8");
console.log("Audio assets generated in public/audio/");
