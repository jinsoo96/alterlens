import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
  type FaceLandmarkerResult,
  type ImageSegmenterResult,
  type ImageSource,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;

export interface Face {
  points: NormalizedLandmark[];
  jawOpen: number;
}

type Mode = 'VIDEO' | 'IMAGE';

async function fetchModel(url: string, onBytes: (n: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// 사람 분할(머리·피부·옷) + 얼굴 478점. 카메라는 VIDEO, 갤러리 사진은 IMAGE 모드로 돈다.
export class Vision {
  mask: Uint8Array | null = null;
  maskW = 0;
  maskH = 0;
  maskVersion = 0;
  faces: Face[] = [];
  private mode: Mode = 'VIDEO';
  private lastTs = 0;

  private constructor(private seg: ImageSegmenter, private face: FaceLandmarker) {}

  static async create(onProgress: (ratio: number) => void): Promise<Vision> {
    const TOTAL = 16371837 + 3758596; // 두 모델 크기(대략치, 진행률 표시용)
    let loaded = 0;
    const tick = (n: number) => onProgress(Math.min(0.99, (loaded += n) / TOTAL));
    const [fileset, segModel, faceModel] = await Promise.all([
      FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`),
      fetchModel(`${BASE}models/selfie_multiclass_256x256.tflite`, tick),
      fetchModel(`${BASE}models/face_landmarker.task`, tick),
    ]);
    const build = async (delegate: 'GPU' | 'CPU') =>
      Promise.all([
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: segModel, delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        }),
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: faceModel, delegate },
          runningMode: 'VIDEO',
          numFaces: 4,
          outputFaceBlendshapes: true,
        }),
      ]);
    let tasks: [ImageSegmenter, FaceLandmarker];
    try {
      tasks = await build('GPU');
    } catch (e) {
      console.warn('GPU delegate 실패, CPU 로 전환', e);
      tasks = await build('CPU');
    }
    onProgress(1);
    return new Vision(tasks[0], tasks[1]);
  }

  private async setMode(mode: Mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    await Promise.all([this.seg.setOptions({ runningMode: mode }), this.face.setOptions({ runningMode: mode })]);
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
      const jaw = r.faceBlendshapes[i]?.categories.find((c) => c.categoryName === 'jawOpen');
      return { points, jawOpen: jaw?.score ?? 0 };
    });
  }

  async processVideo(src: ImageSource) {
    await this.setMode('VIDEO');
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    this.seg.segmentForVideo(src, ts, this.takeMask);
    this.takeFaces(this.face.detectForVideo(src, ts));
  }

  async processImage(src: ImageSource) {
    await this.setMode('IMAGE');
    this.seg.segment(src, this.takeMask);
    this.takeFaces(this.face.detect(src));
  }
}
