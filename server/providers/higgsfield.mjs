// Higgsfield API 어댑터 (https://docs.higgsfield.ai)
// 흐름: 입력 업로드(presigned URL) → 모델 엔드포인트에 제출 → 상태 폴링 → 결과 다운로드.
// 키는 서버에만 둔다(HF_API_KEY_ID · HF_API_KEY_SECRET). 앱(브라우저)으로 내보내지 않는다.
import { randomUUID } from 'node:crypto';

const BASE = 'https://api.higgsfield.ai';
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled']);

// 모델별 aspect_ratio 허용값(문서 스키마). 사진 비율에 가장 가까운 것을 고른다
const ASPECTS = {
  'alibaba/qwen-image-3/edit': ['1:1', '2:3', '3:2', '3:4', '4:3', '7:9', '9:7', '9:16', '16:9', '21:9'],
  'xai/grok-imagine-image-2.0': ['1:1', '1:2', '2:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
};

export function nearestAspect(model, w, h) {
  const list = ASPECTS[model];
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

  async function upload(bytes, contentType) {
    const u = await call('POST', '/files/generate-upload-url', { content_type: contentType });
    // presigned 저장소에는 우리 키를 보내지 않는다(문서 지시)
    const put = await fetch(u.upload_url, { method: 'PUT', headers: u.upload_headers, body: bytes });
    if (!put.ok) throw new Error(`upload PUT: HTTP ${put.status}`);
    return u.public_url;
  }

  async function run(model, input, signal) {
    const sub = await call('POST', `/${model}`, input, { 'Idempotency-Key': randomUUID() });
    let delay = 1500;
    const deadline = Date.now() + 6 * 60 * 1000;
    for (;;) {
      if (signal?.aborted) throw new Error('aborted');
      const st = await call('GET', `/requests/${sub.request_id}/status`);
      if (TERMINAL.has(st.status)) {
        if (st.status !== 'completed') throw new Error(st.status === 'nsfw' ? '부적절한 이미지로 판정되어 생성되지 않았습니다.' : st.error || st.status);
        return st;
      }
      if (Date.now() > deadline) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(5000, delay * 1.4);
    }
  }

  async function download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download: HTTP ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/png' };
  }

  return {
    name: 'higgsfield',
    ready: !!(id && secret),

    /** 사진 → 테마 사진. theme.photo: { model, prompt, negative_prompt?, params?, variants?, style_refs? } */
    async photo({ bytes, contentType, theme, variant, w, h }) {
      const cfg = theme.photo;
      const src = await upload(bytes, contentType);
      const hint = (variant && cfg.variants?.[variant]) || '';
      const input = {
        prompt: [cfg.prompt, hint].filter(Boolean).join(' '),
        image_urls: [src, ...(cfg.style_refs ?? [])],
        ...(cfg.negative_prompt ? { negative_prompt: cfg.negative_prompt } : {}),
        ...(nearestAspect(cfg.model, w, h) ? { aspect_ratio: nearestAspect(cfg.model, w, h) } : {}),
        ...(cfg.params ?? {}),
      };
      const st = await run(cfg.model, input);
      return download(st.images[0].url);
    },

    /** 영상 → 테마 영상(Genjutsu Restyle). theme.video: { model, preset_id, prompt?, params? }. mp4 만 올릴 수 있다 */
    async video({ bytes, contentType, theme }) {
      const cfg = theme.video;
      const src = await upload(bytes, contentType);
      const st = await run(cfg.model, { video_url: src, preset_id: cfg.preset_id, prompt: cfg.prompt ?? '', image_urls: [], ...(cfg.params ?? {}) });
      return download(st.video.url);
    },

    /** Restyle 스타일 목록(테마 후보) */
    presets: () => call('GET', '/models/higgsfield/genjutsu/restyle/v1.0/presets'),

    /** 비용 미리보기(제출 전) */
    estimate: (model, input) => call('POST', `/estimate/${model}`, input),
  };
}
