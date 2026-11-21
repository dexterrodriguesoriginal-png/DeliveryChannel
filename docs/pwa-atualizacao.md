# Atualização dos Apps Instalados (PWA) — Delivery Channel

Este documento descreve as atualizações de identidade visual e código do aplicativo de cada loja. Os aplicativos de garçom, entregador, cozinha e totem não são alterados pelo fluxo de identidade da loja.

## Manifesto canônico estável

Novas visitas a `/app/<slug>/` recebem sempre o link `/app/<slug>/manifest.webmanifest`, sem query string. O manifesto mantém:

- `id: /app-id/<tenantId>`, sem versão no identificador;
- `scope: /app/<slug>/` e `start_url: /app/<slug>/?source=pwa`;
- nome, nome curto, descrição, `theme_color` e `background_color` atuais;
- três ícones PNG separados: 192x192 com `purpose: any`, 512x512 com `purpose: any`, e 512x512 com `purpose: maskable`.

Os ícones são servidos em `/app/<slug>/icons/*.png?v=<storeIconVersion>`. O hash `?v=` é calculado a partir da identidade visual **do ícone** (logo ou fallback de iniciais), não da cor das barras, de `updated_at` ou de cada alteração genérica do tema. O manifesto continua com `Cache-Control: no-cache`; o handler dos ícones mantém sua política de cache existente.

Trocar e confirmar a logo não cria um novo manifesto, `id` ou `scope`: a URL do ícone muda via `?v=`, permitindo que o navegador reavalie o WebAPK existente. `/api/pwa/version` continua oferecendo versão do build e `identityVersion`, mas **não** `appIdentity`.

## Compatibilidade com instalações antigas

WebAPKs que já foram instalados usando `/app/<slug>~<hash10>/` continuam servidos, mesmo quando a loja não possui `appBaseLogoUrl` ou não está na lista de testes. Seu manifesto permanece em `/app/<slug>~<hash10>/manifest.webmanifest` com o **mesmo** `id: /app-id/<tenantId>/<hash10>`, `scope`, `start_url` e `related_applications` originais daquele hash. Apenas os dados atuais da loja e os ícones `?v=` acompanham mudanças.

O HTML legado injeta seu próprio manifesto. Não há redirecionamento forçado 302 para sair do scope antigo; em erro da consulta também não se redireciona. O antigo WebAPK e o canônico são instalações distintas: nenhum id é migrado.

Somente dentro de um WebAPK Android em modo standalone cujo endereço contém `~<hash10>` aparece uma faixa discreta “Há uma versão oficial deste app”, com ação “Abrir app atualizado”. Essa ação abre `/app/<slug>/` por HTTPS comum, sem `intent://` e sem `?reinstall=1`. O cliente pode instalar o canônico e, se desejar, apagar manualmente o ícone legado. Não existe mais banner automático “Baixar versão atualizada” no app estável.

## Tema e atualizações de conteúdo

`injectStoreHead` grava as meta tags iniciais de barra e esquema de cores. Quando o tema carrega ou muda, `applyStoreIdentity` / `applySystemBarMeta` atualizam `<meta name="theme-color">` em runtime, sem cores hardcoded para cada loja. O comportamento de splash/boot não foi modificado; a barra de navegação e a splash do WebAPK podem depender da próxima atualização pelo Chrome.

O Service Worker continua registrando e atualizando seu próprio código. O aviso `StoreVisualUpdateNotice` é separado do processo de atualização de ícone do WebAPK: recarregar o conteúdo não instala um aplicativo novo. HTML, manifestos e `sw.js` são revalidados.

## Comportamento por plataforma e riscos

- **Android / Chrome 144:** o WebAPK pode atualizar o ícone da mesma instalação. Para alterações visuais grandes, o Chromium pode bloquear a atualização silenciosa em torno de 11% de diferença; a opção **⋮ → Revisar atualização do app** pode aparecer. A presença do diálogo deve ser verificada no telefone com o experimento `dc-teste-notif` v1→v2. Não exibimos um hint no app estável, pois não sabemos se o WebAPK já foi atualizado.
- **Android / Chrome anterior:** verificações periódicas podem depender de condições como Wi‑Fi, alimentação ou tempo decorrido. Não há garantia de troca imediata da logo.
- **iOS / Safari:** o ícone de um PWA já instalado pode permanecer fixo e exigir remover e adicionar novamente o atalho.
- **Desktop Chrome / Edge:** o navegador pode revalidar manifesto e ícones conforme seu próprio ciclo.

Referência: [Improvements to web app updates](https://developer.chrome.com/blog/improvements-to-web-app-updates).

O teste em aparelho real continua necessário; nenhuma troca de `id` deve ser introduzida para contornar restrições do Chromium.
