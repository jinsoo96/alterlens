import { toonGlsl, type ToonSpec } from '../kit/toon';
import type { Theme } from '../types';
import { decorateFace, stamp } from './decor';

// 일본 애니 그림체: 깔끔한 선 · 2~3단 셀 명암 · 선명한 머리색과 천사의 링 · 큰 눈 · 만화 기호
const SPEC: ToonSpec = {
  smooth: 3,
  skinSmooth: 6,
  levels: [0.3, 0.68, 0.95],
  edges: [0.28, 0.6],
  crisp: 0.025,
  saturation: 1.45,
  shadowTint: 0.55,
  // 얼굴 위 선은 거의 지우고(skin 0.12) 눈·눈썹·코·입은 장식에서 랜드마크로 그린다
  line: { dog: 0.95, dogThreshold: 0.08, sobel: 0.6, skin: 0.12, hair: 0.3, outline: 0.9 },
  skin: { flatten: 0.75, warmth: 1 },
  hair: { ring: 0.85 },
  sky: { clouds: true },
  slots: { shadow: 0, ink: 1, sky: 3, hair: 4 },
};

export const anime: Theme = {
  id: 'anime',
  name: 'ANIME',
  // 색 슬롯: 0 그림자 · 1 먹선 · 2 눈동자·포인트 · 3 하늘 · 4 머리카락. params[0]: 머리 다시 칠하기(1 팔레트 색, 0 원래 색)
  variants: [
    { id: 'aqua', name: 'AQUA', colors: ['#6f6aa8', '#262236', '#1fb0b0', '#3d9bff', '#3ccfc8'], params: [1] },
    { id: 'sakura', name: 'SAKURA', colors: ['#9a6aa0', '#33222e', '#e0507f', '#7cbcff', '#ff9ec4'], params: [1] },
    { id: 'lemon', name: 'LEMON', colors: ['#8a78a0', '#2f2626', '#e08a10', '#4aa8ff', '#ffd54a'], params: [1] },
    { id: 'violet', name: 'VIOLET', colors: ['#5f58a0', '#221d36', '#7d5cff', '#6a9cff', '#a88cff'], params: [1] },
    { id: 'natural', name: 'NATURAL', colors: ['#77688f', '#2a2230', '#7a4a32', '#5aa6ff', '#3a2a24'], params: [0] },
  ],
  needs: ['parts', 'face'],
  glsl: toonGlsl(SPEC),
  post: { glow: 0.3, bloom: 0.4, chroma: 0, scanlines: 0, grain: 0, vignette: 0.12, exposure: 0, overlayGlow: 0.1 },
  effects: { particles: { kind: 'petal', label: 'SAKURA', colorSlot: 2, color: '#ffc4d8' } },
  warp: { eyes: 0.3, slim: 0.12 },
  faceMods: 3,
  decorateFace,
  stamp,
  fonts: ['800 20px "M PLUS Rounded 1c"'],
  fontText: 'パチッ☆えっ!?ムちゅにこ♪♡ALTERLENS·',
};
