import './style.css';
import { chat, createTransform, loadCatalog, mediaUrl, setCurrent, settle, type Catalog, type RemoteTheme, type SceneReport, type Session } from './engine/ai';
import { Overlay } from './engine/overlay';
import { Renderer } from './engine/renderer';
import { Scene } from './engine/scene';
import { Vision } from './engine/vision';
import { THEMES } from './themes';
import { EXPR_NAMES, hexToRgb, type Capability, type ExprName } from './themes/types';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const view = $<HTMLCanvasElement>('#view');
const video = $<HTMLVideoElement>('#cam');
const splash = $<HTMLDivElement>('#splash');
const splashMsg = $<HTMLParagraphElement>('#splash-msg');
const aiStatus = $<HTMLSpanElement>('#ai');
const fpsEl = $<HTMLSpanElement>('#fps');
const fileInput = $<HTMLInputElement>('#file');
const snapInput = $<HTMLInputElement>('#snap');
const chips = $<HTMLElement>('#styles');
const themeRow = $<HTMLElement>('#themes');
const preview = $<HTMLDivElement>('#preview');
const previewImg = $<HTMLImageElement>('#preview-img');
const debugEl = $<HTMLPreElement>('#debug');
const aiBtn = $<HTMLButtonElement>('#ai-btn');
const aiMsg = $<HTMLParagraphElement>('#ai-msg');
const stepsEl = $<HTMLDivElement>('#steps');
const chatForm = $<HTMLFormElement>('#chat');
const chatInput = $<HTMLInputElement>('#chat-input');

const LIVE_MAX = 1280;
const PHOTO_MAX = 2048;
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const state = {
  source: null as null | 'camera' | 'photo',
  facing: 'environment' as 'user' | 'environment',
  photo: null as HTMLCanvasElement | null,
  photoDirty: false,
  theme: 0,
  variant: 0,
  fx: true,
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
const scene = new Scene();
let vision: Vision | null = null;
let visionInit: Promise<Vision> | null = null;
let visionBusy = false;
let visionAt = 0;
let visionCost = 0;
let maskSeen = -1;
let stream: MediaStream | null = null;
// 서버 AI 테마 목록(loadCatalog) 과 테마별 AI 지원 정보
let catalog: Catalog | null = null;
const aiThemes = new Map<string, RemoteTheme>();

// ?debug&force=smile,wink : 테마를 만들 때 표정 반응을 얼굴 없이 미리 본다
if (DEBUG) {
  debugEl.hidden = false;
  for (const n of (params.get('force') ?? '').split(',')) if (EXPR_NAMES.includes(n as ExprName)) scene.force[n as ExprName] = 1;
}

const theme = () => THEMES[state.theme];
const fit = (w: number, h: number, max: number) => {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * s), Math.round(h * s)];
};

// ---------- 인식: 테마가 고른 것만 ----------
function needs(): Capability[] {
  return theme().needs;
}

function ensureVision() {
  visionInit ??= Vision.create();
  const caps = needs();
  aiStatus.classList.remove('on');
  visionInit
    .then(async (v) => {
      if (caps.some((c) => !v.has(c))) aiStatus.textContent = 'AI 0%';
      await v.ensure(caps, (r) => (aiStatus.textContent = `AI ${Math.round(r * 100)}%`));
      vision = v;
      if (caps !== needs()) return; // 그사이 테마가 바뀜
      aiStatus.textContent = 'AI ON';
      aiStatus.classList.add('on');
      if (state.source === 'photo') await analyzePhoto();
    })
    .catch((e) => {
      console.error(e);
      aiStatus.textContent = 'AI OFF';
    });
}

async function analyzePhoto() {
  if (!vision || !state.photo) return;
  visionBusy = true;
  try {
    await vision.processImage(state.photo, needs().filter((c) => vision!.has(c)));
  } finally {
    visionBusy = false;
  }
}

// ---------- 소스: 앱 안 카메라 / 사진(갤러리 · 폰 기본 카메라 · 공유) ----------
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

async function openPhoto(file: Blob) {
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
  ensureVision();
  await analyzePhoto();
}

// 안드로이드 설치 앱: 폰 카메라·갤러리의 "공유 → ALTERLENS" 로 들어온 사진(sw.js 가 캐시에 넣어 둠)
async function takeShared() {
  if (!params.has('shared') || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open('alterlens-share');
  const res = await cache.match('shared-image');
  if (!res) return;
  await cache.delete('shared-image');
  await openPhoto(await res.blob());
}

// ---------- 렌더 루프 ----------
let glitchUntil = 0;
let nextGlitch = 3;
let flashUntil = 0;
let fpsT = 0;
let fpsN = 0;

function glitchAmount(t: number) {
  if (t < flashUntil) return 1;
  if (!state.glitch || !theme().effects.glitch) return 0;
  if (t > nextGlitch) {
    glitchUntil = t + 0.1 + Math.random() * 0.2;
    nextGlitch = t + 2 + Math.random() * 5;
  }
  let g = t < glitchUntil ? 0.5 + Math.random() * 0.5 : 0;
  // 입을 크게 벌리면 화면이 오버드라이브
  const open = Math.max(0, ...scene.faces.map((f) => f.expr.mouthOpen));
  if (open > 0.45) g = Math.max(g, Math.min(1, (open - 0.45) * 2.5));
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
      .processVideo(video, needs().filter((c) => vision!.has(c)))
      .catch((e) => console.error(e))
      .finally(() => {
        visionBusy = false;
        visionAt = performance.now();
        visionCost = visionAt - t0;
      });
  }
  const th = theme();
  const mask = th.needs.includes('parts') ? vision?.mask : null;
  if (mask && vision!.maskVersion !== maskSeen) {
    renderer.setMask(mask, vision!.maskW, vision!.maskH);
    maskSeen = vision!.maskVersion;
  } else if (!mask && maskSeen !== -1) {
    renderer.setMask(null, 1, 1);
    maskSeen = -1;
  }

  const variant = th.variants[state.variant];
  const rgb = variant.colors.map(hexToRgb);
  const mirror = state.source === 'camera' && state.facing === 'user';
  scene.update(vision?.faces ?? [], vision?.bodies ?? [], w, h, mirror, t, th);
  // 테두리·시각 스탬프는 화면 UI 와 겹치니 저장되는 사진에만 찍는다
  const capturing = state.capture;
  overlay.draw(th, variant, w, h, scene, { time: t, hud: state.hud, mod: state.mod, stamp: capturing });
  renderer.setOverlay(overlay.front.canvas, th.backLayer ? overlay.back.canvas : null);
  const fx = th.effects.particles;
  renderer.render({
    time: t,
    mirror,
    glitch: capturing ? 0 : glitchAmount(t),
    particles: fx && state.fx ? 0.8 : 0,
    particleKind: fx?.kind === 'petal' ? 2 : fx?.kind === 'sparkle' ? 1 : 0,
    particleColor: fx?.color ? hexToRgb(fx.color) : (rgb[fx?.colorSlot ?? 0] ?? [1, 1, 1]).map((v) => v * 0.45 + 0.85 * 0.55),
    palette: new Float32Array(Array.from({ length: 5 }, (_, i) => rgb[i] ?? [0, 0, 0]).flat()),
    post: th.post,
    eyesWarp: scene.eyesWarp,
    jawWarp: scene.jawWarp,
    expr: scene.exprVec,
    faces: scene.faceGeo,
    vars: new Float32Array([0, 1, 2, 3].map((i) => variant.params?.[i] ?? 0)),
  });

  if (capturing) {
    state.capture = false;
    flashUntil = th.effects.glitch ? t + 0.25 : 0;
    view.toBlob((b) => b && showPreview(b), 'image/jpeg', 0.92);
    // AI 다시 그리기용 원본(화면에 보인 그대로, 전면이면 거울)
    const raw = document.createElement('canvas');
    raw.width = w;
    raw.height = h;
    const g = raw.getContext('2d')!;
    if (mirror) g.setTransform(-1, 0, 0, 1, w, 0);
    g.drawImage(src as CanvasImageSource, 0, 0, w, h);
    const shot = { theme: th.id, variant: variant.id, w, h, scene: sceneReport(th, variant.id, w) };
    raw.toBlob((b) => b && (lastRaw = { ...shot, blob: b }), 'image/jpeg', 0.9);
  }

  fpsN++;
  if (t - fpsT > 1) {
    fpsEl.textContent = `${Math.round(fpsN / (t - fpsT))} FPS`;
    fpsT = t;
    fpsN = 0;
    if (DEBUG) showDebug();
  }
}

function showDebug() {
  const f = scene.faces[0];
  const pct = (v: number) => String(Math.round(v * 100)).padStart(3);
  const lines = [
    `theme ${theme().id}  needs ${needs().join(',')}  vision ${visionCost.toFixed(0)}ms`,
    `faces ${scene.faces.length}  bodies ${scene.bodies.length}  mask ${vision?.mask ? `${vision.maskW}x${vision.maskH}` : '-'}`,
  ];
  if (f) {
    lines.push(EXPR_NAMES.map((n) => `${n} ${pct(f.expr[n])}${f.since(n) >= 0 ? '*' : ' '}`).join('  '));
    lines.push(`yaw ${f.yaw.toFixed(2)}  pitch ${f.pitch.toFixed(2)}  roll ${((f.roll * 180) / Math.PI).toFixed(0)}°  eyes ${pct(f.eyes[0].blink)} ${pct(f.eyes[1].blink)}`);
  }
  debugEl.textContent = lines.join('\n');
}

// 촬영 순간 엔진이 본 장면: 인원, 얼굴마다 위치·켜진 표정·쓴 장식. 서버가 AI 지시문 문장으로 바꾼다
const REPORT_EXPR: ExprName[] = ['smile', 'wink', 'surprise', 'mouthOpen', 'frown', 'pucker'];
function sceneReport(th: (typeof THEMES)[number], variantId: string, w: number): SceneReport {
  return {
    people: Math.max(scene.faces.length, scene.bodies.length),
    faces: scene.faces.map((f) => ({
      x: f.center.x / w,
      expr: REPORT_EXPR.filter((n) => f.since(n) >= 0),
      decor: th.aiNames?.length ? th.aiNames[(f.index + state.mod) % th.aiNames.length] : undefined,
    })),
    variant: variantId,
  };
}

// ---------- 촬영 결과 ----------
let lastBlob: Blob | null = null;
let lastRaw: { blob: Blob; theme: string; variant: string; w: number; h: number; scene: SceneReport } | null = null;
let session: Session | null = null;

function fileName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `alterlens-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
}

function showPreview(b: Blob) {
  lastBlob = b;
  if (previewImg.src) URL.revokeObjectURL(previewImg.src);
  previewImg.src = URL.createObjectURL(b);
  const file = new File([b], fileName(), { type: 'image/jpeg' });
  $<HTMLButtonElement>('#share').hidden = !navigator.canShare?.({ files: [file] });
  preview.hidden = false;
  session = null;
  stepsEl.replaceChildren();
  chatForm.hidden = true;
  const ai = aiThemes.get(theme().id);
  aiBtn.hidden = !(catalog?.ai && ai);
  aiBtn.disabled = false;
  aiBtn.textContent = `✦ ${theme().name} 그림으로 바꾸기`;
  aiMsg.textContent = '';
}

// ---------- 테마 변환 세션: 원본 → 테마 그림 → 채팅으로 이어서 고치기 ----------
const busy = (s: Session | null) => !!s?.steps.some((st) => st.status === 'queued' || st.status === 'running');

async function showStep(s: Session) {
  const st = s.steps[s.current];
  if (!catalog || !st?.url) return;
  const blob = await (await fetch(mediaUrl(catalog, st.url))).blob();
  lastBlob = blob;
  if (previewImg.src) URL.revokeObjectURL(previewImg.src);
  previewImg.src = URL.createObjectURL(blob);
}

function renderSession(s: Session) {
  session = s;
  const last = s.steps.at(-1)!;
  const working = busy(s);
  aiBtn.hidden = true;
  chatForm.hidden = false;
  chatInput.disabled = working;
  aiMsg.textContent = working ? (last.kind === 'chat' ? `「${last.text}」 반영하는 중…` : `${s.theme.toUpperCase()} 그림으로 그리는 중…(1~3분)`) : last.status === 'failed' ? `실패: ${last.error ?? ''}` : '';
  stepsEl.replaceChildren(
    ...s.steps.map((st) => {
      const b = document.createElement('button');
      b.className = 'step' + (st.n === s.current ? ' on' : '');
      b.disabled = st.status !== 'done' || working;
      b.textContent = st.kind === 'source' ? '원본' : st.kind === 'theme' ? s.theme.toUpperCase() : st.status === 'failed' ? '실패' : st.text ?? '';
      b.title = st.text ?? '';
      b.addEventListener('click', async () => {
        if (!catalog || !session) return;
        renderSession(await setCurrent(catalog, session.id, st.n));
        await showStep(session);
      });
      return b;
    }),
  );
}

async function follow(s: Session) {
  if (!catalog) return;
  renderSession(s);
  const done = await settle(catalog, s, renderSession);
  renderSession(done);
  await showStep(done);
}

aiBtn.addEventListener('click', async () => {
  if (!catalog || !lastRaw) return;
  aiBtn.disabled = true;
  aiMsg.textContent = '보내는 중…';
  try {
    const { blob, theme: themeId, variant, scene: sc, w, h } = lastRaw;
    await follow(await createTransform(catalog, { image: blob, themeId, variant, scene: sc, w, h }));
  } catch (e) {
    aiBtn.disabled = false;
    aiMsg.textContent = (e as Error).message;
  }
});

// 결과를 보고 대화로 이어서 고친다("머리 길게", "비 오게")
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!catalog || !session || !text || busy(session)) return;
  chatInput.value = '';
  try {
    await follow(await chat(catalog, session.id, text));
  } catch (err) {
    aiMsg.textContent = (err as Error).message;
  }
});

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
    await navigator.share({ files: [file], title: 'ALTERLENS' });
  } catch {
    /* 사용자가 공유 창을 닫음 */
  }
});
$('#close').addEventListener('click', () => (preview.hidden = true));

// ---------- 조작 ----------
function hideSplash() {
  splash.classList.add('gone');
}

function selectVariant(i: number) {
  const n = theme().variants.length;
  state.variant = (i + n) % n;
  chips.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === state.variant));
}

// 테마를 바꾸면 셰이더·색 조합 칩·지원하는 토글·필요한 인식이 그 테마 것으로 바뀐다
function selectTheme(i: number) {
  state.theme = i;
  state.mod = 0;
  const th = THEMES[i];
  renderer.setTheme(th);
  themeRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === i));
  chips.replaceChildren(
    ...th.variants.map((v, k) => {
      const b = document.createElement('button');
      b.textContent = v.name;
      b.addEventListener('click', () => selectVariant(k));
      return b;
    }),
  );
  selectVariant(0);
  const fxBtn = $<HTMLButtonElement>('#t-fx');
  fxBtn.hidden = !th.effects.particles;
  fxBtn.textContent = th.effects.particles?.label ?? '';
  $('#t-glitch').hidden = !th.effects.glitch;
  $('#t-mod').hidden = th.faceMods < 2;
  th.fonts?.forEach((f) => document.fonts?.load(f, th.fontText).catch(() => {}));
  if (state.source) ensureVision();
}

// 테마 줄: 숨은 실시간 룩(plain)은 빼고, 서버 변환이 되는 테마에 ✦
function renderThemeRow() {
  const shown = THEMES.map((th, i) => ({ th, i })).filter(({ th }) => !th.hidden);
  themeRow.hidden = shown.length < 2;
  themeRow.replaceChildren(
    ...shown.map(({ th, i }) => {
      const b = document.createElement('button');
      b.dataset.i = String(i);
      b.textContent = th.name + (catalog?.ai && aiThemes.has(th.id) ? ' ✦' : '');
      b.classList.toggle('on', i === state.theme);
      b.addEventListener('click', () => selectTheme(i));
      return b;
    }),
  );
}
renderThemeRow();
selectTheme(0);

// 서버 테마: 켜진 것만 온다. 앱에 있는 테마면 AI 변환을 붙이고, 없는 테마는 live 테마의 실시간 화면을 빌려 새로 끼운다
loadCatalog().then((cat) => {
  if (!cat) return;
  catalog = cat;
  for (const r of cat.themes) {
    if (!THEMES.some((t) => t.id === r.id)) {
      const base = THEMES.find((t) => t.id === (r.live ?? 'plain'));
      if (!base) continue;
      THEMES.push({ ...base, id: r.id, name: r.name, hidden: false });
    }
    aiThemes.set(r.id, r);
  }
  renderThemeRow();
});

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
  ensureVision();
}

const pickFrom = (input: HTMLInputElement) => () => {
  const f = input.files?.[0];
  if (f) openPhoto(f).catch((e) => (splashMsg.textContent = String(e)));
  input.value = '';
};
fileInput.addEventListener('change', pickFrom(fileInput));
snapInput.addEventListener('change', pickFrom(snapInput));

$('#start').addEventListener('click', goCamera);
$('#start-photo').addEventListener('click', () => fileInput.click());
$('#start-snap').addEventListener('click', () => snapInput.click());
$('#gallery').addEventListener('click', () => fileInput.click());
$('#snap-btn').addEventListener('click', () => snapInput.click());
$('#shutter').addEventListener('click', () => {
  if (state.source) state.capture = true;
});
$('#flip').addEventListener('click', async () => {
  if (state.source === 'camera') state.facing = state.facing === 'user' ? 'environment' : 'user';
  await goCamera();
});

for (const key of ['fx', 'glitch', 'hud'] as const) {
  const b = $<HTMLButtonElement>(`#t-${key}`);
  b.classList.toggle('on', state[key]);
  b.addEventListener('click', () => {
    state[key] = !state[key];
    b.classList.toggle('on', state[key]);
  });
}

// 얼굴 장식 순환(테마가 가진 종류 수만큼)
$('#t-mod').addEventListener('click', () => (state.mod = (state.mod + 1) % theme().faceMods));

// 좌우 스와이프로 색 조합 전환
let downX: number | null = null;
view.addEventListener('pointerdown', (e) => (downX = e.clientX));
view.addEventListener('pointerup', (e) => {
  if (downX === null) return;
  const dx = e.clientX - downX;
  downX = null;
  if (Math.abs(dx) > 50) selectVariant(state.variant + (dx < 0 ? 1 : -1));
});

requestAnimationFrame(frame);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw', e));
}

takeShared().catch((e) => console.error(e));

// 이미 카메라 권한이 있으면 바로 켠다(공유로 들어온 사진이 있으면 그걸 먼저 보여 준다)
if (!params.has('shared')) {
  navigator.permissions
    ?.query({ name: 'camera' as PermissionName })
    .then((p) => {
      if (p.state === 'granted') goCamera();
    })
    .catch(() => {});
}
