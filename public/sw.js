// ALTERLENS 서비스 워커
// 1) 공유 받기: 폰 카메라·갤러리에서 "공유 → ALTERLENS" 하면 manifest share_target 이 여기로 POST 한다.
//    사진을 캐시에 넣어 두고 ./?shared=1 로 넘기면 앱이 꺼내 테마를 입힌다.
// 2) 모델·wasm(수십 MB)은 한 번 받으면 캐시에서 바로 쓴다.
const SHARE = 'alterlens-share';
const ASSETS = 'alterlens-assets-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(
      (async () => {
        const form = await e.request.formData();
        const file = form.get('image');
        if (file) {
          const cache = await caches.open(SHARE);
          await cache.put('shared-image', new Response(file, { headers: { 'content-type': file.type || 'image/jpeg' } }));
        }
        return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
      })(),
    );
    return;
  }
  if (e.request.method === 'GET' && /\/(models|mediapipe)\//.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }),
    );
  }
});
