/**
 * Service Worker mínimo do Delivery Channel.
 * - Não intercepta NENHUMA requisição (sem handler de fetch): /api/*, pagamentos, webhooks e outras origens vão direto à rede.
 * - Não faz cache permanente de HTML nem de manifestos (.webmanifest / manifest.json).
 * - Não faz cache de nada: HTML, manifesto e arquivos vêm sempre da rede (o app abre sempre na versão mais nova).
 * - Worker novo ativa na hora (skipWaiting + clients.claim); a página recarrega uma vez, só quando é seguro
 *   (registerSw.ts: sem checkout/campo em edição, com anti-loop). Mensagem SKIP_WAITING mantida para workers antigos.
 */

const SW_VERSION = 'dc-sw-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
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

// Sem handler de 'fetch' de propósito: ele não respondia nada, mas obrigava o Chrome a ligar o worker a cada
// abertura do app (atraso na partida a frio). Tudo vai direto à rede; /api/*, pagamentos e manifestos nunca passam pelo SW.
