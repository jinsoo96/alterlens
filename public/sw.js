// ALTERLENS 서비스 워커
// 1) 공유 받기: 폰 카메라·갤러리에서 "공유 → ALTERLENS" 하면 manifest share_target 이 여기로 POST 한다.
//    사진을 캐시에 넣어 두고 ./?shared=1 로 넘기면 앱이 꺼내 테마를 입힌다.
// 2) 인식 모델(수십 MB)은 한 번 받으면 캐시에서 바로 쓴다. wasm 은 넣지 않는다: 워커를 거치면 브라우저의
//    wasm 스트리밍 컴파일이 "body loading aborted" 로 끊긴다(서버가 1주 캐시 헤더를 주므로 HTTP 캐시로 충분).
const SHARE = 'alterlens-share';
const ASSETS = 'alterlens-assets-v2';

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
  if (e.request.method === 'GET' && /\/models\//.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        // 캐시 저장이 끝날 때까지 워커를 살려 둔다
        if (res.ok) e.waitUntil(cache.put(e.request, res.clone()));
        return res;
      }),
    );
  }
});
