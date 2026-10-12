import type { DecorCtx, FaceView, Pt } from '../types';

// 얼굴 랜드마크 번호(MediaPipe 478점)
const ROLES = ['HACKER', 'RONIN', 'BROKER', 'COURIER', 'MEDIC', 'DRIFTER', 'MECHANIC', 'MERC'];
const JAW_L = [172, 136, 150, 149, 176, 148];
const JAW_R = [397, 365, 379, 378, 400, 377];
const BROW = [103, 67, 109, 10, 338, 297, 332];
const MASK = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 425, 2, 205];

type Color = DecorCtx['color'];
type P = (i: number) => Pt;

// 얼굴마다 개조 부품(0 바이저 · 1 사이버 눈+회로 · 2 호흡기) + 얼굴 태그
export function decorateFace(d: DecorCtx, f: FaceView) {
  const { ctx, color: c, time: t } = d;
  const P = f.pt;
  const fw = f.width;
  const lw = Math.max(1.5, fw * 0.012);

  const style = (f.index + d.mod) % 3;
  if (style === 1) circuits(ctx, P, fw, lw, t, c);
  if (style === 2) respirator(ctx, P, fw, lw, c);
  eyes(ctx, P, fw, t, c, style === 1);
  if (style === 0) visor(ctx, P, fw, lw, t, c);

  if (!d.hud) return;
  let x0 = d.w, y0 = d.h, x1 = 0, y1 = 0;
  for (let i = 0; i < f.count; i += 4) {
    const p = P(i);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const pad = fw * 0.15;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  brackets(ctx, x0, y0, x1, y1, (x1 - x0) * 0.18, c(3), lw);
  const fs = Math.max(11, fw * 0.075);
  ctx.font = `700 ${fs}px "Orbitron", "Share Tech Mono", monospace`;
  ctx.fillStyle = c(3);
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${ROLES[f.index % ROLES.length]} // LV.${17 + f.index * 9}`, x0, y0 - fs * 0.3);
  ctx.font = `400 ${fs * 0.85}px "Share Tech Mono", monospace`;
  ctx.fillStyle = c(4);
  ctx.textBaseline = 'top';
  const sync = 80 + Math.floor((Math.sin(t * 1.3 + f.index) * 0.5 + 0.5) * 19);
  ctx.fillText(`SYNC ${sync}%  ${f.jawOpen > 0.45 ? 'OVERDRIVE' : 'CHROME OK'}`, x0, y1 + fs * 0.3);
}

// 저장 사진 테두리: 모서리 괄호 + 앱 이름 · 색 조합 · 시각
export function stamp(d: DecorCtx) {
  const { ctx, w, h } = d;
  const s = Math.min(w, h);
  const m = s * 0.035;
  const A = d.color(3, 0.8);
  brackets(ctx, m, m, w - m, h - m, s * 0.08, A, Math.max(1.5, s * 0.003));
  const fs = Math.max(10, s * 0.026);
  ctx.font = `700 ${fs}px "Orbitron", monospace`;
  ctx.fillStyle = A;
  ctx.textBaseline = 'top';
  ctx.fillText('ALTER//LENS', m * 1.6, m * 1.5);
  ctx.textAlign = 'right';
  ctx.fillText(`CYBERPUNK · ${d.variant.name}`, w - m * 1.6, m * 1.5);
  ctx.font = `400 ${fs * 0.85}px "Share Tech Mono", monospace`;
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = d.color(4, 0.9);
  ctx.fillText('● REC', w - m * 1.6, h - m * 1.5);
  ctx.textAlign = 'left';
  ctx.fillText(timestamp(), m * 1.6, h - m * 1.5);
}

function visor(ctx: CanvasRenderingContext2D, P: P, fw: number, lw: number, t: number, c: Color) {
  let L = mid(P(33), P(133));
  let R = mid(P(362), P(263));
  if (R.x < L.x) [L, R] = [R, L];
  const vw = fw * 1.05;
  const vh = dist(L, R) * 0.5;
  ctx.save();
  ctx.translate((L.x + R.x) / 2, (L.y + R.y) / 2);
  ctx.rotate(Math.atan2(R.y - L.y, R.x - L.x));
  const g = ctx.createLinearGradient(-vw / 2, 0, vw / 2, 0);
  g.addColorStop(0, c(3, 0.55));
  g.addColorStop(0.5, c(4, 0.3));
  g.addColorStop(1, c(3, 0.55));
  ctx.beginPath();
  ctx.roundRect(-vw / 2, -vh / 2, vw, vh, vh * 0.45);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = c(3);
  ctx.lineWidth = lw * 1.4;
  ctx.stroke();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(((t * 0.7) % 1) * vw * 1.2 - vw * 0.6, -vh / 2, vw * 0.035, vh);
  ctx.strokeStyle = c(4, 0.5);
  ctx.lineWidth = lw * 0.5;
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath();
    ctx.moveTo(-vw / 2, (k * vh) / 4);
    ctx.lineTo(vw / 2, (k * vh) / 4);
    ctx.stroke();
  }
  ctx.restore();
}

function eyes(ctx: CanvasRenderingContext2D, P: P, fw: number, t: number, c: Color, big: boolean) {
  for (const [iris, corner] of [[468, 33], [473, 263]] as const) {
    const p = P(iris);
    const r = dist(p, P(corner)) * (big ? 0.55 : 0.32);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, c(4, 0.8));
    g.addColorStop(1, c(4, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (!big) continue;
    ctx.strokeStyle = c(3);
    ctx.lineWidth = Math.max(1, fw * 0.008);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.25, t * 2, t * 2 + Math.PI * 1.3);
    ctx.stroke();
  }
}

function circuits(ctx: CanvasRenderingContext2D, P: P, fw: number, lw: number, t: number, c: Color) {
  ctx.lineWidth = lw;
  for (const [edge, cheek] of [[234, 205], [454, 425]] as const) {
    const e = P(edge), k = P(cheek);
    ctx.strokeStyle = c(3);
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo((e.x + k.x) / 2, e.y);
    ctx.lineTo(k.x, k.y);
    ctx.stroke();
    dot(ctx, k, fw * 0.018, c(4));
  }
  ctx.strokeStyle = c(3, 0.8);
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  BROW.forEach((i, n) => (n ? ctx.lineTo(P(i).x, P(i).y) : ctx.moveTo(P(i).x, P(i).y)));
  ctx.stroke();
  BROW.forEach((i) => dot(ctx, P(i), fw * 0.012, c(3)));
  [...JAW_L, ...JAW_R].forEach((i, n) => {
    const on = Math.sin(t * 6 + n * 0.9) > -0.2;
    dot(ctx, P(i), fw * 0.014, on ? c(n % 2 ? 3 : 4) : 'rgba(40,40,60,0.6)');
  });
}

function respirator(ctx: CanvasRenderingContext2D, P: P, fw: number, lw: number, c: Color) {
  ctx.beginPath();
  MASK.forEach((i, n) => (n ? ctx.lineTo(P(i).x, P(i).y) : ctx.moveTo(P(i).x, P(i).y)));
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,10,20,0.85)';
  ctx.fill();
  ctx.strokeStyle = c(3);
  ctx.lineWidth = lw * 1.2;
  ctx.stroke();
  const m = P(14);
  ctx.strokeStyle = c(4);
  ctx.lineWidth = lw;
  for (let k = -1; k <= 1; k++) {
    const y = m.y + k * fw * 0.035;
    ctx.beginPath();
    ctx.moveTo(m.x - fw * 0.08, y);
    ctx.lineTo(m.x + fw * 0.08, y);
    ctx.stroke();
  }
  for (const [corner, edge] of [[61, 234], [291, 454]] as const) {
    const a = P(corner), b = P(edge);
    const q = { x: a.x + (b.x - a.x) * 0.45, y: a.y + (b.y - a.y) * 0.45 };
    ctx.fillStyle = 'rgba(20,20,35,0.95)';
    ctx.beginPath();
    ctx.arc(q.x, q.y, fw * 0.075, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c(4);
    ctx.stroke();
  }
}

function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} // NEO-SEOUL`;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function dot(ctx: CanvasRenderingContext2D, p: Pt, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function brackets(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, len: number, color: string, lw: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    ctx.moveTo(x + dx * len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * len);
  }
  ctx.stroke();
}
