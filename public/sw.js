/**
 * Service Worker mínimo do Delivery Channel.
 * - Não intercepta /api/*, pagamentos, webhooks nem requisições de outras origens.
 * - Não faz cache permanente de HTML nem de manifestos (.webmanifest / manifest.json).
 * - Atualiza mediante comando explícito do usuário (mensagem SKIP_WAITING -> skipWaiting + clients.claim).
 */

const SW_VERSION = 'dc-sw-v1';

self.addEventListener('install', () => {
  // Permanece em waiting até o comando SKIP_WAITING do usuário quando já existe controller ativo.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== SW_VERSION).map((k) => caches.delete(k)));
      }
      await self.clients.claim();
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) {
        client.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Nunca interceptar outras origens (Supabase, provedores de pagamento, mapas, fontes)
  if (url.origin !== self.location.origin) return;

  // Nunca interceptar /api/* nem fluxos de pagamento
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/payments') ||
    url.pathname.includes('/webhooks')
  ) {
    return;
  }

  // Nunca cachear HTML, manifestos ou o próprio SW para sempre
  if (
    req.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.webmanifest') ||
    url.pathname.endsWith('manifest.json') ||
    url.pathname.endsWith('/sw.js')
  ) {
    return;
  }
});
