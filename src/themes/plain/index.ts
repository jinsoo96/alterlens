import type { Theme } from '../types';

// 원본 그대로 보여 주는 실시간 룩. 실시간 효과가 없는 서버 테마(예: 피규어)가 빌려 쓴다. 테마 줄에는 안 나온다.
// 얼굴 인식은 켜 둔다: 촬영 순간의 장면 정보(인원·표정)를 서버 변환에 넘기기 위해.
export const plain: Theme = {
  id: 'plain',
  name: 'PLAIN',
  hidden: true,
  variants: [{ id: 'original', name: 'ORIGINAL', colors: ['#000000', '#000000', '#ffffff', '#ffffff', '#ffffff'] }],
  needs: ['face'],
  glsl: `
void stylize(Px p, out vec3 color, out vec3 glow) {
  color = p.src;
  glow = vec3(0.0);
}`,
  post: { glow: 0, bloom: 0, chroma: 0, scanlines: 0, grain: 0, vignette: 0, exposure: 0, overlayGlow: 0 },
  effects: {},
  faceMods: 0,
};
