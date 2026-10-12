// 전 패스 공용: 버퍼 없이 gl_VertexID 로 화면 전체를 덮는 삼각형 하나.
export const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// 테마 GLSL 에서도 쓸 수 있는 공용 함수
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

// 1패스: 엔진이 픽셀마다 Px(원본색·윤곽·사람 부위)를 만들어 테마의 stylize() 에 넘기고,
// 결과 색(oColor)과 빛나는 성분(oGlow)을 받는다. 장식 레이어(uOverlay)는 그 위에 덮는다.
// 마스크 클래스(selfie_multiclass): 0 배경 1 머리카락 2 몸 피부 3 얼굴 피부 4 옷 5 액세서리
export const styleFrag = (themeGlsl: string) => `#version 300 es
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
uniform float uOverlayGlow;
uniform vec3 uPal[5];
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oGlow;
${COMMON}
struct Px {
  vec2 st;      // 이미지 좌표(왼쪽 위 0,0)
  vec3 src;     // 원본 색
  float luma;
  vec3 hsv;
  vec2 grad;    // 소벨 기울기(x 세로 윤곽, y 가로 윤곽)
  vec4 parts;   // 사람 부위 비율: x 머리카락 y 몸 피부 z 얼굴 피부 w 옷·액세서리
  float person; // 사람일 정도 0~1
  float rim;    // 사람 윤곽 안쪽 테두리 0~1
  float time;
  vec2 texel;   // 1 픽셀 크기(uv)
};
float cls(vec2 p) { return floor(texture(uMask, p).r * 255.0 + 0.5); }
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
${themeGlsl}
void main() {
  Px p;
  p.st = vec2(vUv.x, 1.0 - vUv.y);
  vec2 sv = vec2(mix(p.st.x, 1.0 - p.st.x, uMirror), p.st.y);
  p.src = texture(uSrc, sv).rgb;
  p.luma = luma(p.src);
  p.hsv = rgb2hsv(p.src);
  p.time = uTime;
  p.texel = uTexel;

  vec2 o = uTexel * 1.5;
  float a00 = luma(texture(uSrc, sv + vec2(-o.x, -o.y)).rgb);
  float a01 = luma(texture(uSrc, sv + vec2(-o.x, 0.0)).rgb);
  float a02 = luma(texture(uSrc, sv + vec2(-o.x, o.y)).rgb);
  float a10 = luma(texture(uSrc, sv + vec2(0.0, -o.y)).rgb);
  float a12 = luma(texture(uSrc, sv + vec2(0.0, o.y)).rgb);
  float a20 = luma(texture(uSrc, sv + vec2(o.x, -o.y)).rgb);
  float a21 = luma(texture(uSrc, sv + vec2(o.x, 0.0)).rgb);
  float a22 = luma(texture(uSrc, sv + vec2(o.x, o.y)).rgb);
  p.grad = vec2((a20 + 2.0 * a21 + a22) - (a00 + 2.0 * a01 + a02),
                (a02 + 2.0 * a12 + a22) - (a00 + 2.0 * a10 + a20));

  p.parts = vec4(0.0);
  p.person = 0.0;
  p.rim = 0.0;
  if (uHasMask > 0.5) {
    p.parts = classWeights(sv);
    p.person = clamp(p.parts.x + p.parts.y + p.parts.z + p.parts.w, 0.0, 1.0);
    if (p.person > 0.0) {
      vec2 d = uMaskStep * 3.0;
      float around = 0.25 * (personAt(sv + vec2(d.x, 0.0)) + personAt(sv - vec2(d.x, 0.0))
                           + personAt(sv + vec2(0.0, d.y)) + personAt(sv - vec2(0.0, d.y)));
      p.rim = p.person * (1.0 - around);
    }
  }

  vec3 color, glow;
  stylize(p, color, glow);

  vec4 ov = texture(uOverlay, p.st);
  color = mix(color, ov.rgb, ov.a * 0.9);
  glow += ov.rgb * ov.a * uOverlayGlow;
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

// 최종 합성: 글리치 · 색수차 · 발광 · 비 · 스캔라인 · 비네트 · 그레인 · 톤매핑. 세기는 테마 PostFx.
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
uniform vec3 uRainColor;
uniform float uGlowAmt;
uniform float uBloomAmt;
uniform float uChroma;
uniform float uScan;
uniform float uGrain;
uniform float uVignette;
uniform float uExposure;
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
  float ca = uChroma + 0.012 * uGlitch;
  vec3 col = vec3(texture(uColor, uv + d * ca).r, texture(uColor, uv).g, texture(uColor, uv - d * ca).b);
  col += texture(uGlow, uv).rgb * uGlowAmt + texture(uBloom, uv).rgb * uBloomAmt;

  if (uRain > 0.0) {
    vec2 rp = vec2(uv.x * uRes.x / uRes.y, uv.y);
    float r = rainLayer(rp, 60.0, 0.9) + 0.6 * rainLayer(rp + 3.1, 110.0, 0.7);
    col += uRainColor * r * 0.32 * uRain;
  }

  col *= 1.0 - uScan + uScan * sin(gl_FragCoord.y * 1.7);
  col *= mix(1.0, smoothstep(0.95, 0.25, length(d * vec2(1.0, 1.15))), uVignette);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * uGrain;
  col = 1.0 - exp(-col * uExposure);
  oColor = vec4(col, 1.0);
}`;
