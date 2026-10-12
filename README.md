# NEON LENS

카메라를 켜면 화면이 실시간으로 사이버펑크가 되는 모바일 웹앱(PWA).
거리는 밤의 네온 도시로, 사람은 사이버펑크 캐릭터로 바뀌고, 얼굴 움직임을 따라 개조 부품이 붙는다.
모든 처리는 폰 안에서만 돈다(서버 없음, 사진 전송 없음).

## 무엇이 바뀌나

| 대상 | 처리 |
|---|---|
| 배경 | 밤 톤 3색 그레이딩, 윤곽선 네온(세로·가로 색 분리), 간판·차선 같은 원색은 발광, 밝은 하늘은 스모그 낀 밤하늘 |
| 사람 | 사람 분할(머리·몸 피부·얼굴 피부·옷)로 머리는 네온 그라데이션, 피부는 크롬, 옷은 테크웨어 + 회로 무늬, 윤곽 림라이트 |
| 얼굴 | 478점 얼굴 인식으로 바이저 · 사이버 눈 + 회로 · 호흡기 3종(MOD 버튼으로 순환), 얼굴 태그 HUD. 입을 크게 벌리면 글리치 오버드라이브 |
| 화면 | 블룸, 색수차, 비, 스캔라인, 그레인, 비네트, 간헐 글리치 |

필터 5종(NEON · VOLT · BLADE · ACID · GHOST)은 아래 칩이나 좌우 스와이프로 바꾼다. 셔터를 누르면 테두리와 시각 스탬프가 찍힌 사진이 나오고, 저장하거나 공유할 수 있다. 갤러리 버튼으로 기존 사진에도 적용할 수 있다.

## 실행

```bash
npm install
npm run dev        # http://localhost:7420 (모델·wasm 은 처음에 자동으로 받는다)
npm run build      # dist/ 정적 파일
npm run preview    # dist 를 7420 에서 서빙
```

폰 카메라는 **HTTPS 에서만** 열린다(`localhost` 예외). 폰으로 볼 때는 HTTPS 로 올린 주소(정적 호스팅이나 터널)로 연다.

## 구조

```
src/
  main.ts       화면·조작·렌더 루프, 카메라/사진 소스, 촬영·저장
  renderer.ts   WebGL2 다중 패스(스타일 → 1/4 해상도 블룸 → 합성)
  shaders.ts    GLSL: 그레이딩·윤곽·사람 처리(STYLE), 블룸(DOWN·BLUR), 후처리(COMPOSITE)
  vision.ts     MediaPipe 사람 분할(selfie_multiclass) + 얼굴 랜드마크, 카메라 VIDEO / 사진 IMAGE 모드
  overlay.ts    얼굴 개조 부품과 HUD 를 2D 캔버스에 그림(셰이더에서 빛으로도 더해짐)
  palettes.ts   필터별 5색
scripts/fetch-assets.mjs  MediaPipe wasm·모델을 public/ 으로 모음(git 에는 안 올림)
```

인식은 메인 스레드에서 돌고, 느린 기기에서는 인식 간격을 자동으로 벌려 화면이 멈추지 않게 한다. GPU 위임이 안 되면 CPU 로 내려간다.

## 사용 모델

- `selfie_multiclass_256x256` (MediaPipe Image Segmenter): 0 배경 · 1 머리 · 2 몸 피부 · 3 얼굴 피부 · 4 옷 · 5 액세서리
- `face_landmarker` (MediaPipe Face Landmarker): 478점 + 블렌드셰이프(`jawOpen`)
