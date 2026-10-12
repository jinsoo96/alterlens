import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type ImageSegmenterResult,
  type ImageSource,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type { Capability } from '../themes/types';

const BASE = import.meta.env.BASE_URL;

export interface Face {
  points: NormalizedLandmark[];
  blend: Record<string, number>;
}

export interface Body {
  points: NormalizedLandmark[];
}

type Mode = 'VIDEO' | 'IMAGE';
type Task = ImageSegmenter | FaceLandmarker | PoseLandmarker;
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const MODELS: Record<Capability, string> = {
  parts: 'selfie_multiclass_256x256.tflite',
  face: 'face_landmarker.task',
  pose: 'pose_landmarker_lite.task',
};

async function fetchModel(url: string, onRatio: (r: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (total) onRatio(size / total);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// 사람 분할(parts) · 얼굴(face) · 몸(pose). 테마가 고른 것만 내려받아 만들고, 프레임마다 그것만 돌린다.
// 카메라는 VIDEO, 갤러리 사진은 IMAGE 모드.
export class Vision {
  mask: Uint8Array | null = null;
  maskW = 0;
  maskH = 0;
  maskVersion = 0;
  faces: Face[] = [];
  bodies: Body[] = [];
  private seg?: ImageSegmenter;
  private face?: FaceLandmarker;
  private pose?: PoseLandmarker;
  private loading = new Map<Capability, Promise<void>>();
  private delegate: 'GPU' | 'CPU' = 'GPU';
  private mode: Mode = 'VIDEO';
  private lastTs = 0;

  private constructor(private fileset: WasmFileset) {}

  static async create(): Promise<Vision> {
    return new Vision(await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`));
  }

  has(cap: Capability) {
    return !!(cap === 'parts' ? this.seg : cap === 'face' ? this.face : this.pose);
  }

  /** 아직 없는 인식만 내려받아 만든다. onRatio 는 받는 중인 모델들의 평균 진행률. */
  async ensure(caps: Capability[], onRatio: (r: number) => void = () => {}) {
    const todo = caps.filter((c) => !this.has(c));
    const ratios = new Map<Capability, number>(todo.map((c) => [c, 0]));
    const report = () => onRatio([...ratios.values()].reduce((a, b) => a + b, 0) / Math.max(1, ratios.size));
    await Promise.all(
      todo.map((cap) => {
        let p = this.loading.get(cap);
        if (!p) {
          p = this.load(cap, (r) => {
            ratios.set(cap, r);
            report();
          });
          this.loading.set(cap, p);
        }
        return p;
      }),
    );
  }

  private async load(cap: Capability, onRatio: (r: number) => void) {
    const model = await fetchModel(`${BASE}models/${MODELS[cap]}`, onRatio);
    const build = (delegate: 'GPU' | 'CPU') => {
      const baseOptions = { modelAssetBuffer: model, delegate };
      const runningMode = this.mode;
      if (cap === 'parts')
        return ImageSegmenter.createFromOptions(this.fileset, {
          baseOptions,
          runningMode,
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      if (cap === 'face')
        return FaceLandmarker.createFromOptions(this.fileset, { baseOptions, runningMode, numFaces: 4, outputFaceBlendshapes: true });
      return PoseLandmarker.createFromOptions(this.fileset, { baseOptions, runningMode, numPoses: 3 });
    };
    let task: Task;
    try {
      task = await build(this.delegate);
    } catch (e) {
      console.warn(`${cap}: GPU delegate 실패, CPU 로 전환`, e);
      this.delegate = 'CPU';
      task = await build('CPU');
    }
    if (cap === 'parts') this.seg = task as ImageSegmenter;
    else if (cap === 'face') this.face = task as FaceLandmarker;
    else this.pose = task as PoseLandmarker;
    onRatio(1);
  }

  private async setMode(mode: Mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    const tasks: Task[] = [this.seg, this.face, this.pose].filter((t): t is NonNullable<typeof t> => !!t);
    await Promise.all(tasks.map((t) => t.setOptions({ runningMode: mode })));
  }

  private takeMask = (r: ImageSegmenterResult) => {
    const m = r.categoryMask;
    if (!m) return;
    const data = m.getAsUint8Array();
    if (!this.mask || this.mask.length !== data.length) this.mask = new Uint8Array(data.length);
    this.mask.set(data);
    this.maskW = m.width;
    this.maskH = m.height;
    this.maskVersion++;
  };

  private takeFaces(r: FaceLandmarkerResult) {
    this.faces = r.faceLandmarks.map((points, i) => {
      const blend: Record<string, number> = {};
      r.faceBlendshapes[i]?.categories.forEach((c) => (blend[c.categoryName] = c.score));
      return { points, blend };
    });
  }

  /** 꺼진 인식의 결과는 비워 둔다(테마를 바꿨을 때 이전 결과가 남지 않게). */
  private clearUnused(caps: Capability[]) {
    if (!caps.includes('parts')) this.mask = null;
    if (!caps.includes('face')) this.faces = [];
    if (!caps.includes('pose')) this.bodies = [];
  }

  async processVideo(src: ImageSource, caps: Capability[]) {
    await this.setMode('VIDEO');
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    this.clearUnused(caps);
    if (caps.includes('parts') && this.seg) this.seg.segmentForVideo(src, ts, this.takeMask);
    if (caps.includes('face') && this.face) this.takeFaces(this.face.detectForVideo(src, ts));
    if (caps.includes('pose') && this.pose) this.pose.detectForVideo(src, ts, (r) => (this.bodies = r.landmarks.map((points) => ({ points }))));
  }

  async processImage(src: ImageSource, caps: Capability[]) {
    await this.setMode('IMAGE');
    this.clearUnused(caps);
    if (caps.includes('parts') && this.seg) this.seg.segment(src, this.takeMask);
    if (caps.includes('face') && this.face) this.takeFaces(this.face.detect(src));
    if (caps.includes('pose') && this.pose) this.pose.detect(src, (r) => (this.bodies = r.landmarks.map((points) => ({ points }))));
  }
}
