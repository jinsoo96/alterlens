import { toonGlsl, type ToonSpec } from '../kit/toon';
import type { Theme } from '../types';
import { stamp } from './decor';

// 애니 풍경: 찍은 장면을 그대로 두고 애니 영화 배경 미술처럼 칠한다. 부드러운 셀 명암 · 깔끔한 윤곽 ·
// 밝은 하늘은 구름 낀 그림 하늘로. 사람은 실제 머리색·얼굴 그대로(머리 다시 칠하기·눈 키우기·장식 없음).
const SPEC: ToonSpec = {
  smooth: 3,
  skinSmooth: 5,
  levels: [0.34, 0.7, 0.97],
  edges: [0.3, 0.62],
  crisp: 0.04,
  saturation: 1.3,
  shadowTint: 0.45,
  // 얼굴 선은 실제 이목구비를 남길 만큼 둔다(skin 0.35)
  line: { dog: 0.8, dogThreshold: 0.08, sobel: 0.7, skin: 0.35, hair: 0.3, outline: 0.7 },
  skin: { flatten: 0.5, warmth: 0.8 },
  hair: { ring: 0 },
  sky: { clouds: true },
  slots: { shadow: 0, ink: 1, sky: 3, hair: 4 },
};

export const anime: Theme = {
  id: 'anime',
  name: 'ANIME',
  // 색 조합 = 시간대. 슬롯: 0 그림자 · 1 먹선 · 2 빛 포인트 · 3 하늘 · 4 머리카락(쓰지 않음). params[0] 0 = 머리 원래 색
  variants: [
    { id: 'day', name: 'DAY', colors: ['#56689e', '#22263a', '#ffb347', '#2f7fe0', '#3a2a24'], params: [0] },
    { id: 'sunset', name: 'SUNSET', colors: ['#7a5a8a', '#2e2230', '#ff8a3d', '#ff8f6b', '#3a2a24'], params: [0] },
    { id: 'night', name: 'NIGHT', colors: ['#2c3260', '#14162a', '#ffd27a', '#1d2a5e', '#3a2a24'], params: [0] },
  ],
  needs: ['parts', 'face'],
  glsl: toonGlsl(SPEC),
  post: { glow: 0.25, bloom: 0.45, chroma: 0, scanlines: 0, grain: 0, vignette: 0.1, exposure: 0, overlayGlow: 0 },
  effects: { particles: { kind: 'petal', label: 'SAKURA', colorSlot: 2, color: '#ffc4d8' } },
  faceMods: 0,
  stamp,
  fonts: ['800 20px "M PLUS Rounded 1c"'],
  fontText: 'ALTERLENS·ANIME DAYSUNSETNIGHT',
};
