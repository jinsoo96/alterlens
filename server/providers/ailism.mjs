// Ailism(CocoRoF, https://ailism.memo-ora.com) 앱 API 를 통해 Higgsfield 로 편집한다.
// 실제 결제·크레딧은 Ailism 쪽 Higgsfield(현재 CLI 구독)를 쓴다. 우리는 앱과 같은 공개 API 만 부른다.
// 지금 Ailism 은 사진 한 장 + 지시문(500자)만 받으므로 참고 그림(refs)은 0장으로 알린다.
const TERMINAL = new Set(['completed', 'failed', 'rejected']);

export function ailism(env) {
  const base = (env.AILISM_URL || 'https://ailism.memo-ora.com').replace(/\/+$/, '');
  const headers = {
    'X-Device-Id': env.AILISM_DEVICE_ID || 'alterlens-dev-server',
    'X-Platform': 'web',
    'X-App-Version': 'alterlens-0.3',
    'Accept-Language': 'ko',
    ...(env.AILISM_APP_KEY ? { 'x-app-key': env.AILISM_APP_KEY } : {}),
  };

  async function json(res) {
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(body?.error?.message || `ailism HTTP ${res.status}`);
    return body;
  }

  return {
    name: 'ailism',
    ready: true,
    caps: { refs: 0, maxPrompt: 500 },

    async edit({ image, prompt }) {
      const form = new FormData();
      form.append('presetId', env.AILISM_PRESET || 'custom');
      form.append('instruction', prompt.slice(0, 500));
      form.append('image', new Blob([image.bytes], { type: image.type }), 'photo.jpg');
      const job = await json(await fetch(`${base}/api/v1/transforms`, { method: 'POST', headers, body: form }));
      let delay = 2000;
      const deadline = Date.now() + 10 * 60 * 1000;
      for (;;) {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(6000, delay * 1.3);
        const st = await json(await fetch(`${base}/api/v1/transforms/${job.id}`, { headers }));
        if (TERMINAL.has(st.status)) {
          if (st.status !== 'completed') throw new Error(st.error?.message || st.status);
          const res = await fetch(st.result_url ?? st.resultUrl);
          if (!res.ok) throw new Error(`ailism media HTTP ${res.status}`);
          return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'image/jpeg' };
        }
        if (Date.now() > deadline) throw new Error('timeout');
      }
    },
  };
}
