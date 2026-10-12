// 테마 계약. 엔진(카메라·인식·렌더 파이프라인)은 그대로 두고, 이 모양만 채우면 새 세계관이 붙는다.

export type Pt = { x: number; y: number };

/** 엔진이 제공하는 인식. 테마는 필요한 것만 고른다(고른 모델만 내려받고 돌린다). */
export type Capability =
  | 'parts' // 사람 분할: 머리카락 · 몸 피부 · 얼굴 피부 · 옷
  | 'face' // 얼굴 478점 + 표정(블렌드셰이프 52종) + 고개 각도
  | 'pose'; // 몸 33점(어깨·손목·골반·발 등), 여러 명

/** 테마 안의 색 조합 하나(필터 칩 하나). colors 는 셰이더의 uPal[0..4] 로 들어간다. */
export interface ThemeVariant {
  id: string;
  name: string;
  colors: string[];
  /** 색 조합별 추가 값(최대 4개). 셰이더 uVar 로 가고 뜻은 테마가 정한다(예: 머리 다시 칠하기 0/1). */
  params?: number[];
}

/** 공용 후처리 세기. 0 이면 그 효과는 꺼진다. */
export interface PostFx {
  glow: number; // 선명한 발광을 더하는 양
  bloom: number; // 번지는 발광을 더하는 양
  chroma: number; // 색수차
  scanlines: number; // 스캔라인 진하기
  grain: number; // 필름 그레인
  vignette: number; // 비네트
  exposure: number; // 톤매핑 노출(0 이면 톤매핑 없이 그대로: 평평한 그림체용)
  overlayGlow: number; // 장식 레이어가 발광에도 더해지는 비율
}

/** 엔진이 계산해 주는 표정(0~1, 부드럽게 한 값). 셰이더에는 대표 얼굴의 smile·mouthOpen·surprise·wink 가 uExpr 로 간다. */
export type ExprName = 'smile' | 'mouthOpen' | 'surprise' | 'frown' | 'pucker' | 'blink' | 'wink' | 'cheekPuff';
export type Expressions = Record<ExprName, number>;
export const EXPR_NAMES: ExprName[] = ['smile', 'mouthOpen', 'surprise', 'frown', 'pucker', 'blink', 'wink', 'cheekPuff'];

export interface EyeView {
  center: Pt;
  iris: Pt;
  radius: number; // 눈 폭의 절반(px)
  blink: number; // 감은 정도 0~1
}

/** 얼굴 하나를 화면 픽셀 좌표로 본 것. 전면 카메라 거울 처리는 엔진이 끝내서 넘긴다. */
export interface FaceView {
  index: number;
  count: number; // 랜드마크 수(478)
  pt(i: number): Pt; // MediaPipe 얼굴 랜드마크 번호 i 의 위치
  width: number; // 얼굴 폭(px), 장식 크기 기준
  center: Pt; // 두 눈 사이
  roll: number; // 화면에서 고개 기울기(rad)
  yaw: number; // -1 화면 왼쪽을 봄 ~ 1 오른쪽을 봄(대략)
  pitch: number; // -1 위를 봄 ~ 1 아래를 봄(대략)
  eyes: [EyeView, EyeView]; // 화면 왼쪽 눈, 오른쪽 눈
  expr: Expressions;
  /** 그 표정이 켜진 뒤 흐른 초. 꺼져 있으면 -1. 한 번 터지는 효과(윙크 별, 놀람 링)에 쓴다. */
  since(name: ExprName): number;
  /** MediaPipe 블렌드셰이프 원값(eyeBlinkLeft, mouthSmileRight 등 52종) */
  blend(name: string): number;
}

/** 몸 하나(포즈 33점). 0 코 · 11/12 어깨 · 13/14 팔꿈치 · 15/16 손목 · 23/24 골반 · 27/28 발목 */
export interface BodyView {
  index: number;
  pt(i: number): Pt;
  vis(i: number): number; // 보일 확률 0~1
  scale: number; // 어깨 폭(px)
}

/** 장식을 그릴 때 엔진이 넘기는 것 */
export interface DecorCtx {
  ctx: CanvasRenderingContext2D; // 앞 레이어(사람 위)
  back: CanvasRenderingContext2D; // 뒤 레이어(사람 뒤, 테마 backLayer 가 true 일 때만 합성)
  w: number;
  h: number;
  time: number;
  hud: boolean; // 사용자가 HUD 를 켰는지
  mod: number; // 얼굴 장식 순번(MOD 버튼)
  variant: ThemeVariant;
  color(slot: number, alpha?: number): string; // 현재 색 조합의 slot 번째 색(css)
  faces: FaceView[]; // 이번 프레임의 모든 얼굴(다른 얼굴·몸을 보고 그릴 때)
  bodies: BodyView[];
}

/** 화면 입자 효과(토글 버튼 하나) */
export interface Particles {
  kind: 'rain' | 'sparkle' | 'petal';
  label: string; // 토글 버튼 글자
  colorSlot: number;
  color?: string; // 색 조합과 상관없이 고정할 색(예: 벚꽃잎)
}

export interface Theme {
  id: string;
  name: string;
  variants: ThemeVariant[];
  needs: Capability[];
  /**
   * GLSL. `void stylize(Px p, out vec3 color, out vec3 glow)` 를 정의한다.
   * color 는 화면에 칠할 색, glow 는 빛나는 성분(블룸을 받는다). Px 와 공용 함수는 engine/shaders.ts.
   */
  glsl: string;
  post: PostFx;
  /** 지원하는 화면 효과. 없는 효과는 토글이 숨는다. */
  effects: { particles?: Particles; glitch?: boolean };
  /** 얼굴 변형(캐릭터 비율). eyes 눈 키우기 0~0.4, slim 턱 갸름 0~0.25. FaceView.pt() 는 변형 뒤 위치를 준다 */
  warp?: { eyes?: number; slim?: number };
  /** 얼굴 장식 종류 수(MOD 버튼이 순환하는 수). 2 미만이면 버튼을 숨긴다. */
  faceMods: number;
  /** 뒤 레이어(날개·후광처럼 사람 뒤에 그릴 것)를 쓰는지 */
  backLayer?: boolean;
  decorateFace?(d: DecorCtx, face: FaceView): void;
  decorateBody?(d: DecorCtx, body: BodyView): void;
  /** 저장되는 사진에만 찍는 테두리·스탬프 */
  stamp?(d: DecorCtx): void;
  /** 캔버스 글자에 쓰는 웹폰트(미리 불러 둔다) */
  fonts?: string[];
  /** 그 글꼴로 쓰는 글자(한·일 글꼴은 글자 범위별로 나뉘어 있어 미리 받을 글자를 알려 준다) */
  fontText?: string;
}

export const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
