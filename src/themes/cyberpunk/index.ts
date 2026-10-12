import type { Theme } from '../types';
import { decorateFace, stamp } from './decor';
import { STYLE } from './style';

// 사이버펑크: 밤의 네온 도시 + 크롬·테크웨어 캐릭터 + 얼굴 개조 부품
export const cyberpunk: Theme = {
  id: 'cyberpunk',
  name: 'CYBERPUNK',
  // 색 슬롯: 0 그림자 · 1 중간 · 2 하이라이트 · 3 네온A(세로 윤곽·림) · 4 네온B(가로 윤곽·옷 트림)
  variants: [
    { id: 'neon', name: 'NEON', colors: ['#0b0420', '#3a1a6b', '#ff7ad9', '#19f6ff', '#ff2bd6'] },
    { id: 'volt', name: 'VOLT', colors: ['#07070d', '#2b2140', '#fcee0a', '#00f0ff', '#fcee0a'] },
    { id: 'blade', name: 'BLADE', colors: ['#140604', '#6b2a0e', '#ffb347', '#22e0d0', '#ff4d1f'] },
    { id: 'acid', name: 'ACID', colors: ['#020b06', '#0d3b2a', '#c8ff4d', '#b6ff00', '#00ffa3'] },
    { id: 'ghost', name: 'GHOST', colors: ['#02040f', '#10306b', '#9fd8ff', '#6ef3ff', '#7a5cff'] },
  ],
  needs: ['parts', 'face'],
  glsl: STYLE,
  post: { glow: 0.55, bloom: 1.5, chroma: 0.0018, scanlines: 0.07, grain: 0.035, vignette: 0.7, exposure: 1.35, overlayGlow: 0.9 },
  effects: { particles: { kind: 'rain', label: 'RAIN', colorSlot: 3 }, glitch: true },
  faceMods: 3,
  aiNames: ['a glowing cyber visor over the eyes', 'glowing cybernetic eyes with circuit lines on the cheeks', 'a sleek black respirator mask over the mouth'],
  decorateFace,
  stamp,
  fonts: ['700 20px Orbitron', '400 20px "Share Tech Mono"'],
};
