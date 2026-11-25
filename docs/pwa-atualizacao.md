# Atualização dos aplicativos instalados — Delivery Channel

## Duas instalações podem coexistir

O app de uma loja já instalada continua disponível com a identidade e o escopo de instalação que recebeu originalmente. Alterar **a imagem do ícone** ou a **cor resolvida da barra de navegação do Android** habilita uma nova instalação independente, identificada por um hash hexadecimal de dez caracteres. Não migramos nem apagamos o WebAPK antigo.

Sem uma dessas mudanças confirmadas, todos os visitantes continuam usando o manifesto estável: `/app/<slug>/manifest.webmanifest`, com `id: /app-id/<tenantId>`, `scope: /app/<slug>/` e `start_url: /app/<slug>/?source=pwa`. Não ativamos modo versionado apenas por fazer deploy ou atualizar textos, catálogo, slogan, nome (quando há logo), cor primária, do cabeçalho, da barra de status ou timestamps.

Quando o modo versionado está ativo, a identidade oficial corrente é `storeAppIdentity(store)`, calculada usando exclusivamente `storeIconVersion(store)` e `resolveSystemBars(...).nav` normalizada. O app novo tem:
- `/app/<slug>~<hash10>/`
- `id: /app-id/<tenantId>/<hash10>`
- `scope: /app/<slug>~<hash10>/`
- `start_url: /app/<slug>~<hash10>/?source=pwa`

`storeIconVersion` continua reservada para `?v=` dos PNGs, favicon, apple-touch e totem: **alterar só a cor de navegação não muda o URL da imagem**. O hash de conteúdo da logo é resolvido no servidor; o cliente consulta `/api/pwa/version` e recebe `appIdentity` apenas no modo versionado.

A primeira mudança de barra salva `theme_tokens.meta.appBaseNavColor` com a barra resolvida anterior. O campo permanece no JSON do tema e é preservado pelo comando Restaurar ao padrão. Para logo, usamos `appBaseLogoUrl` e `logoConfirmedUrl` existentes: rascunhos ainda não confirmados não liberam uma versão nova. Não há migração de banco.

## Links, QR Codes e instalação

Os códigos QR impressos e compartilhamentos continuam apontando para `/app/<slug>/`. Quando um visitante chega pelo **navegador comum**, o cliente redireciona apenas o navegador para `/app/<slug>~<hash10>/` (preservando query string) se o modo versionado estiver ativo. Apps já abertos em standalone não são redirecionados; os links de mesa (`?mesa=`) e a prévia de Design (`?preview=1`) continuam na rota original. Não há redirecionamento 302 geral do servidor.

O manifesto da rota estável nunca vira manifesto versionado: o cliente do WebAPK estável continua válido. Cada rota antiga `~hash` mantém indefinidamente seus próprios `id`, `start_url`, `scope`, `related_applications` e HTML apontando para o próprio manifesto, mesmo quando a logo atual mudou, a loja saiu de uma lista de testes ou houve falha temporária de consulta. O conteúdo atual e os ícones `?v=` podem ser atualizados sem mudar aquela identidade.

## Aviso para a versão antiga

Se o app instalado em standalone for o estável ou um `~hash` antigo e a nova versão ainda **não** tiver sido aberta naquele aparelho, mostramos apenas “Atualize para a nova versão” e a ação “Atualizar”. No Android, o caminho padrão encadeia fallbacks no **gesto do usuário**, para o cliente conseguir instalar a versão nova:

1. Tenta abrir o Chrome com a URL HTTPS `/app/<slug>~<hash10>/?instalar=1` via `window.open(url, '_blank')` (sem `noopener` na lista de recursos: com ele `window.open` devolve `null` mesmo quando a janela abre). Se a abertura funcionar, a janela atual permanece no app antigo.
2. Se a janela for bloqueada (`null`), o navegador lançar exceção, ou o app antigo continuar visível e standalone após **1,5 segundo**, não navegamos a janela atual. Mostramos o botão **Instalar**, que dispara o `beforeinstallprompt` retido, no próprio aviso.
3. Se não houver prompt nativo (ou ele for dispensado), mostramos a dica mínima “Toque em ⋮ e em Abrir no Chrome” e o botão “Copiar link” com a URL HTTPS da versão nova (o WebAPK antigo pode não ter o menu ⋮ do Chrome).

Em WebAPK do Chrome, uma navegação externa costuma abrir um **Chrome Custom Tab**, não o aplicativo Chrome completo. Essa aba herda o display-mode standalone do app antigo, então `?instalar=1` é uma **sessão explícita de instalação**: a tela de instalar aparece mesmo assim, e não gravamos `dc:app-identity:<slug>`. O toast de atualização do service worker e o aviso “Atualizar app” ficam ocultos nessa página. Não usamos a rota antiga `/atualizar-app/` nem `window.location.href` no app antigo (isso impediria o fallback e poderia registrar a identidade cedo demais).

Se o botão Instalar do aviso no app antigo dispara o `beforeinstallprompt` e o Chrome abre o `start_url` da versão nova (`?source=pwa`), uma marca curta `dc:pending-install:<slug>` permite acrescentar `?instalar=1` sem alterar o manifesto. O `start_url` do app novo instalado permanece `?source=pwa`, sem `instalar=1`. A marca some no `appinstalled` ou ao abrir de fato o app novo.

Para testes em dispositivo, o parâmetro `?modo=window|chrome-component|googlechrome-scheme` grava a chave `dc:update-open-mode` na origem atual e some do endereço. A chave aceita **somente** esses três valores, que escolhem o primeiro passo da cadeia:
- `window` (padrão): o `window.open` HTTPS acima.
- `chrome-component` (experimental): âncora temporária com intent Android VIEW/BROWSABLE, componente `com.android.chrome/com.google.android.apps.chrome.Main`, `launchFlags=0x10000000` e `S.browser_fallback_url` HTTPS.
- `googlechrome-scheme` (experimental): âncora `googlechrome://navigate?url=<URL codificada>`.

Outros valores (e a ausência do parâmetro) não alteram a chave; valores inválidos na chave voltam ao modo `window`. Não há controle visível para o usuário. Em todos os modos, se o app permanecer visível e standalone após 1,5 segundo ou estiver em webview conhecido, vale a mesma cadeia Instalar → dica do ⋮. O timer **nunca** abre outra janela sem gesto do usuário. Em iOS, a ação continua copiando a URL HTTPS, sem prometer abrir o Chrome.

A rota versionada com `?instalar=1` e hash oficial atual, **inclusive quando o display-mode diz standalone** (Custom Tab do app antigo), mostra o nome da loja e a instalação. Se houver `beforeinstallprompt`, o botão **Instalar** é a ação principal. Sem prompt (o caso usual na Custom Tab), a página mostra só: “Toque em ⋮ no canto de cima e depois em "Abrir no Chrome"”, com **Copiar link** e **Compartilhar**. Aceitar o convite nativo não confirma a instalação: aguarda `appinstalled` para “Pronto. Abra o novo app na tela do seu celular.” O sinal da versão nova só é escrito quando o cliente abre o app novo em standalone, sem `?instalar=1`.

Apenas o app oficial atual `~hash`, **aberto em standalone e sem `?instalar=1`**, grava `localStorage[dc:app-identity:<slug>] = <hash10>`. O navegador comum e a sessão `?instalar=1` nunca gravam. Depois disso, se o usuário abrir uma versão antiga, ela mostra **somente uma tela bloqueante**:

> Esta versão foi substituída. A nova versão já está instalada no seu celular. Remova esta versão e abra a nova.

A única ação é “Abrir nova versão”, link HTTPS normal para o `start_url` da instalação atual, sem intent Chrome. Nem carrinho, menu, convite de instalação, notificação visual ou toast de atualização ficam acessíveis na versão antiga.

## Compatibilidade e validação

`/api/pwa/version` continua disponibilizando a versão do build e `identityVersion` para atualizações normais. O mecanismo de CSS/tema em runtime e `theme-color` não é substituído. Ícones inválidos continuam respondendo 503 sem cache e nunca são substituídos por iniciais quando uma logo estava configurada.

**Teste obrigatório em aparelho físico:** verificar como o WebAPK abre o endereço HTTPS em uma janela/Custom Tab, se o prompt nativo funciona e se a versão nova pode coexistir com a antiga. A visibilidade do novo ícone e a captura de links dependem da versão do Android, Chrome e políticas WebAPK. A implementação do link não garante sozinha esse comportamento.
