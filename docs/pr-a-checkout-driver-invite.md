# PR A — checkout, convite e app do entregador

Base: `main` em `e01349792a6cf76b2d6a0ad1e305eb2fdfab6e75`. Escopo: itens 1, 2, 3, 4, 5 e 9 do teste de 26/10/2026. Sem migrations ou alterações em `supabase/`.

- No checkout PIX/online, “Acompanhar Meus Pedidos” depende de `orders.payment_status = 'PAID'` retornado por `getCustomerOrders`, com RLS, filtro de loja e cliente autenticado. O resultado local da criação do pedido não libera o botão. O realtime e o polling já existentes passam a funcionar em todas as abas, também atualizando essa confirmação. Dinheiro/cartão na entrega mantêm o botão.
- O convite reutiliza `InstallStoreAppHint` com texto próprio do entregador e convite a cada visita enquanto não instalado. Fechar o convite permite continuar pela web. O manifesto `/driver.webmanifest`, presente no HTML inicial, usa ID/start_url `/entregador` e escopo `/entregador`.
- O redeem exige `tenantId` na resposta. `switchTenant` consulta novamente o vínculo do próprio usuário com a loja, resolve seu status e só então persiste a preferência. Um vínculo pendente/inativo em B não cai no vínculo ativo de A. Enquanto pendente, a tela usa o nome público do convite B e não carrega dados operacionais. “Atualizar” consulta a aprovação da mesma loja antes de entrar.
- A barra respeita 75 s desde o aceite e confirmação por `appinstalled`, standalone ou `getInstalledRelatedApps`. Sem confirmação, o teto é 90%. O aceite/instalação confirmado permite retomar a espera após recarga. “Abrir app” fica desabilitado durante a espera. Se a tentativa ficar no navegador, aparece “Abra pelo ícone {loja} na tela inicial do celular”; um marcador temporário em sessionStorage preserva a orientação após a navegação de fallback.
- Google está na primeira tela do convite e junto do formulário de e-mail no cadastro/login do entregador. Usa intent `driver` e retorno `/convite-entregador`, sem token no redirectTo. O token fica em sessionStorage e é removido após o redeem; não vai para localStorage ou logs. O retorno é normalizado para `/entregador/convite`, dentro do escopo do PWA, preservando code/fragmento de autenticação. A sessão existente faz o redeem, sem chamar signUp, reenviar confirmação ou criar outra conta. O vínculo de identidades para o mesmo e-mail confirmado continua sob responsabilidade do Supabase Auth.
- Pedidos recebe um ponto vermelho quando há mudança de status fora da aba. Abrir a aba marca os status como vistos; as marcas sobrevivem à recarga. O armazenamento contém apenas IDs técnicos e status, sem nome, e-mail, telefone ou endereço. A sincronização descarta respostas que chegaram após troca de conta/loja. Logs de autenticação deixam de expor perfis, e-mails, IDs de usuário e respostas brutas.

## Validação local

`npm run lint` e `npm run build` passaram. `npm test`: 133 arquivos e 1.127 testes passaram.

Os testes cobrem PIX pendente/PAID e pagamento na entrega; troca A → B, estados pendente/recusado e aprovação; Google com intent/retorno do entregador e retomada do convite; appinstalled aos 2 s sem 100% antes de 75 s; curva/teto sem confirmação; convite por visita; manifesto/escopo; orientação após abrir; ponto vermelho, leitura persistida e isolamento por loja/conta.

Checagem HTTP com o bundle de produção: `/entregador`, `/entregador/convite/<token-sintético>` e `/convite-entregador` têm um único manifesto do entregador; `/driver.webmanifest` inicia em `/entregador`; a raiz mantém o manifesto global.

## Conferência após deploy

O Supabase Auth deve permitir o retorno HTTPS `/convite-entregador` na allow-list de Redirect URLs (ou um padrão já existente que cubra essa rota). O PR não altera configurações do projeto Supabase nem o provedor Google.

No celular, conferir instalação/abertura real no Chrome Android e a orientação no Safari; fazer login Google com conta que já possui e-mail confirmado; ler o QR de B mantendo A ativa, aguardar/aprovar em B e entrar na mesma conta. Os testes locais usam respostas sintéticas, sem contas, pagamentos ou dados reais. Não houve alteração ou teste em produção.
