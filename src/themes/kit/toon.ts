// 그림체 키트: 그림체 사양(ToonSpec) 하나로 픽셀 규칙(stylize GLSL)을 만든다.
// 새 그림체(애니 · 웹툰 · 만화 · 동화 등)는 셰이더를 새로 짜지 않고 사양 값만 바꿔 테마로 조립한다.

export interface ToonSpec {
  /** 평탄화 반경(px). 색이 비슷한 이웃만 섞어 결을 지운다 */
  smooth: number;
  skinSmooth: number;
  /** 명암 단계: levels(밝기 값)는 edges(경계 luma)보다 하나 많다. 예: 애니 2~3단 */
  levels: number[];
  edges: number[];
  /** 단계 경계 폭(작을수록 칼같이 끊긴다) */
  crisp: number;
  /** 채도 배율 */
  saturation: number;
  /** 가장 어두운 단계에 그림자 색(슬롯 shadow)을 섞는 양 */
  shadowTint: number;
  line: {
    dog: number; // 어두운 골(눈·눈썹·입·옷 주름) 선 세기
    dogThreshold: number; // 주변보다 이만큼(비율) 어두우면 선
    sobel: number; // 강한 윤곽 선 세기
    skin: number; // 피부 위 선을 남기는 비율(0~1)
    hair: number; // 머리카락 위 선을 남기는 비율(0~1, 결 선이 지저분하면 낮춘다)
    outline: number; // 사람 외곽선 세기
  };
  skin: { flatten: number; warmth: number }; // 피부를 국소 평균으로 끌어당기는 양, 따뜻한 정도
  hair: { ring: number }; // 머리카락 천사의 링 세기
  sky: { clouds: boolean } | null; // 밝은 하늘을 그림 하늘로(null 이면 그대로)
  /** 팔레트 슬롯 배치 */
  slots: { shadow: number; ink: number; sky: number; hair: number };
}

const f = (n: number) => n.toFixed(4);

/** 테마 GLSL. 색 조합 params[0](uVar.x)는 머리 다시 칠하기 정도(1 팔레트 색, 0 원래 색). */
export function toonGlsl(s: ToonSpec): string {
  const bands = s.edges
    .map((e, i) => `  v = mix(v, ${f(s.levels[i + 1])}, smoothstep(${f(e - s.crisp)}, ${f(e + s.crisp)}, L));`)
    .join('\n');
  const SH = `uPal[${s.slots.shadow}]`;
  const INK = `uPal[${s.slots.ink}]`;
  const SKY = `uPal[${s.slots.sky}]`;
  const HAIR = `uPal[${s.slots.hair}]`;
  return `
vec3 kitFlat(Px p, float radius) {
  vec3 c = p.src;
  vec3 acc = c;
  float wsum = 1.0;
  for (int ring = 1; ring <= 2; ring++) {
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + float(ring) * 0.39;
      vec3 q = srcAt(p, vec2(cos(a), sin(a)) * radius * float(ring));
      float w = exp(-dot(q - c, q - c) * 25.0);
      acc += q * w;
      wsum += w;
    }
  }
  return acc / wsum;
}
vec3 kitBlur(Px p, float radius) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    acc += srcAt(p, vec2(cos(a), sin(a)) * radius);
  }
  return acc / 8.0;
}

// 명암을 단계로 끊고 채도를 올린다. 가장 어두운 단계에 그림자 색
vec3 kitPoster(vec3 c) {
  vec3 hsv = rgb2hsv(c);
  float L = luma(c);
  float v = ${f(s.levels[0])};
${bands}
  float shade = 1.0 - smoothstep(${f(s.edges[0] - s.crisp)}, ${f(s.edges[0] + s.crisp)}, L);
  vec3 col = hsv2rgb(vec3(hsv.x, min(1.0, hsv.y * ${f(s.saturation)}), v));
  return mix(col, col * (${SH} * 1.5 + 0.35), shade * ${f(s.shadowTint)});
}

// 선: 주변보다 어두운 골(DoG 근사) + 강한 윤곽
float kitLines(Px p) {
  float n = 0.25 * (luma(srcAt(p, vec2(1.0, 0.0))) + luma(srcAt(p, vec2(-1.0, 0.0)))
                  + luma(srcAt(p, vec2(0.0, 1.0))) + luma(srcAt(p, vec2(0.0, -1.0))));
  float g1 = (p.luma + n * 4.0) / 5.0;
  float g2 = luma(kitBlur(p, 3.5));
  float dog = (g1 - g2) / (g2 + 0.15);
  float l1 = 1.0 - smoothstep(-${f(s.line.dogThreshold)}, -${f(s.line.dogThreshold * 0.35)}, dog);
  float l2 = smoothstep(0.3, 0.6, length(p.grad));
  return clamp(max(l1 * ${f(s.line.dog)}, l2 * ${f(s.line.sobel)}), 0.0, 1.0);
}

// 천사의 링: 얼굴 위치(faceAt)로 머리 윗부분에 둥근 하이라이트 띠
float kitHairRing(Px p) {
  vec2 px = p.st * uSrcSize;
  float ring = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 fc = faceAt(i);
    if (fc.z <= 0.0) continue;
    vec2 up = vec2(sin(fc.w), -cos(fc.w));
    vec2 d = px - (fc.xy + up * fc.z * 0.12);
    float r = length(d) / fc.z;
    float band = 1.0 - smoothstep(0.0, 0.04, abs(r - 0.6));
    float upper = smoothstep(0.35, 0.65, dot(d / max(length(d), 1e-3), up));
    ring = max(ring, band * upper);
  }
  return ring;
}

void stylize(Px p, out vec3 color, out vec3 glow) {
  vec3 fl = kitFlat(p, ${f(s.smooth)});
  float lines = kitLines(p);
  vec3 bg = kitPoster(fl);
  float skyW = 0.0;
${
  s.sky
    ? `  skyW = smoothstep(0.55, 0.78, p.luma) * (1.0 - smoothstep(0.08, 0.3, p.hsv.y))
       * (1.0 - smoothstep(0.3, 0.7, p.st.y)) * (1.0 - smoothstep(0.2, 0.5, length(p.grad)));
  vec3 skyCol = mix(${SKY}, mix(${SKY}, vec3(1.0), 0.6), smoothstep(0.0, 0.65, p.st.y));
${
  s.sky.clouds
    ? `  float cn = fbm(p.st * vec2(2.5, 5.0) + vec2(p.time * 0.004, 0.0));
  float cloud = smoothstep(0.56, 0.6, cn);
  float cshade = smoothstep(0.6, 0.8, fbm(p.st * vec2(2.5, 5.0) + vec2(0.07, 0.05) + vec2(p.time * 0.004, 0.0)));
  skyCol = mix(skyCol, mix(vec3(1.0), mix(${SKY}, vec3(1.0), 0.55), cshade), cloud);`
    : ''
}
  bg = mix(bg, skyCol, skyW);`
    : ''
}
  color = bg;
  glow = vec3(0.0);
  float lineAmt = lines * (1.0 - skyW);

  if (p.person > 0.0) {
    vec4 cw = p.parts;
    float ws = max(cw.x + cw.y + cw.z + cw.w, 1e-4);
    // 피부: 매끈하게 펴고 국소 평균 대비로 빛/그림자 2단(사람마다 피부색은 그대로)
    vec3 sk = kitFlat(p, ${f(s.skinSmooth)});
    vec3 mean = kitBlur(p, ${f(s.skinSmooth * 2.5)});
    sk = mix(sk, mean, ${f(s.skin.flatten)});
    float lit = smoothstep(-0.02, 0.02, luma(sk) - luma(mean) * 0.94);
    vec3 skinLit = min(vec3(1.0), sk * 1.08 + vec3(0.05, 0.025, 0.0) * ${f(s.skin.warmth)});
    vec3 skinShade = sk * 0.84 * mix(vec3(1.0), ${SH} * 1.4 + 0.4, 0.35);
    vec3 skin = mix(skinShade, skinLit, lit);
    // 머리카락: 팔레트 색(또는 원래 색) 2단 + 천사의 링
    vec3 hairBase = mix(kitPoster(fl), ${HAIR}, p.vars.x);
    float hl = smoothstep(-0.02, 0.02, luma(sk) - luma(kitBlur(p, 10.0)) * 0.95);
    vec3 hair = mix(hairBase * mix(vec3(0.6), ${SH} * 1.3 + 0.2, 0.35), hairBase, hl);
    hair = mix(hair, mix(hairBase, vec3(1.0), 0.65), kitHairRing(p) * ${f(s.hair.ring)});
    vec3 cloth = kitPoster(fl);

    vec3 pc = (hair * cw.x + skin * (cw.y + cw.z) + cloth * cw.w) / ws;
    color = mix(bg, pc, p.person);
    lineAmt *= mix(1.0, ${f(s.line.skin)}, (cw.y + cw.z) / ws * p.person) * mix(1.0, ${f(s.line.hair)}, cw.x / ws * p.person);
    lineAmt = max(lineAmt, p.rim * ${f(s.line.outline)});
  }
  color = mix(color, ${INK}, lineAmt);
}
`;
}
