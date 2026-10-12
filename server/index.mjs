// ALTERLENS 서버: 웹앱(dist) 서빙 + 테마 변환 API + 테마 스튜디오.
// 공급자 키·그림체 문장은 서버에만 있고, 앱은 테마 id · 사진 · 장면 정보만 보낸다. Ailism 앱 API 와 같은 결로 짰다.
//
// 앱 API
//   GET  /api/v1/themes                          켜진 테마(이름 · 실시간 룩 · 예시 그림)
//   POST /api/v1/transforms                      multipart: image · themeId · variant? · scene?(JSON) · w · h → 세션
//   GET  /api/v1/transforms/:id                  세션(단계: 원본 → 테마 → 채팅…, 현재 단계)
//   POST /api/v1/transforms/:id/chat             { text } 현재 그림을 대화로 이어서 고친다
//   POST /api/v1/transforms/:id/current          { step } 이전 단계로 되돌린다
//   GET  /api/v1/media/:file · /api/v1/theme-media/:theme/:file
// 테마 스튜디오(헤더 X-Studio-Token = STUDIO_TOKEN, 화면 /studio)
//   GET  /api/studio/themes                      전체 테마(꺼진 것 · 후보 포함)
//   POST /api/studio/themes                      { id, name, live, style, variants, order } 만들기·고치기
//   POST /api/studio/themes/:id/candidates       multipart: image(예시 사진) → 이 테마로 그린 후보
//   POST /api/studio/themes/:id/refs             { files } 기준 그림 고르기
//   POST /api/studio/themes/:id/enabled          { enabled } 꼈다 켰다
//
// 환경변수(또는 server/.env.local): AI_PROVIDER(ailism|higgsfield|mock) · AILISM_URL · AILISM_APP_KEY
//   HF_API_KEY_ID · HF_API_KEY_SECRET · STUDIO_TOKEN · AI_PER_IP_HOUR(6) · AI_DAILY(30) · AI_CONCURRENCY(2) · PORT · HOST
import http from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore, extOf } from './store.mjs';
import { chatPrompt, themePrompt } from './recipe.mjs';
import { ailism } from './providers/ailism.mjs';
import { higgsfield } from './providers/higgsfield.mjs';
import { mock } from './providers/mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server');
const envFile = path.join(SERVER, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const env = process.env;
const DIST = path.join(ROOT, 'dist');
const PORT = Number(env.PORT || 7420);
const HOST = env.HOST || '127.0.0.1';
const PER_IP_HOUR = Number(env.AI_PER_IP_HOUR || 6);
const DAILY = Number(env.AI_DAILY || 30);
const CONCURRENCY = Number(env.AI_CONCURRENCY || 2);
const MAX_UPLOAD = 15 * 1024 * 1024;
const ORIGINS = new Set(['https://alterlens.js-96.com', 'https://jinsoo96.github.io', 'capacitor://localhost', 'http://localhost:7420', 'http://localhost:7421', 'http://localhost:5173']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.mp4': 'video/mp4',
  '.task': 'application/octet-stream', '.tflite': 'application/octet-stream',
};

const provider = env.AI_PROVIDER === 'mock' ? mock() : env.AI_PROVIDER === 'higgsfield' ? higgsfield(env) : ailism(env);
const store = await openStore(SERVER);

// ---------- 한도 · 작업 줄 ----------
const hits = new Map();
let day = new Date().toDateString();
let dayCount = 0;
function allow(ip) {
  const now = Date.now();
  if (new Date().toDateString() !== day) [day, dayCount] = [new Date().toDateString(), 0];
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= PER_IP_HOUR) return '한 시간에 변환할 수 있는 횟수를 넘었습니다. 잠시 뒤에 다시 해 주세요.';
  if (dayCount >= DAILY) return '오늘 AI 변환 한도를 다 썼습니다.';
  list.push(now);
  hits.set(ip, list);
  dayCount++;
  return null;
}

let running = 0;
const queue = [];
function schedule(task) {
  queue.push(task);
  pump();
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const task = queue.shift();
    running++;
    task()
      .catch((e) => console.error(e))
      .finally(() => {
        running--;
        pump();
      });
  }
}

// ---------- 변환 세션 ----------
async function themeRefs(theme) {
  if (!provider.caps.refs || !theme.refs?.length) return [];
  const dir = store.themes.mediaDir(theme.id);
  const out = [];
  for (const f of theme.refs.slice(0, provider.caps.refs)) {
    const p = path.join(dir, f);
    if (existsSync(p)) out.push({ bytes: await readFile(p), type: f.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  }
  return out;
}

/** 세션의 한 단계를 줄에 넣는다. make() 가 { image, prompt, refs } 를 준비한다 */
function runStep(sessionId, n, make) {
  schedule(async () => {
    const s = await store.sessions.get(sessionId);
    const step = s.steps[n];
    step.status = 'running';
    await store.sessions.save(s);
    try {
      const { image, prompt, refs } = await make(s);
      step.prompt = prompt;
      const out = await provider.edit({ image, refs, prompt, w: s.w, h: s.h });
      const file = `${s.id}-${n}${extOf(out.type)}`;
      await store.sessions.putMedia(file, out.bytes);
      Object.assign(step, { status: 'done', file });
      s.current = n;
    } catch (e) {
      console.error(`session ${sessionId} step ${n}: ${e.message}`);
      Object.assign(step, { status: 'failed', error: e.message.includes('HTTP') ? '변환에 실패했습니다.' : e.message });
    }
    await store.sessions.save(s);
  });
}

async function stepImage(s, n) {
  const st = s.steps[n];
  return { bytes: await store.sessions.readMedia(st.file), type: st.file.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

// 서버가 다시 켜지면 하다 만 단계는 실패로 표시(다시 시도는 사용자가)
for (const f of await readdir(store.dirs.sessions)) {
  const s = await store.sessions.get(f.replace('.json', ''));
  if (!s) continue;
  let changed = false;
  for (const st of s.steps) {
    if (st.status === 'queued' || st.status === 'running') {
      Object.assign(st, { status: 'failed', error: '서버가 다시 시작되어 중단되었습니다.' });
      changed = true;
    }
  }
  if (changed) await store.sessions.save(s);
}

// 7일 넘은 세션·결과 정리
setInterval(async () => {
  const cut = Date.now() - 7 * 86400_000;
  for (const dir of [store.dirs.sessions, store.dirs.media]) {
    for (const f of await readdir(dir)) {
      const p = path.join(dir, f);
      if ((await stat(p)).mtimeMs < cut) await unlink(p).catch(() => {});
    }
  }
}, 3600_000).unref();

// ---------- 스튜디오 후보(메모리: 그리는 중인 것) ----------
const pendingCandidates = new Map(); // themeId → Map(file → { status, error })

async function studioTheme(t) {
  const dir = store.themes.mediaDir(t.id);
  const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.startsWith('cand-')) : [];
  const pending = [...(pendingCandidates.get(t.id) ?? new Map()).entries()].map(([file, v]) => ({ file, ...v }));
  return {
    ...t,
    candidates: [...files.map((file) => ({ file, status: 'done', url: `/api/v1/theme-media/${t.id}/${file}` })), ...pending],
  };
}

// ---------- HTTP 도우미 ----------
function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.has(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Studio-Token');
  }
}
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
const fail = (res, code, message) => json(res, code, { error: { code: String(code), message } });

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new Error('too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** multipart 본문을 표준 FormData 로(의존성 없이 Node 내장 Request 사용) */
async function readForm(req) {
  if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD) throw new Error('too large');
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  return new Request('http://local/', { method: 'POST', headers, body: Readable.toWeb(req), duplex: 'half' }).formData();
}

async function imageFrom(form, field = 'image') {
  const f = form.get(field);
  if (!f || typeof f === 'string') return null;
  const type = (f.type || '').split(';')[0];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error(`지원하지 않는 형식: ${type}`);
  return { bytes: Buffer.from(await f.arrayBuffer()), type };
}

function sendFile(res, file, cache) {
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
  createReadStream(file).pipe(res);
}

function studioAllowed(req) {
  const want = env.STUDIO_TOKEN;
  const got = String(req.headers['x-studio-token'] ?? '');
  return !!want && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// ---------- 앱 API ----------
async function appApi(req, res, url) {
  const p = url.pathname;
  const ip = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress);

  if (p === '/api/v1/themes' && req.method === 'GET') {
    const list = (await store.themes.all()).filter((t) => t.enabled);
    return json(res, 200, { ai: provider.ready, provider: provider.name, themes: list.map(store.themes.publicView) });
  }

  if (p === '/api/v1/transforms' && req.method === 'POST') {
    if (!provider.ready) return fail(res, 503, 'AI 변환이 아직 연결되지 않았습니다.');
    let form, image;
    try {
      form = await readForm(req);
      image = await imageFrom(form);
    } catch (e) {
      return fail(res, 400, e.message === 'too large' ? '사진이 너무 큽니다.' : e.message);
    }
    if (!image) return fail(res, 400, '사진이 없습니다.');
    const theme = await store.themes.get(String(form.get('themeId') ?? '')).catch(() => null);
    if (!theme?.enabled) return fail(res, 404, '쓸 수 없는 테마입니다.');
    const why = allow(ip);
    if (why) return fail(res, 429, why);
    let scene = null;
    try {
      scene = JSON.parse(String(form.get('scene') ?? 'null'));
    } catch {
      /* 장면 정보는 없어도 된다 */
    }
    const id = randomUUID();
    const src = `${id}-0${extOf(image.type)}`;
    await store.sessions.putMedia(src, image.bytes);
    const variant = String(form.get('variant') ?? '');
    const s = {
      id,
      theme: theme.id,
      variant,
      scene,
      w: Number(form.get('w')) || 0,
      h: Number(form.get('h')) || 0,
      created: Date.now(),
      current: 0,
      steps: [
        { n: 0, kind: 'source', status: 'done', file: src },
        { n: 1, kind: 'theme', text: theme.name, status: 'queued' },
      ],
    };
    await store.sessions.save(s);
    runStep(id, 1, async (sess) => {
      const refs = await themeRefs(theme);
      return {
        image: await stepImage(sess, 0),
        refs,
        prompt: themePrompt(theme, { variant, scene, maxLen: provider.caps.maxPrompt, withRefs: refs.length > 0 }),
      };
    });
    return json(res, 202, store.sessions.view(s));
  }

  const m = p.match(/^\/api\/v1\/transforms\/([0-9a-f-]{36})(\/chat|\/current)?$/);
  if (m) {
    const s = await store.sessions.get(m[1]);
    if (!s) return fail(res, 404, '없는 변환입니다.');
    if (!m[2] && req.method === 'GET') return json(res, 200, store.sessions.view(s));
    if (m[2] === '/chat' && req.method === 'POST') {
      const body = await readJson(req).catch(() => ({}));
      const text = String(body.text ?? '').trim();
      if (!text) return fail(res, 400, '어떻게 바꿀지 적어 주세요.');
      if (text.length > 300) return fail(res, 400, '300자 안으로 적어 주세요.');
      if (s.steps.some((st) => st.status === 'queued' || st.status === 'running')) return fail(res, 409, '앞 단계가 아직 그려지는 중입니다.');
      const why = allow(ip);
      if (why) return fail(res, 429, why);
      const theme = await store.themes.get(s.theme);
      const from = s.current;
      const n = s.steps.length;
      s.steps.push({ n, kind: 'chat', text, from, status: 'queued' });
      await store.sessions.save(s);
      runStep(s.id, n, async (sess) => ({ image: await stepImage(sess, from), refs: [], prompt: chatPrompt(theme, text, provider.caps.maxPrompt) }));
      return json(res, 202, store.sessions.view(s));
    }
    if (m[2] === '/current' && req.method === 'POST') {
      const body = await readJson(req).catch(() => ({}));
      const st = s.steps[Number(body.step)];
      if (!st || st.status !== 'done') return fail(res, 400, '그 단계로는 돌아갈 수 없습니다.');
      s.current = st.n;
      await store.sessions.save(s);
      return json(res, 200, store.sessions.view(s));
    }
  }

  const mm = p.match(/^\/api\/v1\/media\/([0-9a-f-]{36}-\d+\.(?:png|jpg|webp))$/);
  if (mm && req.method === 'GET') {
    const file = path.join(store.dirs.media, mm[1]);
    return existsSync(file) ? sendFile(res, file, 'private, max-age=604800') : fail(res, 404, 'gone');
  }
  const tm = p.match(/^\/api\/v1\/theme-media\/([a-z0-9-]{2,40})\/(cand-[0-9a-f-]{36}\.(?:png|jpg|webp))$/);
  if (tm && req.method === 'GET') {
    const file = path.join(store.themes.mediaDir(tm[1]), tm[2]);
    return existsSync(file) ? sendFile(res, file, 'public, max-age=86400') : fail(res, 404, 'gone');
  }
  return fail(res, 404, 'not found');
}

// ---------- 스튜디오 API ----------
async function studioApi(req, res, url) {
  if (!studioAllowed(req)) return fail(res, 401, '스튜디오 토큰이 필요합니다.');
  const p = url.pathname;
  if (p === '/api/studio/themes' && req.method === 'GET') {
    const all = await store.themes.all();
    return json(res, 200, { provider: provider.name, caps: provider.caps, themes: await Promise.all(all.map(studioTheme)) });
  }
  if (p === '/api/studio/themes' && req.method === 'POST') {
    const b = await readJson(req);
    const old = (await store.themes.get(String(b.id ?? '')).catch(() => null)) ?? {};
    const t = {
      ...old,
      id: String(b.id),
      name: String(b.name || b.id).toUpperCase().slice(0, 24),
      enabled: old.enabled ?? false,
      order: Number(b.order ?? old.order ?? 50),
      live: b.live ? String(b.live) : null,
      style: String(b.style ?? '').trim().slice(0, 320),
      variants: typeof b.variants === 'object' && b.variants ? b.variants : old.variants ?? {},
      refs: old.refs ?? [],
    };
    if (!t.style) return fail(res, 400, '그림체 설명(style)이 필요합니다.');
    await store.themes.save(t);
    return json(res, 200, await studioTheme(t));
  }
  const m = p.match(/^\/api\/studio\/themes\/([a-z0-9-]{2,40})\/(candidates|refs|enabled)$/);
  if (m && req.method === 'POST') {
    const t = await store.themes.get(m[1]);
    if (!t) return fail(res, 404, '없는 테마입니다.');
    if (m[2] === 'candidates') {
      let image;
      try {
        image = await imageFrom(await readForm(req));
      } catch (e) {
        return fail(res, 400, e.message === 'too large' ? '사진이 너무 큽니다(15MB 까지).' : e.message);
      }
      if (!image) return fail(res, 400, '예시 사진이 없습니다.');
      const file = `cand-${randomUUID()}.jpg`;
      const map = pendingCandidates.get(t.id) ?? new Map();
      pendingCandidates.set(t.id, map);
      map.set(file, { status: 'running' });
      schedule(async () => {
        try {
          const out = await provider.edit({ image, refs: [], prompt: themePrompt(t, { maxLen: provider.caps.maxPrompt }) });
          const dir = store.themes.mediaDir(t.id);
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, file.replace('.jpg', extOf(out.type))), out.bytes);
          map.delete(file);
        } catch (e) {
          map.set(file, { status: 'failed', error: e.message });
        }
      });
      return json(res, 202, await studioTheme(t));
    }
    const b = await readJson(req);
    if (m[2] === 'refs') {
      const dir = store.themes.mediaDir(t.id);
      t.refs = (Array.isArray(b.files) ? b.files : []).filter((f) => /^cand-[0-9a-f-]{36}\.(png|jpg|webp)$/.test(f) && existsSync(path.join(dir, f)));
    } else {
      t.enabled = !!b.enabled;
    }
    await store.themes.save(t);
    return json(res, 200, await studioTheme(t));
  }
  return fail(res, 404, 'not found');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname.startsWith('/api/')) {
      cors(req, res);
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
      return url.pathname.startsWith('/api/studio/') ? await studioApi(req, res, url) : await appApi(req, res, url);
    }
    if (url.pathname === '/studio' || url.pathname === '/studio/') return sendFile(res, path.join(SERVER, 'studio', 'index.html'), 'no-cache');
    // 정적 파일(dist). 해시 붙은 assets 는 영구, 모델·wasm 은 1주, 나머지는 매번 확인
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return fail(res, 400, 'bad path');
    if (!existsSync(file) || !(await stat(file)).isFile()) return sendFile(res, path.join(DIST, 'index.html'), 'no-cache');
    const cache = /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable'
      : /[\\/](models|mediapipe)[\\/]/.test(file) ? 'public, max-age=604800' : 'no-cache';
    return sendFile(res, file, cache);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, 'server error');
  }
});

server.listen(PORT, HOST, () => console.log(`alterlens server http://${HOST}:${PORT} provider=${provider.name} ready=${provider.ready} studio=${env.STUDIO_TOKEN ? 'on' : 'off'}`));
