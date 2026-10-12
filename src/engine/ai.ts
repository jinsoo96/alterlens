// 서버 테마 변환: 켜진 테마 목록, 찍은 사진 → 테마 그림(세션), 채팅으로 이어서 고치기, 이전 단계로 되돌리기.
// 공급자 키·그림체 문장은 서버(server/)에만 있다. 같은 출처에 API 가 없으면(GitHub Pages·아이폰 앱) 도메인 서버로 간다.

export interface RemoteTheme {
  id: string;
  name: string;
  live: string | null; // 실시간 미리보기에 쓸 앱 테마 id
  examples: string[]; // 스튜디오에서 고른 기준 그림
}

export interface Catalog {
  base: string;
  ai: boolean;
  provider: string;
  themes: RemoteTheme[];
}

export interface Step {
  n: number;
  kind: 'source' | 'theme' | 'chat';
  text: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  url: string | null;
  error: string | null;
}

export interface Session {
  id: string;
  theme: string;
  status: Step['status'];
  current: number;
  steps: Step[];
}

/** 촬영 순간 엔진이 본 장면. 서버가 지시문 문장으로 바꾼다 */
export interface SceneReport {
  people: number;
  faces: { x: number; expr: string[]; decor?: string }[];
  variant: string;
}

const CANDIDATES = ['', 'https://alterlens.js-96.com'];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
  return body as T;
}

export async function loadCatalog(): Promise<Catalog | null> {
  for (const base of CANDIDATES) {
    try {
      const r = await fetch(`${base}/api/v1/themes`, { cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) continue;
      return { base, ...(await r.json()) };
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

export function createTransform(
  cat: Catalog,
  p: { image: Blob; themeId: string; variant: string; scene: SceneReport; w: number; h: number },
): Promise<Session> {
  const form = new FormData();
  form.append('image', p.image, 'photo.jpg');
  form.append('themeId', p.themeId);
  form.append('variant', p.variant);
  form.append('scene', JSON.stringify(p.scene));
  form.append('w', String(p.w));
  form.append('h', String(p.h));
  return call(`${cat.base}/api/v1/transforms`, { method: 'POST', body: form });
}

const post = (cat: Catalog, path: string, body: unknown) =>
  call<Session>(`${cat.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const chat = (cat: Catalog, id: string, text: string) => post(cat, `/api/v1/transforms/${id}/chat`, { text });
export const setCurrent = (cat: Catalog, id: string, step: number) => post(cat, `/api/v1/transforms/${id}/current`, { step });

/** 그리는 단계가 끝날 때까지 기다린다(1.5초 → 5초로 늘려 가며) */
export async function settle(cat: Catalog, s: Session, onUpdate: (s: Session) => void): Promise<Session> {
  let delay = 1500;
  const t0 = Date.now();
  while (s.steps.some((st) => st.status === 'queued' || st.status === 'running')) {
    if (Date.now() - t0 > 10 * 60_000) throw new Error('시간이 너무 오래 걸립니다.');
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(5000, delay * 1.3);
    s = await call<Session>(`${cat.base}/api/v1/transforms/${s.id}`);
    onUpdate(s);
  }
  return s;
}

export const mediaUrl = (cat: Catalog, url: string) => `${cat.base}${url}`;
