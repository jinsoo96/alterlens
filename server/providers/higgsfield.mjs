// Higgsfield REST 를 직접 쓰는 공급자(REST 키가 생기면). 지금 운영 경로는 Ailism(providers/ailism.mjs).
// 흐름: presigned 업로드 → 모델 제출(Idempotency-Key) → 상태 폴링 → 결과 다운로드. 참고 그림을 여러 장 넘길 수 있다.
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.higgsfield.ai';
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled']);

// 모델별 aspect_ratio 허용값(문서 스키마)과 참고 그림 수
const MODELS = {
  'xai/grok-imagine-image-2.0': { refs: 10, aspects: ['1:1', '1:2', '2:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'] },
  'alibaba/qwen-image-3/edit': { refs: 3, aspects: ['1:1', '2:3', '3:2', '3:4', '4:3', '7:9', '9:7', '9:16', '16:9', '21:9'] },
};

export function nearestAspect(list, w, h) {
  if (!list || !w || !h) return undefined;
  const r = Math.log(w / h);
  let best = list[0], bestD = Infinity;
  for (const a of list) {
    const [x, y] = a.split(':').map(Number);
    const d = Math.abs(Math.log(x / y) - r);
    if (d < bestD) [best, bestD] = [a, d];
  }
  return best;
}

export function higgsfield(env) {
  const id = env.HF_API_KEY_ID, secret = env.HF_API_KEY_SECRET;
  const model = env.HF_EDIT_MODEL || 'xai/grok-imagine-image-2.0';
  const spec = MODELS[model] ?? { refs: 1 };
  const auth = `Key ${id}:${secret}`;

  async function call(method, p, body, headers = {}) {
    const res = await fetch(BASE + p, {
      method,
      headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`higgsfield ${method} ${p}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }

  async function upload({ bytes, type }) {
    const u = await call('POST', '/files/generate-upload-url', { content_type: type });
    // presigned 저장소에는 우리 키를 보내지 않는다(문서 지시)
    const put = await fetch(u.upload_url, { method: 'PUT', headers: u.upload_headers, body: bytes });
    if (!put.ok) throw new Error(`upload PUT: HTTP ${put.status}`);
    return u.public_url;
  }

  async function run(endpoint, input) {
    const sub = await call('POST', `/${endpoint}`, input, { 'Idempotency-Key': randomUUID() });
    let delay = 1500;
    const deadline = Date.now() + 6 * 60 * 1000;
    for (;;) {
      const st = await call('GET', `/requests/${sub.request_id}/status`);
      if (TERMINAL.has(st.status)) {
        if (st.status !== 'completed') throw new Error(st.status === 'nsfw' ? '부적절한 이미지로 판정되었습니다.' : st.error || st.status);
        return st;
      }
      if (Date.now() > deadline) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(5000, delay * 1.4);
    }
  }

  return {
    name: 'higgsfield',
    ready: !!(id && secret),
    caps: { refs: spec.refs - 1, maxPrompt: 4000 },
    async edit({ image, refs = [], prompt, w, h }) {
      const urls = [await upload(image)];
      for (const r of refs.slice(0, spec.refs - 1)) urls.push(await upload(r));
      const st = await run(model, { prompt, image_urls: urls, aspect_ratio: nearestAspect(spec.aspects, w, h), resolution: '1k' });
      const res = await fetch(st.images[0].url);
      if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
      return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'image/png' };
    },
  };
}
