import { EXPR_NAMES, type BodyView, type ExprName, type Expressions, type EyeView, type FaceView, type Pt, type Theme } from '../themes/types';
import type { Body, Face } from './vision';

// 표정 켜짐/꺼짐 문턱(깜빡임 방지용 히스테리시스)
const ON: Expressions = { smile: 0.5, mouthOpen: 0.45, surprise: 0.5, frown: 0.5, pucker: 0.55, blink: 0.6, wink: 0.5, cheekPuff: 0.5 };
const OFF: Expressions = { smile: 0.3, mouthOpen: 0.25, surprise: 0.3, frown: 0.3, pucker: 0.35, blink: 0.35, wink: 0.25, cheekPuff: 0.3 };
const SMOOTH = 0.5; // 지수평활 비율(새 값 쪽)
const MAX_FACES = 4;

const zero = (): Expressions => ({ smile: 0, mouthOpen: 0, surprise: 0, frown: 0, pucker: 0, blink: 0, wink: 0, cheekPuff: 0 });
const avg = (a: number, b: number) => (a + b) / 2;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** 블렌드셰이프 52종 → 테마가 쓰기 쉬운 표정 8종 */
function rawExpressions(b: Record<string, number>, openA: number, openB: number): Expressions {
  const g = (k: string) => b[k] ?? 0;
  const bl = g('eyeBlinkLeft');
  const br = g('eyeBlinkRight');
  return {
    smile: avg(g('mouthSmileLeft'), g('mouthSmileRight')),
    mouthOpen: g('jawOpen'),
    surprise: clamp01(avg(g('browInnerUp'), avg(g('browOuterUpLeft'), g('browOuterUpRight'))) * 1.2 + avg(g('eyeWideLeft'), g('eyeWideRight')) * 0.5),
    frown: avg(g('browDownLeft'), g('browDownRight')),
    pucker: g('mouthPucker'),
    blink: Math.min(bl, br),
    // 한쪽만 감음. 눈 모양(openA/openB)이 실제로 다를 때만 인정해 블렌드셰이프 좌우 혼동을 막는다
    wink: Math.max(bl, br) > 0.5 && Math.abs(openA - openB) > 0.25 ? clamp01(Math.abs(bl - br) * 1.4) : 0,
    cheekPuff: g('cheekPuff'),
  };
}

/** 얼굴 변형 하나(화면 픽셀 좌표). 셰이더 warp() 와 같은 식이고, 여기서는 랜드마크가 변형 뒤 어디에 보이는지 역으로 푼다. */
interface WarpOp {
  kind: 'eye' | 'jaw';
  c: Pt;
  r: number;
  s: number;
}

function bisect(f: (x: number) => number, lo: number, hi: number) {
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

function unwarp(p: Pt, ops: WarpOp[]): Pt {
  let q = p;
  for (const o of ops) {
    if (o.kind === 'eye') {
      // 셰이더: 화면 r 에서 원본 r·(1 - s·k²) 를 읽는다 → 원본 rL 은 화면 r 에 보인다
      const rL = dist(q, o.c);
      if (rL >= o.r || rL < 1e-3) continue;
      const r = bisect((x) => x * (1 - o.s * (1 - (x / o.r) ** 2) ** 2) - rL, rL, o.r);
      q = { x: o.c.x + ((q.x - o.c.x) / rL) * r, y: o.c.y + ((q.y - o.c.y) / rL) * r };
    } else {
      // 셰이더: x 방향으로 바깥을 읽어 턱을 좁힌다 → 원본 x 는 화면에서 중심 쪽에 보인다
      const k = (x: number) => {
        const rr = ((x - o.c.x) / o.r) ** 2 + ((q.y - o.c.y) / (o.r * 1.3)) ** 2;
        return rr < 1 ? (1 - rr) ** 2 : 0;
      };
      const lx = q.x;
      if (Math.abs(lx - o.c.x) < 1e-3 || k(lx) === 0) continue;
      const x = bisect((x) => (x + (x - o.c.x) * o.s * k(x) - lx) * Math.sign(lx - o.c.x), o.c.x, lx);
      q = { x, y: q.y };
    }
  }
  return q;
}

interface Track {
  expr: Expressions;
  on: Record<ExprName, number>; // 켜진 시각(초), 꺼져 있으면 -1
}

// 인식 결과(정규화 좌표) → 테마가 쓰는 화면 좌표 뷰(FaceView·BodyView) + 셰이더 입력(얼굴 변형·얼굴 위치·대표 표정)
export class Scene {
  faces: FaceView[] = [];
  bodies: BodyView[] = [];
  /** 얼굴 변형 uniform: 눈 8개(x, y, 반경 px, 세기) · 턱 4개(x, y, 반경 px, 세기). 원본(거울 전) 픽셀 좌표 */
  eyesWarp = new Float32Array(MAX_FACES * 2 * 4);
  jawWarp = new Float32Array(MAX_FACES * 4);
  /** 얼굴 위치 uniform: 4개 × (두 눈 사이 x, y 화면 픽셀, 얼굴 폭 px, 기울기 rad). 폭 0 은 빈칸 */
  faceGeo = new Float32Array(MAX_FACES * 4);
  /** 대표 얼굴(가장 큰 얼굴) 표정: smile, mouthOpen, surprise, wink */
  exprVec = new Float32Array(4);
  /** 디버그용 강제 표정(?force=smile,wink) */
  force: Partial<Expressions> = {};
  private tracks: Track[] = [];

  update(faces: Face[], bodies: Body[], w: number, h: number, mirror: boolean, t: number, theme: Theme) {
    const toScreen = (p: { x: number; y: number }): Pt => ({ x: (mirror ? 1 - p.x : p.x) * w, y: p.y * h });
    const toSource = (p: { x: number; y: number }): Pt => ({ x: p.x * w, y: p.y * h });
    const flip = (p: Pt): Pt => (mirror ? { x: w - p.x, y: p.y } : p);

    this.eyesWarp.fill(0);
    this.jawWarp.fill(0);
    this.faceGeo.fill(0);
    this.exprVec.fill(0);

    // 1) 얼굴 변형(원본 좌표 → 셰이더, 화면 좌표 → 랜드마크 역변형)
    const ew = theme.warp?.eyes ?? 0;
    const sw = theme.warp?.slim ?? 0;
    const list = faces.slice(0, MAX_FACES);
    const ops: WarpOp[] = [];
    list.forEach((f, index) => {
      const src = (i: number) => toSource(f.points[i]);
      if (ew > 0) {
        [[33, 133], [263, 362]].forEach(([o, n], k) => {
          const a = src(o), b = src(n);
          const c = mid(a, b);
          const r = dist(a, b) * 1.1;
          this.eyesWarp.set([c.x, c.y, r, ew], (index * 2 + k) * 4);
          ops.push({ kind: 'eye', c: flip(c), r, s: ew });
        });
      }
      if (sw > 0) {
        const c = mid(src(1), src(152));
        const r = dist(src(234), src(454)) * 0.62;
        this.jawWarp.set([c.x, c.y, r, sw], index * 4);
        ops.push({ kind: 'jaw', c: flip(c), r, s: sw });
      }
    });

    // 2) 얼굴 뷰
    this.faces = list.map((f, index) => {
      const cache = new Map<number, Pt>();
      const pt = (i: number) => {
        let p = cache.get(i);
        if (!p) {
          p = ops.length ? unwarp(toScreen(f.points[i]), ops) : toScreen(f.points[i]);
          cache.set(i, p);
        }
        return p;
      };
      const edgeL = pt(234), edgeR = pt(454);
      const width = dist(edgeL, edgeR);

      // 눈 두 개: 33/133 은 사람의 오른쪽 눈, 263/362 는 왼쪽 눈. 화면 왼쪽부터 정렬
      const eye = (outer: number, inner: number, up: number, low: number, iris: number) => {
        const w2 = dist(pt(outer), pt(inner));
        return { center: mid(pt(outer), pt(inner)), iris: pt(iris), radius: w2 / 2, open: dist(pt(up), pt(low)) / Math.max(1, w2) };
      };
      const eA = eye(33, 133, 159, 145, 468);
      const eB = eye(263, 362, 386, 374, 473);

      // 표정: 지수평활 + 켜짐 시각
      const track = (this.tracks[index] ??= { expr: zero(), on: Object.fromEntries(EXPR_NAMES.map((n) => [n, -1])) as Record<ExprName, number> });
      const raw = rawExpressions(f.blend, eA.open, eB.open);
      for (const n of EXPR_NAMES) {
        const v = this.force[n] ?? raw[n];
        track.expr[n] += (v - track.expr[n]) * SMOOTH;
        if (track.on[n] < 0 && track.expr[n] > ON[n]) track.on[n] = t;
        else if (track.on[n] >= 0 && track.expr[n] < OFF[n]) track.on[n] = -1;
      }

      // 눈 감김: 블렌드셰이프 큰 값을 실제로 더 감긴(모양) 눈에 준다
      const bl = f.blend.eyeBlinkLeft ?? 0, br = f.blend.eyeBlinkRight ?? 0;
      const [hi, lo] = [Math.max(bl, br), Math.min(bl, br)];
      const views: EyeView[] = [
        { center: eA.center, iris: eA.iris, radius: eA.radius, blink: eA.open < eB.open ? hi : lo },
        { center: eB.center, iris: eB.iris, radius: eB.radius, blink: eA.open < eB.open ? lo : hi },
      ];
      views.sort((a, b) => a.center.x - b.center.x);

      const center = mid(views[0].center, views[1].center);
      const nose = pt(1);
      const mouth = mid(pt(13), pt(14));
      const roll = Math.atan2(views[1].center.y - views[0].center.y, views[1].center.x - views[0].center.x);
      this.faceGeo.set([center.x, center.y, width, roll], index * 4);

      const view: FaceView = {
        index,
        count: f.points.length,
        pt,
        width,
        center,
        roll,
        yaw: clamp01((nose.x - edgeL.x) / Math.max(1, edgeR.x - edgeL.x)) * 2 - 1,
        pitch: Math.max(-1, Math.min(1, ((nose.y - center.y) / Math.max(1, mouth.y - center.y) - 0.55) * 3)),
        eyes: [views[0], views[1]],
        expr: track.expr,
        since: (n) => (track.on[n] < 0 ? -1 : t - track.on[n]),
        blend: (n) => f.blend[n] ?? 0,
      };
      return view;
    });
    this.tracks.length = this.faces.length;

    const lead = this.faces.reduce<FaceView | null>((a, b) => (!a || b.width > a.width ? b : a), null);
    if (lead) this.exprVec.set([lead.expr.smile, lead.expr.mouthOpen, lead.expr.surprise, lead.expr.wink]);

    this.bodies = bodies.map((b, index) => {
      const pt = (i: number) => toScreen(b.points[i]);
      return { index, pt, vis: (i: number) => b.points[i]?.visibility ?? 0, scale: dist(pt(11), pt(12)) };
    });
  }
}
