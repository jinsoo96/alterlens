# ALTERLENS

카메라에 비친 거리와 사람을 실시간으로 다른 세계관으로 바꿔 보는 모바일 웹앱(PWA).
**세계관은 테마로 갈아 끼운다.** 이 레포는 그 틀(인식 엔진 + 렌더 파이프라인 + 테마 계약)이고, 들어 있는 테마는 둘이다.

| 테마 | 결과 |
|---|---|
| CYBERPUNK | 밤의 네온 도시, 크롬 피부 · 테크웨어, 얼굴에 바이저 · 사이버 눈 · 호흡기, 비 · 글리치 |
| ANIME | 일본 애니 그림체: 깔끔한 선 · 2~3단 셀 명암 · 선명한 머리색과 천사의 링 · 큰 눈(아이라인·하이라이트) · 볼 빗금 · 리본/고양이귀/머리핀, 표정에 반응하는 만화 기호와 말풍선(にこっ♪ · パチッ☆ · えっ!? · ムッ · ちゅっ♡), 벚꽃잎 |

모든 처리는 폰 안에서만 돈다(서버 없음, 사진 전송 없음).

## 어떻게 바뀌나

사진을 새로 그리는 생성형이 아니라 **실시간 변환**이다. 원본 구도는 그대로 두고, AI 인식으로 사람·부위·얼굴·표정·몸을 잡은 뒤 테마 규칙으로 칠하고 장식을 얹는다.

```
카메라/사진 ─▶ 인식(테마가 고른 것만) ─▶ 장면(얼굴·표정·몸 뷰) ─▶ 렌더
               parts  사람 분할(머리·피부·옷)            │          ├ 픽셀 규칙(테마 GLSL stylize)
               face   얼굴 478점 + 블렌드셰이프 52종      │          ├ 얼굴 변형(눈 확대·턱 갸름)
               pose   몸 33점, 여러 명                    │          ├ 뒤 장식(사람 뒤: 날개·후광)
                                                          │          ├ 앞 장식(얼굴 부품·HUD)
                                                          ▼          └ 후처리(블룸·입자·글리치·톤)
                                        표정 8종 + 켜진 시각, 고개 각도, 눈 감김
```

## 폰에서 쓰기

- **앱 안 카메라**: 카메라 시작 → 실시간 변환 → 셔터로 저장·공유.
- **폰 기본 카메라 앱으로 찍기**: 카메라 아이콘(또는 첫 화면 "폰 카메라로 찍기")을 누르면 폰의 기본 카메라 앱이 열리고, 찍은 사진이 돌아와 테마가 입혀진다.
- **공유로 받기**(안드로이드, 홈 화면에 설치했을 때): 갤러리·카메라 앱에서 사진 공유 → ALTERLENS.
- **갤러리 사진**: 사진 아이콘.
- 카메라는 **HTTPS 에서만** 열린다(`localhost` 예외).

## 실행

```bash
npm install
npm run dev        # http://localhost:7420 (모델·wasm 은 처음에 자동으로 받는다)
npm run build      # dist/ 정적 파일
npm run preview    # dist 를 7420 에서 서빙
```

`?debug` 를 붙이면 인식 상태(얼굴·몸 수, 표정 8종 값, 고개 각도, 인식 시간)가 화면에 뜬다. `?debug&force=wink,smile` 처럼 표정을 강제로 켜서 테마의 표정 반응을 얼굴 없이 볼 수 있다.

## 구조

```
src/
  main.ts                 화면·조작·렌더 루프, 소스(카메라·사진·폰 카메라·공유), 테마 전환, 촬영
  engine/                 테마와 무관한 틀
    vision.ts             인식(parts · face · pose). 테마가 고른 모델만 내려받아 만든다
    scene.ts              인식 결과 → FaceView(표정·고개·눈) · BodyView, 얼굴 변형 값
    overlay.ts            장식 캔버스 두 장(앞 · 뒤)
    renderer.ts           WebGL2 다중 패스, 테마 셰이더 컴파일
    shaders.ts            Px(픽셀 입력) · 얼굴 변형 · 뒤/앞 장식 합성 · 블룸 · 후처리
  themes/
    types.ts              테마 계약
    index.ts              테마 목록
    kit/toon.ts           그림체 키트: ToonSpec(선·명암 단계·채도·피부·머리·하늘) → 픽셀 규칙
    cyberpunk/ · anime/   테마(index 설정 · 셰이더 또는 ToonSpec · decor 장식)
public/sw.js              공유 받기(share_target) + 모델 캐시
scripts/fetch-assets.mjs  MediaPipe wasm·모델을 public/ 으로 모음(git 에는 안 올림)
```

## 새 테마 추가

`src/themes/<이름>/index.ts` 에 `Theme` 을 만들고 `src/themes/index.ts` 목록에 넣으면 화면 아래 테마 줄에 나온다.

**그림체 테마는 셰이더를 짜지 않는다.** `kit/toon.ts` 의 `ToonSpec` 을 채우고 `glsl: toonGlsl(spec)` 로 둔다(`themes/anime` 참고). 사양은 선(어두운 골 · 윤곽 · 피부/머리카락 위 선 비율 · 사람 외곽선), 명암 단계와 경계, 채도, 그림자 색, 피부 평탄화, 머리카락 천사의 링, 하늘 처리다. 같은 키트로 웹툰 · 만화 · 동화 같은 다른 그림체를 값만 바꿔 만든다. 눈·눈썹·코·입처럼 그림체를 결정하는 얼굴 부위는 `decorateFace` 에서 랜드마크로 그린다(얼굴 변형 뒤 위치가 `pt()` 로 온다).

| 항목 | 내용 |
|---|---|
| `needs` | 쓸 인식: `parts` · `face` · `pose` 중 고른다(고른 것만 받고 돌린다) |
| `variants` | 색 조합(필터 칩). 색 최대 5개가 셰이더 `uPal[0..4]`, `params` 최대 4개가 `uVar` 로 들어간다 |
| `glsl` | `void stylize(Px p, out vec3 color, out vec3 glow)`. `p` 에 원본색(`src`·`luma`·`hsv`), 윤곽(`grad`), 사람 부위(`parts`·`person`·`rim`), 대표 표정(`expr`), 색 조합 값(`vars`), `time`. 이웃은 `srcAt(p, 픽셀오프셋)`, 얼굴 위치는 `faceAt(i)` |
| `post` | 후처리 세기(0 이면 끔) |
| `effects` | 입자(`rain` · `sparkle` · `petal`) · 글리치. 없으면 토글이 숨는다 |
| `warp` | 얼굴 변형: `eyes`(눈 확대) · `slim`(턱 갸름) |
| `decorateFace` | 얼굴마다 호출. `FaceView` 에 랜드마크 `pt(i)`, `expr`(표정 8종), `since(표정)`(켜진 뒤 초), `blend(이름)`(블렌드셰이프 원값), `roll`·`yaw`·`pitch`, `eyes`(눈 위치·감김) |
| `decorateBody` | 몸마다 호출. `BodyView` 에 포즈 33점 `pt(i)` · `vis(i)` · `scale` |
| `backLayer` | true 면 `d.back` 에 그린 것은 사람 뒤로 간다(날개·후광) |
| `faceMods` · `stamp` · `fonts` | 얼굴 장식 순환 수(MOD), 저장 사진 테두리, 캔버스 글꼴 |

표정 8종: `smile` · `mouthOpen` · `surprise` · `frown` · `pucker` · `blink` · `wink` · `cheekPuff`. 값은 0~1 로 부드럽게 한 것이고, 켜짐/꺼짐은 문턱 두 개(히스테리시스)라 깜빡이지 않는다. 가장 작은 테마는 `stylize` 한 함수와 색 조합 하나로 된다.

## 테마 변환 서버 (`server/`)

실시간 화면은 폰에서, "찍은 사진을 그 테마의 진짜 그림으로"는 생성 공급자가 한다. 지금 운영 경로는 **Ailism**(협업 서버, https://ailism.memo-ora.com) 앱 API 를 거쳐 Higgsfield 로 그리는 것이고, 이 서버는 Ailism 에 붙일 기능(테마 레시피 · 장면 정보 · 채팅 다듬기 · 테마 스튜디오)을 먼저 만들어 보는 곳이다. 공급자 키·그림체 문장은 서버에만 있다.

```
node server/index.mjs                              # dist 서빙 + API (기본 127.0.0.1:7420, 공급자 ailism)
AI_PROVIDER=mock STUDIO_TOKEN=… node server/index.mjs  # 키 없이 전체 흐름 시험
node server/cli.mjs list | on <id> | off <id>
```

- **테마 = 레시피**: `server/themes/<id>.json` 에 `style`(그림체 문장) · `variants`(색 조합별 문장) · `live`(실시간 룩) · `refs`(스튜디오에서 고른 기준 그림) · `enabled`(꼈다 켰다).
- **테마 적용**: 앱이 찍은 사진과 함께 촬영 순간 엔진이 본 **장면 정보**(인원 · 얼굴 위치 · 켜진 표정 · 쓴 장식 · 색 조합)를 보낸다. 서버가 그림체 문장 + 색 조합 + 장면 문장으로 지시문을 만든다(`server/recipe.mjs`, Ailism 한도 500자에 맞춰 장식 → 표정 순으로 줄인다). 참고 그림을 받는 공급자면 기준 그림도 같이 넘긴다.
- **채팅 다듬기**: 결과를 보고 "머리를 길게"처럼 치면 현재 그림을 이어서 고친다. 단계(원본 → 테마 → 채팅…)가 남아 언제든 이전 단계로 돌아간다.
- **테마 스튜디오** `/studio`(토큰 `STUDIO_TOKEN`): 그림체 문장을 쓰고 → 예시 사진으로 후보를 그려 보고 → 기준 그림을 고르고 → 켠다. 앱 업데이트 없이 테마가 늘고 준다.
- 공급자: `ailism`(기본, 사진 1장 + 지시문 500자) · `higgsfield`(REST 키, 참고 그림 여러 장) · `mock`.
- API: `GET /api/v1/themes` · `POST /api/v1/transforms`(multipart `image` · `themeId` · `variant` · `scene` · `w` · `h`) · `GET /api/v1/transforms/:id` · `POST …/:id/chat` `{text}` · `POST …/:id/current` `{step}` · 스튜디오 `/api/studio/*`.
- 한도: IP 당 시간 `AI_PER_IP_HOUR`(6), 하루 `AI_DAILY`(30), 동시 `AI_CONCURRENCY`(2). 키·토큰은 `server/.env.local`(git 에 안 올라감).

## 사용 모델

- `selfie_multiclass_256x256` (Image Segmenter): 0 배경 · 1 머리 · 2 몸 피부 · 3 얼굴 피부 · 4 옷 · 5 액세서리
- `face_landmarker` (Face Landmarker): 478점 + 블렌드셰이프 52종
- `pose_landmarker_lite` (Pose Landmarker): 33점, 최대 3명

## 배포

`main` 에 push 하면 GitHub Actions 가 빌드해 GitHub Pages 에 올린다(`.github/workflows/pages.yml`).
