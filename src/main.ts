import './style.css';
import { Overlay } from './overlay';
import { PALETTES } from './palettes';
import { Renderer } from './renderer';
import { Vision } from './vision';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const view = $<HTMLCanvasElement>('#view');
const video = $<HTMLVideoElement>('#cam');
const splash = $<HTMLDivElement>('#splash');
const splashMsg = $<HTMLParagraphElement>('#splash-msg');
const aiStatus = $<HTMLSpanElement>('#ai');
const fpsEl = $<HTMLSpanElement>('#fps');
const fileInput = $<HTMLInputElement>('#file');
const chips = $<HTMLElement>('#styles');
const preview = $<HTMLDivElement>('#preview');
const previewImg = $<HTMLImageElement>('#preview-img');

const LIVE_MAX = 1280;
const PHOTO_MAX = 2048;

const state = {
  source: null as null | 'camera' | 'photo',
  facing: 'environment' as 'user' | 'environment',
  photo: null as HTMLCanvasElement | null,
  photoDirty: false,
  pal: 0,
  rain: true,
  glitch: true,
  hud: true,
  mod: 0,
  capture: false,
};

let renderer: Renderer;
try {
  renderer = new Renderer(view);
} catch (e) {
  splashMsg.textContent = String((e as Error).message);
  throw e;
}
const overlay = new Overlay();
let vision: Vision | null = null;
let visionLoading = false;
let visionBusy = false;
let visionAt = 0;
let visionCost = 0;
let maskSeen = -1;
let stream: MediaStream | null = null;

const fit = (w: number, h: number, max: number) => {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * s), Math.round(h * s)];
};

// ---------- 소스: 카메라 / 사진 ----------
async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('카메라를 쓰려면 HTTPS 주소로 열어야 합니다.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: state.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  state.source = 'camera';
  document.body.classList.remove('photo');
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

async function openPhoto(file: File) {
  const bmp = await createImageBitmap(file);
  const [w, h] = fit(bmp.width, bmp.height, PHOTO_MAX);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  stopCamera();
  state.photo = c;
  state.photoDirty = true;
  state.source = 'photo';
  document.body.classList.add('photo');
  hideSplash();
  await analyzePhoto();
}

async function analyzePhoto() {
  if (!vision || !state.photo) return;
  visionBusy = true;
  try {
    await vision.processImage(state.photo);
  } finally {
    visionBusy = false;
  }
}

function loadVision() {
  if (vision || visionLoading) return;
  visionLoading = true;
  aiStatus.textContent = 'AI 0%';
  Vision.create((r) => (aiStatus.textContent = `AI ${Math.round(r * 100)}%`))
    .then(async (v) => {
      vision = v;
      aiStatus.textContent = 'AI ON';
      aiStatus.classList.add('on');
      if (state.source === 'photo') await analyzePhoto();
    })
    .catch((e) => {
      console.error(e);
      aiStatus.textContent = 'AI OFF';
    });
}

// ---------- 렌더 루프 ----------
let glitchUntil = 0;
let nextGlitch = 3;
let flashUntil = 0;
let fpsT = 0;
let fpsN = 0;

function glitchAmount(t: number) {
  if (t < flashUntil) return 1;
  if (!state.glitch) return 0;
  if (t > nextGlitch) {
    glitchUntil = t + 0.1 + Math.random() * 0.2;
    nextGlitch = t + 2 + Math.random() * 5;
  }
  let g = t < glitchUntil ? 0.5 + Math.random() * 0.5 : 0;
  // 입을 크게 벌리면 화면이 오버드라이브
  const jaw = Math.max(0, ...(vision?.faces ?? []).map((f) => f.jawOpen));
  if (jaw > 0.45) g = Math.max(g, Math.min(1, (jaw - 0.45) * 2.5));
  return g;
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  let src: TexImageSource | null = null;
  let w = 0;
  let h = 0;
  if (state.source === 'camera' && video.readyState >= 2 && video.videoWidth) {
    src = video;
    [w, h] = fit(video.videoWidth, video.videoHeight, LIVE_MAX);
  } else if (state.source === 'photo' && state.photo) {
    src = state.photo;
    w = state.photo.width;
    h = state.photo.height;
  }
  if (!src) return;

  renderer.resize(w, h);
  if (state.source === 'camera' || state.photoDirty) {
    renderer.setSource(src);
    state.photoDirty = false;
  }
  // 인식이 느린 기기에서는 인식 간격을 벌려 화면이 멈추지 않게 한다
  if (vision && state.source === 'camera' && !visionBusy && now - visionAt > visionCost * 1.5) {
    visionBusy = true;
    const t0 = performance.now();
    vision
      .processVideo(video)
      .catch((e) => console.error(e))
      .finally(() => {
        visionBusy = false;
        visionAt = performance.now();
        visionCost = visionAt - t0;
      });
  }
  if (vision?.mask && vision.maskVersion !== maskSeen) {
    renderer.setMask(vision.mask, vision.maskW, vision.maskH);
    maskSeen = vision.maskVersion;
  }

  const palette = PALETTES[state.pal];
  const mirror = state.source === 'camera' && state.facing === 'user';
  // 테두리·시각 스탬프는 화면 UI 와 겹치니 저장되는 사진에만 찍는다
  const capturing = state.capture;
  overlay.draw(w, h, vision?.faces ?? [], { mirror, time: t, palette, hud: state.hud, mod: state.mod, frame: capturing });
  renderer.setOverlay(overlay.canvas);
  renderer.render({ time: t, mirror, glitch: capturing ? 0 : glitchAmount(t), rain: state.rain ? 0.8 : 0, palette });

  if (capturing) {
    state.capture = false;
    flashUntil = t + 0.25;
    view.toBlob((b) => b && showPreview(b), 'image/jpeg', 0.92);
  }

  fpsN++;
  if (t - fpsT > 1) {
    fpsEl.textContent = `${Math.round(fpsN / (t - fpsT))} FPS`;
    fpsT = t;
    fpsN = 0;
  }
}

// ---------- 촬영 결과 ----------
let lastBlob: Blob | null = null;

function fileName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `neonlens-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
}

function showPreview(b: Blob) {
  lastBlob = b;
  if (previewImg.src) URL.revokeObjectURL(previewImg.src);
  previewImg.src = URL.createObjectURL(b);
  const file = new File([b], fileName(), { type: 'image/jpeg' });
  $<HTMLButtonElement>('#share').hidden = !navigator.canShare?.({ files: [file] });
  preview.hidden = false;
}

$('#save').addEventListener('click', () => {
  if (!lastBlob) return;
  const a = document.createElement('a');
  a.href = previewImg.src;
  a.download = fileName();
  a.click();
});
$('#share').addEventListener('click', async () => {
  if (!lastBlob) return;
  const file = new File([lastBlob], fileName(), { type: 'image/jpeg' });
  try {
    await navigator.share({ files: [file], title: 'NEON LENS' });
  } catch {
    /* 사용자가 공유 창을 닫음 */
  }
});
$('#close').addEventListener('click', () => (preview.hidden = true));

// ---------- 조작 ----------
function hideSplash() {
  splash.classList.add('gone');
}

function selectPalette(i: number) {
  state.pal = (i + PALETTES.length) % PALETTES.length;
  chips.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === state.pal));
}

PALETTES.forEach((p, i) => {
  const b = document.createElement('button');
  b.textContent = p.name;
  b.addEventListener('click', () => selectPalette(i));
  chips.append(b);
});
selectPalette(0);

async function goCamera() {
  splashMsg.textContent = '';
  try {
    await startCamera();
    hideSplash();
  } catch (e) {
    const err = e as Error;
    splashMsg.textContent =
      err.name === 'NotAllowedError' ? '카메라 권한을 허용해 주세요.' : err.message || '카메라를 열 수 없습니다.';
    splash.classList.remove('gone');
  }
  loadVision();
}

$('#start').addEventListener('click', goCamera);
$('#start-photo').addEventListener('click', () => {
  loadVision();
  fileInput.click();
});
$('#gallery').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  loadVision();
  if (f) openPhoto(f).catch((e) => (splashMsg.textContent = String(e)));
  fileInput.value = '';
});
$('#shutter').addEventListener('click', () => {
  if (state.source) state.capture = true;
});
$('#flip').addEventListener('click', async () => {
  if (state.source === 'camera') state.facing = state.facing === 'user' ? 'environment' : 'user';
  await goCamera();
});

for (const key of ['rain', 'glitch', 'hud'] as const) {
  const b = $<HTMLButtonElement>(`#t-${key}`);
  b.classList.toggle('on', state[key]);
  b.addEventListener('click', () => {
    state[key] = !state[key];
    b.classList.toggle('on', state[key]);
  });
}

// 얼굴 개조 스타일 순환(바이저 → 사이버 눈 → 호흡기)
$('#t-mod').addEventListener('click', () => (state.mod = (state.mod + 1) % 3));

// 좌우 스와이프로 필터 전환
let downX: number | null = null;
view.addEventListener('pointerdown', (e) => (downX = e.clientX));
view.addEventListener('pointerup', (e) => {
  if (downX === null) return;
  const dx = e.clientX - downX;
  downX = null;
  if (Math.abs(dx) > 50) selectPalette(state.pal + (dx < 0 ? 1 : -1));
});

document.fonts?.load('700 20px Orbitron').catch(() => {});
requestAnimationFrame(frame);

// 이미 카메라 권한이 있으면 바로 켠다
navigator.permissions
  ?.query({ name: 'camera' as PermissionName })
  .then((p) => {
    if (p.state === 'granted') goCamera();
  })
  .catch(() => {});
