/* 展示站 Service Worker —— 重复打开秒开:静态资源缓存优先,页面导航始终取最新。
   three.js / viewer / data / 图片 首次下载后走缓存,后续打开不再走网络;
   index.html 网络优先,保证部署更新能立刻可见。 */
const CACHE = 'braidloss-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 只缓存本站资源

  // 页面导航:网络优先(保证每次都是最新版本),离线时才回退缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 静态资源(JS / 图片 / 数据):缓存优先,首次下载后不再走网络
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      })
    )
  );
});
