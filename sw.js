// Service worker da Gosminha: funciona offline, se atualiza sozinho quando há internet e avisa das contas
const V = 'gosminha-v2';
const DATA = 'gosminha-data'; // lista de contas que a página guarda pra cá; sobrevive às atualizações
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.hostname === 'api.bcb.gov.br') return; // taxa CDI sempre da rede

  // página: tenta a versão nova, cai pro cache sem internet
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => {
      const cp = res.clone();
      caches.open(V).then(c => c.put('./index.html', cp));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  // arquivos do app e fontes: responde do cache e atualiza por trás
  if (u.origin === location.origin || /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.match(r).then(hit => {
      const net = fetch(r).then(res => {
        if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    }));
  }
});

// sincronização periódica (Android com o app instalado): avisa contas que vencem até amanhã
self.addEventListener('periodicsync', e => {
  if (e.tag === 'contas') e.waitUntil(avisar());
});

async function avisar() {
  const c = await caches.open(DATA);
  const r = await c.match('./__contas');
  if (!r) return;
  const d = await r.json();
  if (!d.on) return;
  const old = await c.match('./__avisados');
  const done = old ? await old.json() : {};
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  for (const b of d.bills) {
    const n = Math.round((new Date(b.due + 'T12:00') - new Date(today + 'T12:00')) / 864e5);
    if (n > 1 || done[b.id] === today) continue;
    const title = n < 0 ? `${b.desc} está atrasada` : n === 0 ? `${b.desc} vence hoje` : `${b.desc} vence amanhã`;
    const body = b.amount == null ? 'Toque pra ver na Gosminha' : `${b.amount.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})} · toque pra copiar o código e pagar`;
    await self.registration.showNotification(title, {body, icon: 'icons/icon-192.png', badge: 'icons/favicon-64.png', tag: 'conta-' + b.id, data: {url: './#contas'}});
    done[b.id] = today;
  }
  await c.put('./__avisados', new Response(JSON.stringify(done), {headers: {'content-type': 'application/json'}}));
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(ws => {
    const w = ws[0];
    if (w) return w.navigate(url).then(x => (x || w).focus()).catch(() => w.focus());
    return self.clients.openWindow(url);
  }));
});
