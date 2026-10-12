export interface Palette {
  id: string;
  name: string;
  shadow: number[];
  mid: number[];
  high: number[];
  neonA: number[];
  neonB: number[];
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const make = (id: string, name: string, c: string[]): Palette => {
  const [shadow, mid, high, neonA, neonB] = c.map(hex);
  return { id, name, shadow, mid, high, neonA, neonB };
};

// 순서: 그림자 · 중간 · 하이라이트 · 네온A(세로 윤곽·림) · 네온B(가로 윤곽·옷 트림)
export const PALETTES: Palette[] = [
  make('neon', 'NEON', ['#0b0420', '#3a1a6b', '#ff7ad9', '#19f6ff', '#ff2bd6']),
  make('volt', 'VOLT', ['#07070d', '#2b2140', '#fcee0a', '#00f0ff', '#fcee0a']),
  make('blade', 'BLADE', ['#140604', '#6b2a0e', '#ffb347', '#22e0d0', '#ff4d1f']),
  make('acid', 'ACID', ['#020b06', '#0d3b2a', '#c8ff4d', '#b6ff00', '#00ffa3']),
  make('ghost', 'GHOST', ['#02040f', '#10306b', '#9fd8ff', '#6ef3ff', '#7a5cff']),
];

export const css = (c: number[], a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
