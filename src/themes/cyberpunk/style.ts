// 사이버펑크 픽셀 규칙. uPal: 0 그림자 1 중간 2 하이라이트 3 네온A 4 네온B
export const STYLE = `
vec3 tritone(float l) {
  return l < 0.5 ? mix(uPal[0], uPal[1], l * 2.0) : mix(uPal[1], uPal[2], (l - 0.5) * 2.0);
}

void stylize(Px p, out vec3 color, out vec3 glow) {
  vec3 neonA = uPal[3], neonB = uPal[4];
  float L = p.luma;
  vec3 hsv = p.hsv;
  vec2 st = p.st;

  // 윤곽: 세로 윤곽은 네온A, 가로 윤곽은 네온B
  float edge = smoothstep(0.16, 0.55, length(p.grad));
  vec3 edgeCol = mix(neonB, neonA, abs(p.grad.x) / (abs(p.grad.x) + abs(p.grad.y) + 1e-4));

  // 배경: 밤 톤으로 내리고, 원래 채도 높은 간판·차선은 네온으로 살린다
  vec3 bg = tritone(pow(L, 1.75) * 0.9);
  bg = mix(bg, p.src * vec3(0.45, 0.5, 0.75), 0.15);
  float sat = smoothstep(0.28, 0.6, hsv.y) * smoothstep(0.2, 0.5, hsv.z);
  vec3 vivid = hsv2rgb(vec3(hsv.x, min(1.0, hsv.y * 1.3 + 0.15), 1.0));
  bg = mix(bg, vivid * (0.45 + 0.7 * hsv.z), sat * 0.85);

  // 밝고 무채색인 위쪽 = 하늘 → 스모그 낀 밤하늘
  float skyW = smoothstep(0.58, 0.8, L) * (1.0 - smoothstep(0.06, 0.22, hsv.y))
             * (1.0 - smoothstep(0.3, 0.7, st.y)) * (1.0 - edge);
  float haze = fbm(st * vec2(3.0, 7.0) + vec2(p.time * 0.015, 0.0));
  vec3 skyCol = mix(uPal[0] * 0.5, neonB * 0.55, smoothstep(0.0, 0.65, st.y)) + neonA * haze * 0.12;
  bg = mix(bg, skyCol, skyW);

  vec3 bgGlow = edgeCol * edge * (1.0 - skyW) * 0.8
              + vivid * sat * 0.6
              + uPal[2] * smoothstep(0.82, 0.98, L) * (1.0 - skyW) * 0.3;

  color = bg;
  glow = bgGlow;
  if (p.person <= 0.0) return;

  vec4 cw = p.parts;
  // 머리카락: 두 네온 사이를 흐르는 그라데이션
  vec3 hairCol = mix(neonB, neonA, 0.5 + 0.5 * sin(st.y * 9.0 - p.time * 1.5)) * (0.35 + 1.2 * L);
  // 얼굴: 차가운 피부톤, 알아볼 수 있게 원본 디테일 유지
  vec3 faceCol = mix(p.src, vec3(L * 1.08) * mix(vec3(1.0), neonA, 0.22), 0.55);
  // 몸 피부: 크롬 의수 느낌의 줄무늬 반사
  float band = 0.5 + 0.5 * cos(L * 14.0 + st.y * 5.0 - p.time * 0.6);
  vec3 chrome = mix(uPal[0] * 0.8, mix(vec3(0.9, 0.97, 1.0), neonA, 0.3), band) * (0.6 + 0.6 * L);
  vec3 skinCol = mix(p.src, chrome, 0.6);
  // 옷: 검은 테크웨어 + 회로 무늬
  vec2 cg = st / p.texel / 22.0;
  vec2 cell = floor(cg), f = fract(cg);
  float r = hash(cell);
  float trace = r < 0.5 ? 1.0 - smoothstep(0.0, 0.07, abs(f.y - 0.5)) : 1.0 - smoothstep(0.0, 0.07, abs(f.x - 0.5));
  trace *= step(0.6, hash(cell + 7.0)) * (0.5 + 0.5 * sin(p.time * 2.5 + r * 6.283));
  vec3 clothCol = vec3(L * 0.42) * mix(vec3(1.0), uPal[0] * 2.5 + 0.2, 0.45);
  vec3 clothGlow = neonB * edge * 1.2 + neonA * trace * 0.35;

  float ws = max(cw.x + cw.y + cw.z + cw.w, 1e-4);
  vec3 pc = (hairCol * cw.x + skinCol * cw.y + faceCol * cw.z + clothCol * cw.w) / ws;
  vec3 pg = (hairCol * 0.55 * cw.x + neonA * 0.08 * cw.y + clothGlow * cw.w) / ws;

  color = mix(bg, pc, p.person);
  glow = mix(bgGlow, pg, p.person) + mix(neonA, neonB, st.y) * p.rim * 1.6;
}
`;
