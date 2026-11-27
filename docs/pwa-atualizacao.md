# PWA — identidade e atualização da loja (CG-5)

## Identidades coexistentes e escopo

O app estável de cada loja mantém `/app/<slug>/`, manifesto com `id: /app-id/<tenantId>` e escopo `/app/<slug>/` (barra final). Uma alteração **confirmada** da imagem do ícone ou da cor resolvida da barra de navegação habilita uma versão separada `/app/<slug>~<hash10>/`, manifesto com `id: /app-id/<tenantId>/<hash10>` e escopo `/app/<slug>~<hash10>/`, também com barra final. Novos layouts, produtos, nome, cor primária e cabeçalho não geram novas instalações; atualizam os dados da mesma loja. O hash do ícone usado nos arquivos PNG continua independente da identidade de instalação.

A versão antiga e a nova podem coexistir sem apagar o WebAPK antigo. Os manifestos das versões já instaladas preservam seu próprio `id`, `start_url` e `scope`. O `start_url` oficial continua `/app/<slug>~<hash10>/?source=pwa` — sem parâmetros de atualização. Não há migração de banco e nada altera o manifesto do PDV, totem, entregador, garçom ou cozinha.

## Jornada CG-5 — app instalado desatualizado

O **app antigo permanece standalone**, no próprio escopo, sem redirecionamento automático mesmo após mudança de logo ou barra. A vitrine continua disponível para compras.

Quando a identidade oficial difere da instalada (inclusive no app estável legado), a home exibe um aviso compacto no topo: **Nova versão da loja disponível** e **Baixar nova versão**. Não aparece durante instalação recente (TTL de `readJustInstalled`), prévia, mesa, sessões de instalação/atualização, checkout, modais, formulários ou outras abas. Fechar no X adia o aviso por 240.000 ms (4 minutos), persistidos por loja e identidade oficial no localStorage. Ao vencer o prazo, o aviso retorna quando a home estiver livre.

**Somente o clique** em Baixar nova versão navega para:

```text
/app/<slug>~<hashAtual>/?atualizar=1
```

O destino fora do escopo pode abrir uma Chrome Custom Tab no Android, com o catálogo completo e guia de atualização. Não é obrigatório instalar para comprar.

**QR Codes e links públicos** continuam apontando para `/app/<slug>/`. O servidor preserva o 302 no-store na primeira visita elegível do navegador, antes do manifesto; `?source=pwa` permanece 200. O navegador comum em hash antigo continua indo ao oficial sem `atualizar=1`. O helper `versionedStoreRedirect` sempre retorna null em standalone.

Na sessão `?atualizar=1`:
- O catálogo funciona normalmente, sem `AppIdentityUpdate` nem `VersionInstallScreen` como destino.
- O toast de atualização SW e o aviso visual interno não aparecem; o cliente não recebe outro banner de versão antiga.
- O sinal `localStorage[dc:app-identity:<slug>]` **não** é escrito, mesmo se a Custom Tab herdar `display-mode: standalone`. A identidade nova é registrada apenas quando o WebAPK oficial é aberto de verdade, em standalone, sem `?instalar=1` nem `?atualizar=1`.
- O guia **Como atualizar** abre automaticamente; a faixa discreta **Atualizar** permite reabri-lo. Fechar volta ao cardápio sem perder a compra.

## Guia pelo menu ⋮

O guia mostra uma seta CSS animada apontando para o canto superior direito, sem animação quando `prefers-reduced-motion` pede redução. Informa o procedimento:

1. Na Custom Tab: **Toque nos 3 pontinhos (⋮) no canto de cima e depois em "Abrir no Chrome".** No Chrome completo: **Toque nos 3 pontinhos (⋮) no canto de cima.**
2. **Depois toque em "Instalar aplicativo" ou "Adicionar à tela inicial".**

**Vão aparecer duas opções: Instalar ou Criar atalho. Toque em Instalar.** Quando existe um `beforeinstallprompt` capturado, o guia também oferece **Instalar** diretamente; na Custom Tab esse evento geralmente não está disponível, e o caminho pelo menu ⋮ é o principal. O modal fecha por X/Fechar, Escape ou toque no fundo.

Não usamos `intent://`, `googlechrome://`, `window.open`, `?instalar=1` nem `?reinstall=1` no **clique de atualização CG-5**. Os componentes/experimentos do antigo fluxo podem continuar no código para compatibilidade, mas não são montados para essa jornada.

## Apresentação personalizada da loja

A abertura do lojista continua opcional, protegida pelo módulo `store_presentation` e com duração/controle de sessão definidos em `presentation.ts`. É independente do splash nativo, de `bootScreen.ts`, `#store-boot` e `#dc-boot`.

- **Vídeo** tenta reproduzir automaticamente **com som**. Se a política de autoplay rejeitar, tenta novamente **mudo**. Se as duas tentativas falharem, se a mídia der erro ou se não começar em 1,5 s, abre a vitrine sem travar.
- Reproduz até terminar ou até o teto de 10 s; o fade é preservado.
- **Imagem** mantém seu tempo definido; com movimento reduzido, o plano STILL permanece sem áudio.
- Não há botão **Pular**, controle de áudio, barras de progresso ou controles de vídeo.

## Segurança e testes reais

O roteamento permanece exclusivo do `ClientApp` de `/app/<slug>/` sem `?mesa=`. Totem, garçom, KDS, cardápio de mesa, PDV e entregador têm fluxos próprios. O `tenantId` de pedidos e pagamentos nunca é substituído pelo hash visual.

**Validar obrigatoriamente em Android físico:** abertura do WebAPK antigo sem sair do standalone após mudança real de logo/barra; aviso recorrente após quatro minutos; Custom Tab no catálogo completo somente após clique; compra possível sem atualização; guia ⋮ → Abrir no Chrome → Instalar (não Criar atalho); app recém-instalado funcionando sem aviso; duas versões coexistindo; vídeo com áudio quando permitido e fallback mudo quando bloqueado. O navegador pode não permitir áudio no autoplay: não é possível garantir som sem uma interação do usuário.
