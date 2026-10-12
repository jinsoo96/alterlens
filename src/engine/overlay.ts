import { hexToRgb, type DecorCtx, type Theme, type ThemeVariant } from '../themes/types';
import type { Face } from './vision';

export interface OverlayOpts {
  mirror: boolean;
  time: number;
  hud: boolean;
  mod: number;
  stamp: boolean; // 저장 사진용 프레임이면 테마 stamp 까지 찍는다
}

// 테마의 장식(얼굴 부품·HUD)을 그리는 2D 캔버스. 셰이더에서 색으로 덮이고 빛으로도 더해진다.
export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(theme: Theme, variant: ThemeVariant, w: number, h: number, faces: Face[], o: OverlayOpts) {
    const c = this.canvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textAlign = 'left';

    const rgb = variant.colors.map(hexToRgb);
    const d: DecorCtx = {
      ctx,
      w,
      h,
      time: o.time,
      hud: o.hud,
      mod: o.mod,
      variant,
      color: (slot, alpha = 1) => {
        const [r, g, b] = (rgb[slot] ?? [1, 1, 1]).map((v) => Math.round(v * 255));
        return `rgba(${r},${g},${b},${alpha})`;
      },
    };

    if (theme.decorateFace) {
      faces.forEach((f, index) => {
        const pt = (i: number) => {
          const p = f.points[i];
          return { x: (o.mirror ? 1 - p.x : p.x) * w, y: p.y * h };
        };
        const a = pt(234), b = pt(454); // 얼굴 양쪽 끝
        theme.decorateFace!(d, { index, count: f.points.length, pt, width: Math.hypot(a.x - b.x, a.y - b.y), jawOpen: f.jawOpen });
      });
    }
    if (o.stamp && o.hud) theme.stamp?.(d);
  }
}
