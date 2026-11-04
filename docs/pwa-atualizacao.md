# Atualização dos Apps Instalados (PWA) — Delivery Channel

Este documento descreve como funcionam as atualizações de identidade visual (logotipo, nome, cores) e de código nos aplicativos instaláveis (Loja do Cliente, Garçom, Entregador e Cozinha).

---

## 1. Arquitetura de Manifesto e Ícones por Loja

1. **URL do manifesto estável (`/app/:slug/manifest.webmanifest`):**
   - O elemento `<link rel="manifest" href="/app/<slug>/manifest.webmanifest">` mantém sempre a **mesma URL** (sem query string variável) e o mesmo `id` (`/app-id/<tenantId>`).
   - O Chrome/Android associa o WebAPK instalado à URL exata do manifesto. Se a URL do manifesto mudasse a cada alteração de tema, o WebAPK não reconheceria a atualização.
   - O manifesto é servido com `Cache-Control: no-cache`, garantindo revalidação a cada checagem do navegador.

2. **Ícones versionados por hash da identidade (`/app/:slug/icons/:variant.png?v=<hash>`):**
   - Dentro do manifesto e nas tags `<link rel="icon">` / `<link rel="apple-touch-icon">`, as URLs dos ícones (`icon-192.png`, `icon-512.png`, `maskable-512.png`) recebem `?v=<hash>`.
   - O hash é calculado a partir do conteúdo da identidade (nome, nome curto, URL e bytes do logotipo, cores do tema/barras e `updated_at`).
   - Quando o dono troca o logotipo ou as cores da loja, o `?v=` muda automaticamente, sinalizando ao Chrome/WebAPK que os ícones foram alterados.
   - Ícones com `?v=` são servidos com `Cache-Control: public, max-age=31536000, immutable`.

3. **Atualização em Runtime no Navegador/App Aberto:**
   - Quando a identidade da loja muda, `applyStoreIdentity` atualiza imediatamente em runtime:
     - `<link rel="icon">`
     - `<link rel="apple-touch-icon">`
     - `<meta name="theme-color">`
     - `<title>` e metadados de título do app

---

## 2. Service Worker e Atualização de Versão

- O Service Worker mínimo (`/sw.js`) é registrado em `src/main.tsx` com **escopos isolados por aplicativo**:
  - Loja: `/app/<slug>/`
  - Garçom: `/garcom`
  - Entregador: `/entregador`
  - Cozinha: `/cozinha`
- Ao abrir o app, `registerPwaServiceWorker` consulta `/api/pwa/version` (`no-store`) e verifica atualizações do Service Worker.
- Quando uma nova versão está disponível, é exibido o aviso **"Nova versão disponível — atualizar"**. Ao tocar, o app envia `SKIP_WAITING` (`skipWaiting` + `clients.claim`) e recarrega na versão nova.
- **Segurança e Privacidade (LGPD):**
  - O Service Worker **não intercepta** `/api/*`, rotas de pagamento/webhooks nem chamadas a outras origens (como Supabase).
  - HTML e manifestos (`*.webmanifest`, `manifest.json`) nunca são cacheados permanentemente (`Cache-Control: no-cache`).

---

## 3. Comportamento e Limitações por Plataforma

| Plataforma | Conteúdo interno do app (cardápio, cores internas, cabeçalho) | Ícone e nome na tela inicial do aparelho |
| --- | --- | --- |
| **Android (Google Chrome / WebAPK)** | Atualiza **no próximo abrir** do app (ou imediatamente pelo aviso *"Nova versão disponível — atualizar"*). | Atualiza automaticamente em **~1–3 dias após o app ser aberto**, quando o Chrome executa o ciclo periódico de verificação do manifesto do WebAPK e detecta a nova URL `?v=<hash>` dos ícones. |
| **iPhone / iPad (iOS Safari)** | Atualiza **no próximo abrir** do app. | O iOS congela o ícone e o nome no momento em que o atalho é criado. **Só troca o ícone ou o nome na tela inicial reinstalando** (removendo o atalho antigo e adicionando novamente à Tela de Início). |
| **Desktop (Chrome / Edge)** | Atualiza **no próximo abrir** do app. | Atualiza após o navegador revalidar o manifesto ao abrir o app. |
