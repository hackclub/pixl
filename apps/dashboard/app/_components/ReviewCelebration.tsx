"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { REVIEW_REWARD_COOKIE, parseReviewReward, rewardLabel } from "@/lib/reviewReward";

// The little party after a verdict: confetti, a short celebratory sound and a
// "+6 pixels" card. reviewProject sets a one-shot cookie with the pixels the
// reviewer was paid just before it redirects (see lib/reviewReward.ts), this
// component sits in the root layout, which survives client navigations, so it
// checks for that cookie every time the path changes.
//
// No dependencies on purpose: the confetti is a small canvas loop and the
// sound is synthesised with the Web Audio API, so there's no asset to host.
// Honours prefers-reduced-motion (no confetti, the card still shows) and a
// localStorage switch: localStorage.setItem("pixl-review-celebrate", "off").

const COLORS = ["#f5c542", "#ff6b6b", "#4ecdc4", "#a78bfa", "#60a5fa", "#fb923c", "#34d399"];
const CARD_MS = 2400;
const CONFETTI_MS = 3600;

function readAndClearCookie(): number | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${REVIEW_REWARD_COOKIE}=`));
  if (!match) return null;
  document.cookie = `${REVIEW_REWARD_COOKIE}=; path=/; max-age=0`;
  return parseReviewReward(match.slice(REVIEW_REWARD_COOKIE.length + 1));
}

function celebrationEnabled(): boolean {
  try {
    return window.localStorage.getItem("pixl-review-celebrate") !== "off";
  } catch {
    return true;
  }
}

// A pop, then a quick rising C-major arpeggio with a sparkle on top. Browsers
// only let audio start after the user has interacted with the page, which the
// submit click counts as, but it can still be refused, so it never throws.
function playSound(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime;

    // Pop: a short burst of filtered noise.
    const noiseLen = Math.floor(ctx.sampleRate * 0.12);
    const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    noise.connect(filter);
    filter.connect(master);
    noise.start(t0);

    // Arpeggio: C5 E5 G5 C6, then a high sparkle.
    const notes = [523.25, 659.25, 783.99, 1046.5, 1568];
    notes.forEach((freq, i) => {
      const last = i === notes.length - 1;
      const start = t0 + 0.06 + i * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = last ? "triangle" : "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(last ? 0.5 : 0.7, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (last ? 0.5 : 0.22));
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + 0.55);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch {
    // Audio blocked or unsupported: the visuals still play.
  }
}

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  round: boolean;
}

function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function launchConfetti(): void {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "9999",
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);

  const w = window.innerWidth;
  const h = window.innerHeight;
  const pieces: Piece[] = [];
  // Two cannons from the bottom corners plus a shower from the top.
  const burst = (x: number, y: number, angle: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * 0.9;
      const speed = 9 + Math.random() * 9;
      pieces.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: 6 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.4,
        color: randomColor(),
        round: Math.random() < 0.25,
      });
    }
  };
  burst(0, h, -Math.PI / 3, 70);
  burst(w, h, (-2 * Math.PI) / 3, 70);
  for (let i = 0; i < 60; i++) {
    pieces.push({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 3,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: randomColor(),
      round: Math.random() < 0.25,
    });
  }

  const start = performance.now();
  const frame = (now: number) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    const fade = elapsed > CONFETTI_MS - 700 ? Math.max(0, (CONFETTI_MS - elapsed) / 700) : 1;
    for (const p of pieces) {
      p.vy += 0.28;
      p.vx *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    if (elapsed < CONFETTI_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

export function ReviewCelebration() {
  const pathname = usePathname();
  const [reward, setReward] = useState<{ px: number; key: number } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const px = readAndClearCookie();
    if (px === null || !celebrationEnabled()) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) launchConfetti();
    playSound();
    setReward({ px, key: Date.now() });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setReward(null), CARD_MS);
  }, [pathname]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!reward) return null;
  return (
    <div
      key={reward.key}
      role="status"
      aria-live="polite"
      className="pixl-reward-card"
      style={{
        position: "fixed",
        left: "50%",
        top: "38%",
        zIndex: 10000,
        pointerEvents: "none",
        transform: "translate(-50%, -50%)",
        padding: "18px 34px",
        borderRadius: 18,
        background: "rgba(20, 20, 28, 0.88)",
        border: "2px solid #f5c542",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        color: "#f5c542",
        fontFamily: "var(--font-heading), monospace",
        fontSize: reward.px > 0 ? 44 : 26,
        fontWeight: 800,
        letterSpacing: 1,
        textAlign: "center",
        animation: `pixl-reward-pop ${CARD_MS}ms ease-out forwards`,
      }}
    >
      {rewardLabel(reward.px)}
      <style>{`
        @keyframes pixl-reward-pop {
          0%   { opacity: 0; transform: translate(-50%, -30%) scale(0.5); }
          14%  { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
          24%  { transform: translate(-50%, -50%) scale(1); }
          78%  { opacity: 1; transform: translate(-50%, -54%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -70%) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pixl-reward-card { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
