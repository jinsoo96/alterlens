import type { DecorCtx, FaceView, Pt } from '../types';

// 슬롯: 0 그림자 · 1 먹선 · 2 눈동자·포인트 · 3 하늘 · 4 머리카락
// 눈꺼풀 랜드마크(사람 오른쪽 눈 A, 왼쪽 눈 B): 바깥 눈꼬리 → 안쪽
const UPPER_A = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const LOWER_A = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const UPPER_B = [263, 466, 388, 387, 386, 385, 384, 398, 362];
const LOWER_B = [263, 249, 390, 373, 374, 380, 381, 382, 362];
const BROW_A = { upper: [70, 63, 105, 66, 107], lower: [46, 53, 52, 65, 55] };
const BROW_B = { upper: [300, 293, 334, 296, 336], lower: [276, 283, 282, 295, 285] };
const LIP_UPPER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LIP_LOWER = [308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78];
const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif';

type Ctx = CanvasRenderingContext2D;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (p: Pt, v: Pt, k: number): Pt => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const rand = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

export function decorateFace(d: DecorCtx, f: FaceView) {
  const { ctx } = d;
  const fw = f.width;
  const up = { x: Math.sin(f.roll), y: -Math.cos(f.roll) };
  const side = { x: Math.cos(f.roll), y: Math.sin(f.roll) };
  const ink = d.color(1);

  for (const [upper, lower, iris] of [[UPPER_A, LOWER_A, 468], [UPPER_B, LOWER_B, 473]] as const) {
    const c = f.pt(iris);
    const blink = f.eyes.reduce((a, e) => (dist(e.iris, c) < dist(a.iris, c) ? e : a)).blink;
    animeEye(ctx, f, upper, lower, iris, blink, fw, ink, d);
  }
  brows(ctx, f, fw, ink);
  noseAndMouth(ctx, f, fw, ink);
  blush(ctx, f, fw);

  const mod = (f.index + d.mod) % 3;
  const top = add(f.center, up, fw * 0.78);
  if (mod === 0) ribbon(ctx, add(top, side, fw * 0.34), f.roll, fw, d);
  if (mod === 1) catEars(ctx, top, up, side, fw, d);
  if (mod === 2) hairpins(ctx, add(add(f.center, up, fw * 0.55), side, fw * 0.42), f.roll, fw, d);

  reactions(ctx, f, d, up, side);
  if (d.hud) bubble(ctx, f, d, up, side);
}

function path(ctx: Ctx, pts: Pt[]) {
  pts.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
}

// 애니 눈: 굵은 윗선 + 눈꼬리 + (뜬 눈이면) 큰 눈동자 그라데이션 · 하이라이트. 눈동자는 눈 모양 안으로 자른다
function animeEye(ctx: Ctx, f: FaceView, upper: readonly number[], lower: readonly number[], iris: number, blink: number, fw: number, ink: string, d: DecorCtx) {
  const U = upper.map((i) => f.pt(i));
  const Lo = lower.map((i) => f.pt(i));
  const outer = U[0], inner = U[U.length - 1];
  const ew = dist(outer, inner);

  if (blink < 0.45) {
    const c = f.pt(iris);
    const r = ew * 0.36;
    ctx.save();
    ctx.beginPath();
    path(ctx, U);
    path(ctx, [...Lo].reverse());
    ctx.closePath();
    ctx.clip();
    const g = ctx.createLinearGradient(c.x, c.y - r, c.x, c.y + r);
    g.addColorStop(0, d.color(1, 0.85));
    g.addColorStop(0.45, d.color(2, 0.75));
    g.addColorStop(1, d.color(2, 0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * 0.92, r * 1.08, f.roll, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = d.color(1, 0.55);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + r * 0.1, r * 0.38, r * 0.5, f.roll, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(c.x - r * 0.38, c.y - r * 0.42, r * 0.3, r * 0.24, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x + r * 0.42, c.y + r * 0.45, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 윗선(굵게) + 바깥 눈꼬리 날개
  ctx.strokeStyle = ink;
  ctx.lineWidth = fw * 0.022;
  ctx.beginPath();
  path(ctx, U);
  const dir = { x: (outer.x - inner.x) / ew, y: (outer.y - inner.y) / ew };
  const wing = { x: outer.x + dir.x * fw * 0.045, y: outer.y + dir.y * fw * 0.045 - fw * 0.02 };
  ctx.moveTo(outer.x, outer.y);
  ctx.lineTo(wing.x, wing.y);
  ctx.stroke();
  // 아랫선은 바깥쪽 1/3 만 얇게
  ctx.lineWidth = fw * 0.008;
  ctx.beginPath();
  path(ctx, Lo.slice(0, 4));
  ctx.stroke();
}

// 애니 눈썹: 실제 눈썹 가운데를 따라 가늘게, 안쪽이 굵다
function brows(ctx: Ctx, f: FaceView, fw: number, ink: string) {
  for (const b of [BROW_A, BROW_B]) {
    const mid = b.upper.map((u, k) => {
      const p = f.pt(u), q = f.pt(b.lower[k]);
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    });
    ctx.strokeStyle = ink;
    for (let k = 0; k < mid.length - 1; k++) {
      ctx.lineWidth = fw * (0.01 + 0.004 * k);
      ctx.beginPath();
      ctx.moveTo(mid[k].x, mid[k].y);
      ctx.lineTo(mid[k + 1].x, mid[k + 1].y);
      ctx.stroke();
    }
  }
}

// 코는 작은 선 하나, 입은 벌어지면 애니 입(어두운 속 + 윗니 띠 + 혀), 다물면 선 하나
function noseAndMouth(ctx: Ctx, f: FaceView, fw: number, ink: string) {
  const tip = f.pt(1), base = f.pt(2);
  ctx.strokeStyle = ink;
  ctx.lineWidth = fw * 0.01;
  ctx.beginPath();
  ctx.moveTo(base.x - fw * 0.012, base.y);
  ctx.lineTo(base.x + fw * 0.01, base.y - (base.y - tip.y) * 0.3);
  ctx.stroke();

  const U = LIP_UPPER.map((i) => f.pt(i));
  const Lo = LIP_LOWER.map((i) => f.pt(i));
  const gap = dist(f.pt(13), f.pt(14));
  if (gap > fw * 0.025) {
    ctx.save();
    ctx.beginPath();
    path(ctx, U);
    path(ctx, Lo);
    ctx.closePath();
    ctx.fillStyle = 'rgb(120,30,45)';
    ctx.fill();
    ctx.clip();
    const lo = f.pt(14);
    ctx.fillStyle = 'rgb(235,110,120)';
    ctx.beginPath();
    ctx.ellipse(lo.x, lo.y, fw * 0.09, gap * 0.45, f.roll, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.min(gap * 0.5, fw * 0.035);
    ctx.beginPath();
    path(ctx, U);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = ink;
    ctx.lineWidth = fw * 0.012;
    ctx.beginPath();
    path(ctx, U);
    path(ctx, Lo);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.strokeStyle = ink;
    ctx.lineWidth = fw * 0.012;
    ctx.beginPath();
    path(ctx, U);
    ctx.stroke();
  }
}

// 볼 홍조: 분홍 타원 + 빗금(///). 웃을수록 진하다
function blush(ctx: Ctx, f: FaceView, fw: number) {
  const a = 0.25 + 0.45 * f.expr.smile;
  for (const i of [50, 280]) {
    const c = f.pt(i);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, fw * 0.11);
    g.addColorStop(0, `rgba(255,110,140,${a * 0.7})`);
    g.addColorStop(1, 'rgba(255,110,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, fw * 0.11, fw * 0.065, f.roll, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(225,70,105,${a})`;
    ctx.lineWidth = fw * 0.008;
    ctx.beginPath();
    for (let k = -1; k <= 1; k++) {
      const x = c.x + k * fw * 0.035;
      ctx.moveTo(x - fw * 0.012, c.y + fw * 0.025);
      ctx.lineTo(x + fw * 0.012, c.y - fw * 0.025);
    }
    ctx.stroke();
  }
}

function ribbon(ctx: Ctx, c: Pt, roll: number, fw: number, d: DecorCtx) {
  const s = fw * 0.16;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(roll + 0.3);
  ctx.fillStyle = d.color(2);
  ctx.strokeStyle = d.color(1);
  ctx.lineWidth = fw * 0.012;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dir * s * 1.4, -s * 1.1, dir * s * 1.5, 0);
    ctx.quadraticCurveTo(dir * s * 1.4, s * 1.0, 0, 0);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dir * s * 0.7, s * 1.5);
    ctx.lineTo(dir * s * 0.35, s * 1.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.32, s * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function catEars(ctx: Ctx, top: Pt, up: Pt, side: Pt, fw: number, d: DecorCtx) {
  const fill = (d.variant.params?.[0] ?? 1) > 0 ? d.color(4) : 'rgb(58,42,36)';
  for (const dir of [-1, 1]) {
    const base = add(top, side, dir * fw * 0.3);
    const b1 = add(base, side, -fw * 0.13);
    const b2 = add(base, side, fw * 0.13);
    const tip = add(add(base, up, fw * 0.32), side, dir * fw * 0.08);
    ctx.fillStyle = fill;
    ctx.strokeStyle = d.color(1);
    ctx.lineWidth = fw * 0.014;
    ctx.beginPath();
    path(ctx, [b1, tip, b2]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,170,190,0.95)';
    const i1 = add(add(b1, side, fw * 0.05), up, fw * 0.02);
    const i2 = add(add(b2, side, -fw * 0.05), up, fw * 0.02);
    const it = add(tip, up, -fw * 0.09);
    ctx.beginPath();
    path(ctx, [i1, it, i2]);
    ctx.closePath();
    ctx.fill();
  }
}

function hairpins(ctx: Ctx, c: Pt, roll: number, fw: number, d: DecorCtx) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(roll);
  ctx.lineWidth = fw * 0.025;
  ctx.lineCap = 'round';
  for (const [a, col] of [[0.5, d.color(2)], [-0.2, 'rgba(255,220,90,1)']] as const) {
    ctx.strokeStyle = d.color(1);
    ctx.lineWidth = fw * 0.035;
    ctx.beginPath();
    ctx.moveTo(-Math.cos(a) * fw * 0.1, -Math.sin(a) * fw * 0.1);
    ctx.lineTo(Math.cos(a) * fw * 0.1, Math.sin(a) * fw * 0.1);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = fw * 0.02;
    ctx.stroke();
  }
  star(ctx, { x: fw * 0.02, y: -fw * 0.1 }, fw * 0.06, 'rgba(255,225,90,1)', d.color(1), 5);
  ctx.restore();
}

// 만화 기호: 미소 → 반짝이 · 윙크 → 별 · 놀람/입 벌림 → 집중선 · 찡그림 → 💢 · 뽀뽀 → 하트
function reactions(ctx: Ctx, f: FaceView, d: DecorCtx, up: Pt, side: Pt) {
  const t = d.time;
  const fw = f.width;
  const c = f.center;

  const n = Math.round(f.expr.smile * 6);
  for (let k = 0; k < n; k++) {
    const a = rand(k + f.index * 7) * Math.PI * 2;
    const r = fw * (0.75 + 0.2 * rand(k * 2.3));
    const pulse = 0.6 + 0.4 * Math.sin(t * 5 + k * 1.7);
    star(ctx, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.9 }, fw * 0.045 * pulse, '#ffffff', d.color(2), 4);
  }

  const ws = f.since('wink');
  if (ws >= 0) {
    const eye = f.eyes[0].blink > f.eyes[1].blink ? f.eyes[0] : f.eyes[1];
    const out = eye.center.x < c.x ? -1 : 1;
    const pop = Math.min(1, ws / 0.2);
    star(ctx, add(add(eye.center, side, out * fw * 0.22), up, fw * 0.08), fw * 0.09 * pop, 'rgba(255,220,80,1)', d.color(1), 5);
    if (ws < 0.6) star(ctx, add(add(eye.center, side, out * fw * (0.3 + ws * 0.4)), up, fw * (0.15 + ws * 0.3)), fw * 0.04, 'rgba(255,220,80,1)', d.color(1), 5);
  }

  const ss = Math.max(f.since('surprise'), f.since('mouthOpen'));
  if (ss >= 0 && ss < 0.8) {
    ctx.strokeStyle = d.color(1, 0.85 * (1 - ss / 0.8));
    ctx.lineWidth = fw * 0.012;
    ctx.beginPath();
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2 + rand(k) * 0.1;
      const r0 = fw * (0.8 + rand(k * 3.1) * 0.15);
      const r1 = r0 + fw * (0.25 + rand(k * 5.7) * 0.25);
      ctx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
      ctx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
    }
    ctx.stroke();
  }

  if (f.expr.frown > 0.5) {
    const v = add(add(c, up, fw * 0.55), side, fw * 0.36);
    const s = fw * 0.07;
    ctx.strokeStyle = '#e8384c';
    ctx.lineWidth = fw * 0.022;
    for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // 💢: 네 귀퉁이에서 가운데를 향해 휘는 혈관
      ctx.beginPath();
      ctx.arc(v.x + qx * s * 1.1, v.y + qy * s * 1.1, s * 0.75, Math.atan2(-qy, -qx) - 0.9, Math.atan2(-qy, -qx) + 0.9);
      ctx.stroke();
    }
  }

  if (f.expr.pucker > 0.55) {
    const m = f.pt(13);
    for (let k = 0; k < 3; k++) {
      const life = (t * 0.6 + k / 3) % 1;
      const p = add(add(m, side, Math.sin(life * 6 + k) * fw * 0.12 + fw * 0.15), up, life * fw * 0.9);
      heart(ctx, p, fw * 0.08, `rgba(255,80,130,${1 - life * 0.7})`, d.color(1, 1 - life * 0.7));
    }
  }
}

// 만화 말풍선 효과음(HUD 를 켰을 때)
function bubble(ctx: Ctx, f: FaceView, d: DecorCtx, up: Pt, side: Pt) {
  const e = f.expr;
  const text =
    f.since('wink') >= 0 ? 'パチッ☆'
    : f.since('surprise') >= 0 || f.since('mouthOpen') >= 0 ? 'えっ!?'
    : e.frown > 0.5 ? 'ムッ'
    : e.pucker > 0.55 ? 'ちゅっ♡'
    : e.smile > 0.5 ? 'にこっ♪'
    : '';
  if (!text) return;
  const fw = f.width;
  const fs = Math.max(12, fw * 0.12);
  ctx.font = `800 ${fs}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const bw = tw + fs, bh = fs * 1.6;
  // 얼굴 오른쪽 위, 화면을 넘으면 왼쪽으로. 위아래도 화면 안에
  let c = add(add(f.center, up, fw * 0.45), side, fw * 0.95);
  if (c.x + bw / 2 > d.w - 8) c = add(add(f.center, up, fw * 0.45), side, -fw * 0.95);
  c = { x: Math.min(Math.max(c.x, bw / 2 + 8), d.w - bw / 2 - 8), y: Math.min(Math.max(c.y, bh / 2 + 8), d.h - bh - 8) };
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.strokeStyle = d.color(1);
  ctx.lineWidth = Math.max(1.5, fs * 0.09);
  ctx.beginPath();
  ctx.roundRect(c.x - bw / 2, c.y - bh / 2, bw, bh, bh / 2);
  ctx.moveTo(c.x - bw * 0.25, c.y + bh / 2 - 1);
  ctx.lineTo(c.x - bw * 0.42, c.y + bh * 0.95);
  ctx.lineTo(c.x - bw * 0.08, c.y + bh / 2 - 1);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = d.color(1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.x, c.y + fs * 0.05);
  ctx.textAlign = 'left';
}

// 저장 사진: 만화 칸 테두리 + 작은 제목 칸
export function stamp(d: DecorCtx) {
  const { ctx, w, h } = d;
  const s = Math.min(w, h);
  const m = s * 0.025;
  ctx.strokeStyle = d.color(1);
  ctx.lineWidth = s * 0.012;
  ctx.strokeRect(m, m, w - m * 2, h - m * 2);
  const fs = Math.max(11, s * 0.028);
  ctx.font = `800 ${fs}px ${FONT}`;
  const label = `ALTERLENS · ANIME · ${d.variant.name}`;
  const tw = ctx.measureText(label).width;
  const x = w - m - tw - fs * 1.2, y = h - m - fs * 1.9;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, tw + fs * 1.2, fs * 1.9);
  ctx.lineWidth = s * 0.006;
  ctx.strokeRect(x, y, tw + fs * 1.2, fs * 1.9);
  ctx.fillStyle = d.color(1);
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + fs * 0.6, y + fs * 0.98);
}

function star(ctx: Ctx, p: Pt, r: number, fill: string, stroke: string, points: number) {
  if (r <= 0) return;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.beginPath();
  for (let k = 0; k < points * 2; k++) {
    const a = (k / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 ? r * (points === 4 ? 0.28 : 0.45) : r;
    const x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr;
    if (k) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function heart(ctx: Ctx, p: Pt, s: number, fill: string, stroke: string) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y + s * 0.35);
  ctx.bezierCurveTo(p.x - s, p.y - s * 0.4, p.x - s * 0.4, p.y - s, p.x, p.y - s * 0.4);
  ctx.bezierCurveTo(p.x + s * 0.4, p.y - s, p.x + s, p.y - s * 0.4, p.x, p.y + s * 0.35);
  ctx.fill();
  ctx.stroke();
}
