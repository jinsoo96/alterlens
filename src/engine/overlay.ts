import { hexToRgb, type DecorCtx, type Theme, type ThemeVariant } from '../themes/types';
import type { Scene } from './scene';

export interface OverlayOpts {
  time: number;
  hud: boolean;
  mod: number;
  stamp: boolean; // 저장 사진용 프레임이면 테마 stamp 까지 찍는다
}

const layer = () => {
  const canvas = document.createElement('canvas');
  return { canvas, ctx: canvas.getContext('2d')! };
};

// 테마의 장식을 그리는 2D 캔버스 두 장. front 는 사람 위, back 은 사람 뒤(셰이더가 사람 마스크로 가린다).
// 둘 다 셰이더에서 색으로 덮이고 빛으로도 더해진다.
export class Overlay {
  readonly front = layer();
  readonly back = layer();

  draw(theme: Theme, variant: ThemeVariant, w: number, h: number, scene: Scene, o: OverlayOpts) {
    for (const l of [this.front, this.back]) {
      if (l.canvas.width !== w || l.canvas.height !== h) {
        l.canvas.width = w;
        l.canvas.height = h;
      }
      l.ctx.clearRect(0, 0, w, h);
      l.ctx.lineCap = 'round';
      l.ctx.lineJoin = 'round';
      l.ctx.textAlign = 'left';
      l.ctx.globalAlpha = 1;
    }

    const rgb = variant.colors.map(hexToRgb);
    const d: DecorCtx = {
      ctx: this.front.ctx,
      back: this.back.ctx,
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
      faces: scene.faces,
      bodies: scene.bodies,
    };

    if (theme.decorateBody) scene.bodies.forEach((b) => theme.decorateBody!(d, b));
    if (theme.decorateFace) scene.faces.forEach((f) => theme.decorateFace!(d, f));
    if (o.stamp && o.hud) theme.stamp?.(d);
  }
}
