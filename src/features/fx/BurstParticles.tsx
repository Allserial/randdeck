import { useEffect, useRef } from "react";
import { useAppStore } from "../../app/store";

export interface BurstOrigin {
  x: number;
  y: number;
}

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  opacity: number;
  life: number;
  maxLife: number;
}

const AMBER_COPPER_COLORS = ["#d4a054", "#e8c36a", "#f0c57a", "#c4842a", "#ffeed1", "#f5be6b"];
const LIGHT_COPPER_COLORS = ["#b07d38", "#9c6c19", "#d4a054", "#c4842a", "#7a5626", "#e8b868"];

export function BurstParticles({
  active,
  token,
  origin,
  fullscreen = false,
}: {
  active: boolean;
  token: string;
  origin?: BurstOrigin | null;
  fullscreen?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useAppStore((state) => state.settings.appearance.theme);
  const motion = useAppStore((state) => state.settings.appearance.motion);
  const particlesEnabled = useAppStore((state) => state.settings.appearance.particles);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    // 当不活跃或条件不满足时，立刻清空画布 (Item 1: 终止仪式/Esc 后不得残留礼花)
    if (!active || !particlesEnabled || motion === "instant" || theme === "contrast") {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };
    resize();

    const colors = theme === "light" ? LIGHT_COPPER_COLORS : AMBER_COPPER_COLORS;
    const particles: ConfettiParticle[] = [];
    let cancelWaves: (() => void) | undefined;

    // 单张卡牌礼花：源点为卡片中心（一小波 24-32 片，从中心向外炸开）
    if (!fullscreen) {
      if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const centerX = origin.x;
      const centerY = origin.y;
      const count = 28;

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const speed = 2.0 + Math.random() * 4.8;
        particles.push({
          x: centerX,
          y: centerY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          width: 7 + Math.random() * 5,
          height: 4 + Math.random() * 3,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.22,
          color: colors[Math.floor(Math.random() * colors.length)],
          opacity: 1,
          life: 0,
          maxLife: 38 + Math.floor(Math.random() * 14),
        });
      }
    } else {
      // 终场全屏大礼花：多波（左侧、右侧、顶部多点连续喷射）
      const spawnWave = (fromSide: "left" | "right" | "top") => {
        const count = fromSide === "top" ? 40 : 30;
        for (let i = 0; i < count; i++) {
          let x: number;
          let y: number;
          let vx: number;
          let vy: number;

          if (fromSide === "left") {
            x = 0;
            y = canvas.height * (0.2 + Math.random() * 0.5);
            vx = 5 + Math.random() * 9;
            vy = -4 - Math.random() * 7;
          } else if (fromSide === "right") {
            x = canvas.width;
            y = canvas.height * (0.2 + Math.random() * 0.5);
            vx = -5 - Math.random() * 9;
            vy = -4 - Math.random() * 7;
          } else {
            x = Math.random() * canvas.width;
            y = -10;
            vx = (Math.random() - 0.5) * 8;
            vy = 2 + Math.random() * 6;
          }

          particles.push({
            x,
            y,
            vx,
            vy,
            width: 8 + Math.random() * 8,
            height: 5 + Math.random() * 5,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.35,
            color: colors[Math.floor(Math.random() * colors.length)],
            opacity: 1,
            life: 0,
            maxLife: 75 + Math.floor(Math.random() * 50),
          });
        }
      };

      // 第一波立即发射
      spawnWave("left");
      spawnWave("right");
      spawnWave("top");

      // 第二波、第三波与第四波延迟发射
      const timer1 = window.setTimeout(() => {
        spawnWave("left");
        spawnWave("top");
      }, 200);

      const timer2 = window.setTimeout(() => {
        spawnWave("right");
        spawnWave("top");
      }, 420);

      const timer3 = window.setTimeout(() => {
        spawnWave("top");
      }, 650);

      // 清理延迟定时器
      cancelWaves = () => {
        window.clearTimeout(timer1);
        window.clearTimeout(timer2);
        window.clearTimeout(timer3);
      };
    }

    let raf = 0;
    const gravity = 0.14;
    const drag = 0.985;

    const tick = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      let aliveCount = 0;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life += 1;
        if (p.life >= p.maxLife) continue;

        aliveCount += 1;
        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        const progress = p.life / p.maxLife;
        p.opacity = Math.max(0, 1 - Math.pow(progress, 2.5));

        context.save();
        context.translate(p.x, p.y);
        context.rotate(p.rotation);
        context.globalAlpha = p.opacity;
        context.fillStyle = p.color;
        context.shadowColor = p.color;
        context.shadowBlur = 6;

        // 矩形粒子带圆角
        const hw = p.width / 2;
        const hh = p.height / 2;
        context.beginPath();
        context.roundRect(-hw, -hh, p.width, p.height, 1.5);
        context.fill();

        context.restore();
      }

      if (aliveCount > 0) {
        raf = window.requestAnimationFrame(tick);
      } else {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      if (cancelWaves) cancelWaves();
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [active, fullscreen, motion, origin, particlesEnabled, theme, token]);

  return <canvas ref={canvasRef} className="burst-canvas" aria-hidden="true" />;
}
