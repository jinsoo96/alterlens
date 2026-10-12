// 전 패스 공용: 버퍼 없이 gl_VertexID 로 화면 전체를 덮는 삼각형 하나.
export const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

// 1패스: 원본 → 사이버펑크 색(oColor) + 빛나는 성분(oGlow).
// 마스크 클래스(selfie_multiclass): 0 배경 1 머리카락 2 몸 피부 3 얼굴 피부 4 옷 5 액세서리
export const STYLE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uMask;
uniform sampler2D uOverlay;
uniform vec2 uTexel;
uniform vec2 uMaskStep;
uniform float uHasMask;
uniform float uMirror;
uniform float uTime;
uniform vec3 uShadow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uNeonA;
uniform vec3 uNeonB;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oGlow;
${COMMON}
vec3 tritone(float l) {
  return l < 0.5 ? mix(uShadow, uMid, l * 2.0) : mix(uMid, uHigh, (l - 0.5) * 2.0);
}
float cls(vec2 p) { return floor(texture(uMask, p).r * 255.0 + 0.5); }
// 3x3 이웃의 클래스 비율로 경계를 부드럽게: x 머리 y 몸피부 z 얼굴피부 w 옷·액세서리
vec4 classWeights(vec2 p) {
  vec4 w = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float c = cls(p + vec2(float(i), float(j)) * uMaskStep);
      w += vec4(float(c == 1.0), float(c == 2.0), float(c == 3.0), float(c >= 4.0));
    }
  }
  return w / 9.0;
}
float personAt(vec2 p) { return step(0.5, cls(p)); }

void main() {
  vec2 st = vec2(vUv.x, 1.0 - vUv.y);
  vec2 sv = vec2(mix(st.x, 1.0 - st.x, uMirror), st.y);
  vec3 src = texture(uSrc, sv).rgb;
  float L = luma(src);
  vec3 hsv = rgb2hsv(src);

  // 소벨 윤곽: 세로 윤곽은 네온A, 가로 윤곽은 네온B
  vec2 o = uTexel * 1.5;
  float a00 = luma(texture(uSrc, sv + vec2(-o.x, -o.y)).rgb);
  float a01 = luma(texture(uSrc, sv + vec2(-o.x, 0.0)).rgb);
  float a02 = luma(texture(uSrc, sv + vec2(-o.x, o.y)).rgb);
  float a10 = luma(texture(uSrc, sv + vec2(0.0, -o.y)).rgb);
  float a12 = luma(texture(uSrc, sv + vec2(0.0, o.y)).rgb);
  float a20 = luma(texture(uSrc, sv + vec2(o.x, -o.y)).rgb);
  float a21 = luma(texture(uSrc, sv + vec2(o.x, 0.0)).rgb);
  float a22 = luma(texture(uSrc, sv + vec2(o.x, o.y)).rgb);
  float gx = (a20 + 2.0 * a21 + a22) - (a00 + 2.0 * a01 + a02);
  float gy = (a02 + 2.0 * a12 + a22) - (a00 + 2.0 * a10 + a20);
  float edge = smoothstep(0.16, 0.55, length(vec2(gx, gy)));
  vec3 edgeCol = mix(uNeonB, uNeonA, abs(gx) / (abs(gx) + abs(gy) + 1e-4));

  // 배경: 밤 톤으로 내리고, 원래 채도 높은 간판·차선은 네온으로 살린다
  vec3 bg = tritone(pow(L, 1.75) * 0.9);
  bg = mix(bg, src * vec3(0.45, 0.5, 0.75), 0.15);
  float sat = smoothstep(0.28, 0.6, hsv.y) * smoothstep(0.2, 0.5, hsv.z);
  vec3 vivid = hsv2rgb(vec3(hsv.x, min(1.0, hsv.y * 1.3 + 0.15), 1.0));
  bg = mix(bg, vivid * (0.45 + 0.7 * hsv.z), sat * 0.85);

  // 밝고 무채색인 위쪽 = 하늘 → 스모그 낀 밤하늘
  float skyW = smoothstep(0.58, 0.8, L) * (1.0 - smoothstep(0.06, 0.22, hsv.y))
             * (1.0 - smoothstep(0.3, 0.7, st.y)) * (1.0 - edge);
  float haze = fbm(st * vec2(3.0, 7.0) + vec2(uTime * 0.015, 0.0));
  vec3 skyCol = mix(uShadow * 0.5, uNeonB * 0.55, smoothstep(0.0, 0.65, st.y)) + uNeonA * haze * 0.12;
  bg = mix(bg, skyCol, skyW);

  vec3 bgGlow = edgeCol * edge * (1.0 - skyW) * 0.8
              + vivid * sat * 0.6
              + uHigh * smoothstep(0.82, 0.98, L) * (1.0 - skyW) * 0.3;

  vec3 color = bg;
  vec3 glow = bgGlow;

  if (uHasMask > 0.5) {
    vec4 cw = classWeights(sv);
    float person = clamp(cw.x + cw.y + cw.z + cw.w, 0.0, 1.0);
    if (person > 0.0) {
      // 머리카락: 팔레트 두 네온 사이를 흐르는 그라데이션
      vec3 hairCol = mix(uNeonB, uNeonA, 0.5 + 0.5 * sin(st.y * 9.0 - uTime * 1.5)) * (0.35 + 1.2 * L);
      // 얼굴: 차가운 피부톤, 알아볼 수 있게 원본 디테일 유지
      vec3 faceCol = mix(src, vec3(L * 1.08) * mix(vec3(1.0), uNeonA, 0.22), 0.55);
      // 몸 피부: 크롬 의수 느낌의 줄무늬 반사
      float band = 0.5 + 0.5 * cos(L * 14.0 + st.y * 5.0 - uTime * 0.6);
      vec3 chrome = mix(uShadow * 0.8, mix(vec3(0.9, 0.97, 1.0), uNeonA, 0.3), band) * (0.6 + 0.6 * L);
      vec3 skinCol = mix(src, chrome, 0.6);
      // 옷: 검은 테크웨어 + 회로 무늬
      vec2 cg = st / uTexel / 22.0;
      vec2 cell = floor(cg), f = fract(cg);
      float r = hash(cell);
      float trace = r < 0.5 ? 1.0 - smoothstep(0.0, 0.07, abs(f.y - 0.5)) : 1.0 - smoothstep(0.0, 0.07, abs(f.x - 0.5));
      trace *= step(0.6, hash(cell + 7.0)) * (0.5 + 0.5 * sin(uTime * 2.5 + r * 6.283));
      vec3 clothCol = vec3(L * 0.42) * mix(vec3(1.0), uShadow * 2.5 + 0.2, 0.45);
      vec3 clothGlow = uNeonB * edge * 1.2 + uNeonA * trace * 0.35;

      float ws = max(cw.x + cw.y + cw.z + cw.w, 1e-4);
      vec3 pc = (hairCol * cw.x + skinCol * cw.y + faceCol * cw.z + clothCol * cw.w) / ws;
      vec3 pg = (hairCol * 0.55 * cw.x + uNeonA * 0.08 * cw.y + clothGlow * cw.w) / ws;

      // 사람 윤곽 안쪽 림라이트
      vec2 d = uMaskStep * 3.0;
      float around = 0.25 * (personAt(sv + vec2(d.x, 0.0)) + personAt(sv - vec2(d.x, 0.0))
                           + personAt(sv + vec2(0.0, d.y)) + personAt(sv - vec2(0.0, d.y)));
      float rim = person * (1.0 - around);

      color = mix(bg, pc, person);
      glow = mix(bgGlow, pg, person) + mix(uNeonA, uNeonB, st.y) * rim * 1.6;
    }
  }

  vec4 ov = texture(uOverlay, st);
  color = mix(color, ov.rgb, ov.a * 0.9);
  glow += ov.rgb * ov.a * 0.9;

  oColor = vec4(color, 1.0);
  oGlow = vec4(glow, 1.0);
}`;

// glow → 1/4 해상도로 내리기(쌍선형 4탭 = 4x4 박스)
export const DOWN_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 o;
void main() {
  o = 0.25 * (texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, -1.0))
            + texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, 1.0)));
}`;

// 분리형 가우시안(선형 샘플링 5탭 = 9탭)
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 o;
void main() {
  vec4 c = texture(uTex, vUv) * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846, o2 = uDir * 3.2307692308;
  c += (texture(uTex, vUv + o1) + texture(uTex, vUv - o1)) * 0.3162162162;
  c += (texture(uTex, vUv + o2) + texture(uTex, vUv - o2)) * 0.0702702703;
  o = c;
}`;

// 최종: 글리치 · 색수차 · 블룸 합성 · 비 · 스캔라인 · 비네트 · 그레인
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uColor;
uniform sampler2D uGlow;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uGlitch;
uniform float uRain;
uniform vec3 uNeonA;
out vec4 oColor;
${COMMON}
float rainLayer(vec2 p, float scale, float speed) {
  p *= scale;
  p.x += p.y * 0.12;
  float col = floor(p.x);
  float r = hash(vec2(col, scale));
  float y = fract(p.y * 0.07 + uTime * speed * (0.6 + r) + r * 10.0);
  float streak = smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(0.03, 0.16, y));
  float line = 1.0 - smoothstep(0.0, 0.06, abs(fract(p.x) - 0.5));
  return streak * line * step(0.45, r);
}
void main() {
  vec2 uv = vUv;
  float band = floor(uv.y * 28.0);
  float rnd = hash(vec2(band, floor(uTime * 24.0)));
  uv.x += (rnd - 0.5) * 0.12 * uGlitch * step(0.6, rnd);

  vec2 d = uv - 0.5;
  float ca = 0.0018 + 0.012 * uGlitch;
  vec3 col = vec3(texture(uColor, uv + d * ca).r, texture(uColor, uv).g, texture(uColor, uv - d * ca).b);
  col += texture(uGlow, uv).rgb * 0.55 + texture(uBloom, uv).rgb * 1.5;

  if (uRain > 0.0) {
    vec2 rp = vec2(uv.x * uRes.x / uRes.y, uv.y);
    float r = rainLayer(rp, 60.0, 0.9) + 0.6 * rainLayer(rp + 3.1, 110.0, 0.7);
    col += mix(uNeonA, vec3(0.85), 0.55) * r * 0.32 * uRain;
  }

  col *= 0.93 + 0.07 * sin(gl_FragCoord.y * 1.7);
  col *= mix(1.0, smoothstep(0.95, 0.25, length(d * vec2(1.0, 1.15))), 0.7);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.035;
  col = 1.0 - exp(-col * 1.35);
  oColor = vec4(col, 1.0);
}`;
