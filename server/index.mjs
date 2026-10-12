// ALTERLENS 서버: 웹앱(dist) 서빙 + AI 테마 중계(API).
// 앱 → 이 서버 → 생성 공급자(Higgsfield). 키·프롬프트는 서버에만 있고, 앱은 테마 id 와 사진만 보낸다.
//
//   GET  /api/themes                     켜져 있는 AI 테마 목록 + AI 사용 가능 여부
//   POST /api/generate?theme=&variant=&kind=photo|video&w=&h=   본문 = 사진/영상 바이트 → { job }
//   GET  /api/jobs/:id                   { status: queued|running|done|failed, url?, error? }
//   GET  /api/media/:file                결과 파일(공급자 쪽은 7일 뒤 지워질 수 있어 여기에 보관)
//
// 환경변수(또는 server/.env.local): HF_API_KEY_ID · HF_API_KEY_SECRET · AI_PROVIDER(higgsfield|mock)
//   AI_PER_IP_HOUR(기본 12) · AI_DAILY(기본 100) · AI_CONCURRENCY(기본 2) · PORT(7420) · HOST(127.0.0.1)
import http from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { themeStore } from './themes.mjs';
import { higgsfield } from './providers/higgsfield.mjs';
import { mock } from './providers/mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, 'server', '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const env = process.env;
const DIST = path.join(ROOT, 'dist');
const MEDIA = path.join(ROOT, 'server', 'data', 'media');
const PORT = Number(env.PORT || 7420);
const HOST = env.HOST || '127.0.0.1';
const PER_IP_HOUR = Number(env.AI_PER_IP_HOUR || 12);
const DAILY = Number(env.AI_DAILY || 100);
const CONCURRENCY = Number(env.AI_CONCURRENCY || 2);
const MAX_BYTES = { photo: 10 * 1024 * 1024, video: 200 * 1024 * 1024 };
const ORIGINS = new Set([
  'https://alterlens.js-96.com',
  'https://jinsoo96.github.io',
  'capacitor://localhost',
  'http://localhost:7420',
  'http://localhost:5173',
]);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.mp4': 'video/mp4',
  '.task': 'application/octet-stream', '.tflite': 'application/octet-stream',
};

const themes = themeStore(path.join(ROOT, 'server', 'themes'));
const provider =
  env.AI_PROVIDER === 'mock' ? mock() : higgsfield(env);
await mkdir(MEDIA, { recursive: true });

// ---------- 작업 · 제한 ----------
const jobs = new Map(); // id → { status, url, error, created }
const hits = new Map(); // ip → [시각...]
let day = new Date().toDateString();
let dayCount = 0;
let running = 0;
const queue = [];

function allow(ip) {
  const now = Date.now();
  if (new Date().toDateString() !== day) [day, dayCount] = [new Date().toDateString(), 0];
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= PER_IP_HOUR) return '한 시간에 만들 수 있는 횟수를 넘었습니다. 잠시 뒤에 다시 해 주세요.';
  if (dayCount >= DAILY) return '오늘 AI 변환 한도를 다 썼습니다.';
  list.push(now);
  hits.set(ip, list);
  dayCount++;
  return null;
}

function schedule(task) {
  queue.push(task);
  pump();
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const task = queue.shift();
    running++;
    task().finally(() => {
      running--;
      pump();
    });
  }
}

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4' };

async function startJob({ kind, theme, variant, bytes, contentType, w, h }) {
  const id = randomUUID();
  const job = { status: 'queued', created: Date.now() };
  jobs.set(id, job);
  schedule(async () => {
    job.status = 'running';
    try {
      const out = await provider[kind]({ bytes, contentType, theme, variant, w, h });
      const file = `${id}${EXT[out.contentType.split(';')[0]] ?? '.bin'}`;
      await writeFile(path.join(MEDIA, file), out.bytes);
      Object.assign(job, { status: 'done', url: `/api/media/${file}` });
    } catch (e) {
      console.error(`job ${id}: ${e.message}`);
      Object.assign(job, { status: 'failed', error: e.message.includes('HTTP') ? '변환에 실패했습니다.' : e.message });
    }
  });
  return id;
}

// 7일 넘은 결과·작업 정리
setInterval(async () => {
  const cut = Date.now() - 7 * 86400_000;
  for (const [id, j] of jobs) if (j.created < cut) jobs.delete(id);
  for (const f of await readdir(MEDIA)) {
    const p = path.join(MEDIA, f);
    if ((await stat(p)).mtimeMs < cut) await unlink(p).catch(() => {});
  }
}, 3600_000).unref();

// ---------- HTTP ----------
function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.has(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(res, file, cache) {
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
  createReadStream(file).pipe(res);
}

async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/themes' && req.method === 'GET') {
    const list = (await themes.all()).filter((t) => t.enabled);
    return json(res, 200, { ai: provider.ready, provider: provider.name, themes: list.map(themes.publicView) });
  }
  if (p === '/api/generate' && req.method === 'POST') {
    if (!provider.ready) return json(res, 503, { error: 'AI 변환이 아직 연결되지 않았습니다.' });
    const kind = url.searchParams.get('kind') === 'video' ? 'video' : 'photo';
    const theme = await themes.get(url.searchParams.get('theme') ?? '');
    if (!theme || !theme.enabled || !theme[kind] || (kind === 'video' && !theme.video.preset_id))
      return json(res, 404, { error: '이 테마는 AI 변환을 지원하지 않습니다.' });
    const contentType = (req.headers['content-type'] ?? '').split(';')[0];
    const okType = kind === 'photo' ? ['image/jpeg', 'image/png', 'image/webp'].includes(contentType) : contentType === 'video/mp4';
    if (!okType) return json(res, 415, { error: `지원하지 않는 형식: ${contentType}` });
    const ip = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress);
    const why = allow(ip);
    if (why) return json(res, 429, { error: why });
    let bytes;
    try {
      bytes = await readBody(req, MAX_BYTES[kind]);
    } catch {
      return json(res, 413, { error: '파일이 너무 큽니다.' });
    }
    const id = await startJob({
      kind,
      theme,
      variant: url.searchParams.get('variant') ?? '',
      bytes,
      contentType,
      w: Number(url.searchParams.get('w')) || 0,
      h: Number(url.searchParams.get('h')) || 0,
    });
    return json(res, 202, { job: id });
  }
  const jm = p.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
  if (jm && req.method === 'GET') {
    const j = jobs.get(jm[1]);
    if (!j) return json(res, 404, { error: 'no such job' });
    return json(res, 200, { status: j.status, url: j.url ?? null, error: j.error ?? null });
  }
  const mm = p.match(/^\/api\/media\/([0-9a-f-]{36}\.(png|jpg|webp|mp4))$/);
  if (mm && req.method === 'GET') {
    const file = path.join(MEDIA, mm[1]);
    if (!existsSync(file)) return json(res, 404, { error: 'gone' });
    return sendFile(res, file, 'private, max-age=604800');
  }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname.startsWith('/api/')) {
      cors(req, res);
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
      return await api(req, res, url);
    }
    // 정적 파일(dist). 해시 붙은 assets·모델은 오래 캐시, index.html 은 매번 확인
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return json(res, 400, { error: 'bad path' });
    if (!existsSync(file) || !(await stat(file)).isFile()) return sendFile(res, path.join(DIST, 'index.html'), 'no-cache');
    // assets 는 파일명에 해시가 있어 영구 캐시, 모델·wasm 은 이름이 고정이라 1주
    const cache = /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable'
      : /[\\/](models|mediapipe)[\\/]/.test(file) ? 'public, max-age=604800' : 'no-cache';
    return sendFile(res, file, cache);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, HOST, () => console.log(`alterlens server http://${HOST}:${PORT} provider=${provider.name} ready=${provider.ready}`));
