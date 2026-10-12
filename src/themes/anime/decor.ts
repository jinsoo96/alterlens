import type { DecorCtx } from '../types';

// 애니 풍경은 얼굴에 아무것도 그리지 않는다(사람은 실제 모습 그대로, 장면만 애니 배경 미술처럼).
const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif';

// 저장 사진: 얇은 테두리 + 작은 제목 칸
export function stamp(d: DecorCtx) {
  const { ctx, w, h } = d;
  const s = Math.min(w, h);
  const m = s * 0.025;
  ctx.strokeStyle = d.color(1);
  ctx.lineWidth = s * 0.008;
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
