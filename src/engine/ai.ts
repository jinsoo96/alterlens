// 서버 AI 테마: 켜져 있는 테마 목록을 받아 오고, 찍은 사진을 보내 테마로 다시 그린 결과를 받는다.
// 키·프롬프트는 서버(server/)에만 있다. 같은 출처에 API 가 없으면(GitHub Pages·아이폰 앱) 도메인 서버로 간다.

export interface RemoteTheme {
  id: string;
  name: string;
  preview: string; // 실시간 미리보기에 쓸 앱 테마 id
  photo: boolean;
  video: boolean;
  thumb: string | null;
}

export interface Catalog {
  base: string;
  ai: boolean; // 서버에 생성 공급자가 연결돼 있는지
  provider: string;
  themes: RemoteTheme[];
}

const CANDIDATES = ['', 'https://alterlens.js-96.com'];

export async function loadCatalog(): Promise<Catalog | null> {
  for (const base of CANDIDATES) {
    try {
      const r = await fetch(`${base}/api/themes`, { cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) continue;
      return { base, ...(await r.json()) };
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

export async function generatePhoto(
  cat: Catalog,
  theme: string,
  variant: string,
  image: Blob,
  w: number,
  h: number,
  onStatus: (s: string) => void,
): Promise<Blob> {
  const q = new URLSearchParams({ theme, variant, kind: 'photo', w: String(w), h: String(h) });
  const r = await fetch(`${cat.base}/api/generate?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': image.type || 'image/jpeg' },
    body: image,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  const t0 = Date.now();
  for (;;) {
    await new Promise((res) => setTimeout(res, 1500));
    const s = await (await fetch(`${cat.base}/api/jobs/${body.job}`, { cache: 'no-store' })).json();
    onStatus(s.status);
    if (s.status === 'done') return await (await fetch(`${cat.base}${s.url}`)).blob();
    if (s.status === 'failed') throw new Error(s.error ?? '변환에 실패했습니다.');
    if (Date.now() - t0 > 7 * 60_000) throw new Error('시간이 너무 오래 걸립니다.');
  }
}
