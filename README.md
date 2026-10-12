# ALTERLENS

카메라에 비친 거리와 사람을 실시간으로 다른 세계관으로 바꿔 보는 모바일 웹앱(PWA).
세계관은 **테마**로 갈아 끼운다. 지금 들어 있는 테마는 사이버펑크 하나다.
모든 처리는 폰 안에서만 돈다(서버 없음, 사진 전송 없음).

## 어떻게 바뀌나

사진을 새로 그리는 생성형이 아니라 **실시간 변환**이다. 원본의 구도와 형태는 그대로 두고, AI 인식으로 영역을 나눈 뒤 영역마다 색·빛·재질을 바꾸고 장식을 얹는다.

1. **인식**: 사람 분할(머리 · 몸 피부 · 얼굴 피부 · 옷)과 얼굴 478점을 프레임마다 구한다.
2. **픽셀 규칙**: 테마 셰이더가 원본색 · 윤곽 · 사람 부위를 받아 칠할 색과 빛나는 성분을 낸다.
3. **장식**: 테마가 얼굴 점을 따라 부품 · HUD 를 그린다(얼굴이 움직이면 따라간다).
4. **후처리**: 블룸 · 색수차 · 비 · 스캔라인 · 그레인 · 비네트. 세기는 테마가 정한다.

사이버펑크 테마 기준으로는 거리는 밤의 네온 도시(윤곽 네온, 간판·차선 발광, 낮 하늘 → 스모그 밤하늘), 사람은 네온 머리 · 크롬 피부 · 테크웨어 옷 + 림라이트, 얼굴에는 바이저 · 사이버 눈 · 호흡기(MOD 버튼으로 순환)가 붙는다. 입을 크게 벌리면 글리치가 터진다. 색 조합 5종(NEON · VOLT · BLADE · ACID · GHOST)은 칩이나 좌우 스와이프로 바꾼다.

## 실행

```bash
npm install
npm run dev        # http://localhost:7420 (모델·wasm 은 처음에 자동으로 받는다)
npm run build      # dist/ 정적 파일
npm run preview    # dist 를 7420 에서 서빙
```

폰 카메라는 **HTTPS 에서만** 열린다(`localhost` 예외). 폰으로 볼 때는 HTTPS 로 올린 주소로 연다.

## 구조

```
src/
  main.ts                 화면·조작·렌더 루프, 카메라/사진 소스, 테마 전환, 촬영·저장
  engine/                 테마와 무관한 엔진
    renderer.ts           WebGL2 다중 패스(스타일 → 1/4 해상도 블룸 → 합성), 테마 셰이더 컴파일
    shaders.ts            Px(픽셀 입력) 만들기 · 블룸 · 후처리
    vision.ts             MediaPipe 사람 분할 + 얼굴 랜드마크(카메라 VIDEO / 사진 IMAGE)
    overlay.ts            장식 캔버스(얼굴 좌표·거울 처리 후 테마에 넘김)
  themes/
    types.ts              테마 계약(Theme · ThemeVariant · PostFx · DecorCtx · FaceView)
    index.ts              테마 목록
    cyberpunk/            사이버펑크 테마(index 설정 · style 셰이더 · decor 얼굴 부품·스탬프)
scripts/fetch-assets.mjs  MediaPipe wasm·모델을 public/ 으로 모음(git 에는 안 올림)
```

## 새 테마 추가

`src/themes/<이름>/index.ts` 에 `Theme` 을 만들고 `src/themes/index.ts` 목록에 넣으면 화면 아래에 테마 줄이 생긴다(테마가 둘 이상일 때만 보임). 채울 것은 다섯 가지다.

| 항목 | 내용 |
|---|---|
| `variants` | 색 조합(필터 칩). 색 최대 5개가 셰이더 `uPal[0..4]` 로 들어간다 |
| `glsl` | `void stylize(Px p, out vec3 color, out vec3 glow)`. `p` 에 원본색(`src`·`luma`·`hsv`), 윤곽 기울기(`grad`), 사람 부위(`parts`·`person`·`rim`), `time` 이 들어 있다 |
| `post` | 후처리 세기(0 이면 끔) |
| `effects` | 비 · 글리치 지원 여부(없으면 토글이 숨는다) |
| `decorateFace` · `stamp` · `faceMods` | 얼굴 장식, 저장 사진 테두리, MOD 순환 수(선택) |

가장 작은 테마는 `stylize` 한 함수와 색 조합 하나로 된다.

## 사용 모델

- `selfie_multiclass_256x256` (MediaPipe Image Segmenter): 0 배경 · 1 머리 · 2 몸 피부 · 3 얼굴 피부 · 4 옷 · 5 액세서리
- `face_landmarker` (MediaPipe Face Landmarker): 478점 + 블렌드셰이프(`jawOpen`)
