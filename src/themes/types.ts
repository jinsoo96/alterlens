// 테마 계약. 엔진(카메라·인식·렌더 파이프라인)은 그대로 두고, 이 모양만 채우면 새 세계관이 붙는다.

export type Pt = { x: number; y: number };

/** 테마 안의 색 조합 하나(필터 칩 하나). colors 는 셰이더의 uPal[0..4] 로 들어간다. */
export interface ThemeVariant {
  id: string;
  name: string;
  colors: string[];
}

/** 공용 후처리 세기. 0 이면 그 효과는 꺼진다. */
export interface PostFx {
  glow: number; // 선명한 발광을 더하는 양
  bloom: number; // 번지는 발광을 더하는 양
  chroma: number; // 색수차
  scanlines: number; // 스캔라인 진하기
  grain: number; // 필름 그레인
  vignette: number; // 비네트
  exposure: number; // 톤매핑 노출
  overlayGlow: number; // 장식 레이어가 발광에도 더해지는 비율
}

/** 얼굴 하나를 화면 픽셀 좌표로 본 것. 전면 카메라 거울 처리는 엔진이 끝내서 넘긴다. */
export interface FaceView {
  index: number;
  count: number; // 랜드마크 수(478)
  pt(i: number): Pt; // MediaPipe 얼굴 랜드마크 번호 i 의 위치
  width: number; // 얼굴 폭(px), 장식 크기 기준
  jawOpen: number; // 입 벌림 0~1
}

/** 장식을 그릴 때 엔진이 넘기는 것 */
export interface DecorCtx {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  time: number;
  hud: boolean; // 사용자가 HUD 를 켰는지
  mod: number; // 얼굴 장식 순번(MOD 버튼)
  variant: ThemeVariant;
  color(slot: number, alpha?: number): string; // 현재 색 조합의 slot 번째 색(css)
}

export interface Theme {
  id: string;
  name: string;
  variants: ThemeVariant[];
  /**
   * GLSL. `void stylize(Px p, out vec3 color, out vec3 glow)` 를 정의한다.
   * color 는 화면에 칠할 색, glow 는 빛나는 성분(블룸을 받는다). Px 와 공용 함수는 engine/shaders.ts.
   */
  glsl: string;
  post: PostFx;
  /** 지원하는 화면 효과. 없는 효과는 토글 버튼이 숨는다. */
  effects: { rain?: { colorSlot: number }; glitch?: boolean };
  /** 얼굴 장식 종류 수(MOD 버튼이 순환하는 수). 2 미만이면 버튼을 숨긴다. */
  faceMods: number;
  decorateFace?(d: DecorCtx, face: FaceView): void;
  /** 저장되는 사진에만 찍는 테두리·스탬프 */
  stamp?(d: DecorCtx): void;
  /** 캔버스 글자에 쓰는 웹폰트(미리 불러 둔다) */
  fonts?: string[];
}

export const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
