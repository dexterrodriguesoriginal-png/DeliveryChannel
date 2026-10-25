# Pagamentos online por loja

Cada cobrança usa a autorização da loja recebedora. Não há conta intermediária da plataforma nem split. `application_fee` existe como campo reservado; a constraint e os adapters recusam valores diferentes de zero. Sem novas dependências: `node:crypto`, `fetch`, Express, Supabase e `qrcode.react` já disponíveis.

## Configuração do servidor

Copiar os nomes de `server-env.example` para o gerenciador de segredos do runtime Express. Nenhuma credencial deve ter prefixo `VITE_`. Executar o app por `npm run dev` ou pelo servidor compilado (`npm start`), pois `dev:vite` não atende a API.

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: usados apenas pelo Express. A URL pode aproveitar `VITE_SUPABASE_URL`; a chave de serviço nunca pode ser publicável.
- `PAYMENTS_PUBLIC_URL`: origem canônica HTTPS da aplicação. Em desenvolvimento local aceita HTTP em localhost/127.0.0.1. Todas as URLs de retorno são construídas no servidor.
- `PAYMENTS_ENCRYPTION_KEY`: chave aleatória de 32 bytes em hexadecimal. OAuth/refresh, InfiniteTag e token original de assinatura do PagBank são criptografados com AES-256-GCM e AAD por loja/provedor ou cobrança. Guardar backup seguro: trocar a chave sem recriptografar os registros exige reconectar as contas.
- `PAYMENTS_STATE_SECRET`: segredo aleatório de pelo menos 32 caracteres. O state contém nonce e HMAC, é consumido atomicamente uma única vez, expira em dez minutos e é vinculado ao usuário, membership, provedor e cookie HttpOnly/SameSite=Lax.
- `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`: aplicação da plataforma no Mercado Pago. `MP_TEST_TOKEN=true` solicita credenciais de teste no OAuth e usa o checkout de sandbox quando fornecido pelo provedor.
- `PAGBANK_CLIENT_ID`, `PAGBANK_CLIENT_SECRET`, `PAGBANK_PLATFORM_TOKEN`: aplicação Connect e token de autenticação da plataforma. `PAGBANK_SANDBOX=true` usa os endpoints sandbox.

O PagBank não usa um segredo HMAC inventado para esse fluxo: o `x-authenticity-token` documentado é SHA256(token original + hífen + corpo HTTP sem modificação). Por isso a cobrança guarda esse token original criptografado no schema privado, mesmo após o refresh do OAuth. A InfinitePay permanece manual e não recebe um webhook não autenticado.

Sem credenciais, os cartões mostram “Em breve” e o checkout conserva o pagamento na entrega. Sem a migration, a leitura opcional de pagamentos no painel falha de forma compatível; a API retorna indisponibilidade, sem expor erros internos.

## Cadastro no Mercado Pago

1. Criar uma aplicação em Suas integrações e configurar o produto de checkout online. Usar as permissões de leitura, escrita e acesso offline necessárias às cobranças e à renovação.
2. Cadastrar exatamente `https://SEU_DOMINIO/api/payments/oauth/mercadopago/callback` como Redirect URL e habilitar authorization code com PKCE. O servidor usa S256.
3. Configurar notificações de pagamentos (`payment`) e copiar a assinatura secreta para `MP_WEBHOOK_SECRET`. Cada cobrança/preferência envia sua URL específica: `/api/payments/webhooks/mercadopago/<uuid-da-cobranca>`.
4. Gravar Client ID/Secret somente no runtime; usar contas de teste distintas de vendedor e comprador e `MP_TEST_TOKEN=true` para homologação.
5. Em Configurações → Pagamentos online, o owner/manager conecta a conta da própria loja e escolhe a conta principal e os meios aceitos.

PIX é criado em `/v1/payments`, com total do banco, expiração de 35 minutos (acima do mínimo de 30 minutos do provedor), QR/copia e cola e chave de idempotência. Cartão usa `/checkout/preferences` (Checkout Pro). A preferência nunca conta como pagamento; a consulta recupera o pagamento, confere recebedor, referência, BRL, valor e ausência de reembolso.

## Cadastro no PagBank

1. Criar/cadastrar a aplicação Connect com o PagBank e obter Client ID, Client Secret e o token da plataforma. Concluir a homologação exigida pelo provedor antes de usar produção.
2. Cadastrar exatamente `https://SEU_DOMINIO/api/payments/oauth/pagbank/callback` como redirect URI. Usar contas e credenciais do mesmo ambiente.
3. Autorizar os escopos `payments.read payments.create checkout.create checkout.view accounts.read`. O servidor troca o código, protege os tokens e renova em `/oauth2/refresh`.
4. PIX usa `POST /orders` com `qr_codes`, valor em centavos e CPF/CNPJ do pagador. O documento só é encaminhado ao provedor para essa cobrança; não é armazenado em `order_payments` nem em logs. Cartão usa `POST /checkouts` e seu link `PAY`.
5. As URLs de notificação são enviadas na criação, inclusive `payment_notification_urls` do checkout. A URL pública completa deve ter no máximo 100 caracteres, conforme o limite do PagBank. Usar um domínio compatível; o adapter recusa URLs maiores.
6. O owner/manager conecta a conta da loja pelo mesmo painel. A confirmação exige uma cobrança `PAID` consultada com o token da loja, referência do pedido e valor/BRL compatíveis. Status `ACTIVE` ou `PAID` do checkout, isoladamente, não confirma recebimento.

## InfinitePay e PIX manual

InfinitePay: cadastrar a InfiniteTag no cartão da loja. Ela é enviada apenas ao servidor e fica criptografada no schema privado. O adapter gera `/links` diretamente para essa tag e deixa o pedido aguardando confirmação manual. A documentação pública consultada descreve `/payment_check`, mas não especifica assinatura de webhook ou autenticação da consulta vinculada à conta recebedora; esse fluxo não é usado para marcar pagamentos como recebidos automaticamente.

PIX manual: cadastrar e ativar a chave no formulário existente e conectar o cartão “Chave PIX (manual)”. O servidor reutiliza `_pix_brcode`, `_pix_ascii` e `_crc16_ccitt`, com valor do pedido e txid alfanumérico de até 25 caracteres derivado do UUID. A chave completa só aparece no BR Code destinado ao pagamento autorizado; ela não é incluída na lista de contas.

Para esses dois adapters, somente owner/manager/cashier da própria loja podem usar “Confirmar pagamento”. O cliente nunca confirma o próprio pagamento. A confirmação registra auditoria no banco.

## Concorrência e proteção

A API valida o JWT com `auth.getUser`. Configuração recebe apenas o ID de um vínculo; Express consulta o vínculo ativo do usuário, e a RPC revalida owner/manager e deriva o tenant. No checkout, o tenant vem do pedido do cliente autenticado. Seletores de loja públicos servem apenas para listar os meios disponíveis.

Reserva e confirmação bloqueiam a linha do pedido. Uma única tentativa ativa por pedido, identidade única `(provider, provider_payment_id)` e a mesma chave de idempotência impedem criação concorrente. Uma lease de 45 segundos permite recuperar chamadas interrompidas nos adapters idempotentes; InfinitePay não é recriado automaticamente quando o resultado da criação é incerto. Tokens em refresh usam uma lease no banco e single-flight no processo.

A assinatura do webhook é validada antes de consultar o status. IDs autenticados são apenas pistas para localizar o recurso na API do provedor. Nenhum `status`, valor, recebedor ou referência do corpo recebido é suficiente para marcar como pago. Consulta normal e webhook usam controles separados para um evento recente não aproveitar resultado de polling anterior ao pagamento. Comparação de assinatura usa tempo constante; MP tem tolerância temporal de cinco minutos. O corpo PagBank é preservado como bytes.

Há limites de tamanho, limites de solicitações na entrada e por usuário, cache/single-flight de consultas e limitação de memória. A entrada usa o endereço do socket, sem confiar em `X-Forwarded-For` do cliente; em múltiplas réplicas, configurar também limites no ingress de produção. Tokens, códigos OAuth e respostas brutas dos provedores não são registrados nem refletidos nas respostas. Links de checkout usam allowlist de domínio HTTPS.

RLS protege todas as cinco tabelas novas. Contas só são legíveis por owner/manager da loja; pagamentos por owner/manager/cashier. Clientes usam o endpoint autenticado com validação de posse do pedido, sem leitura direta da tabela. Nenhum papel da API, inclusive service_role, tem acesso direto às tabelas privadas; apenas a função SECURITY DEFINER com grant exclusivo para service_role manipula ciphertext. Todas as funções novas têm `SET search_path = ''`.

O trigger de pedidos bloqueia também os caminhos antigos de alteração de pagamento via browser/RPC quando existe `order_payments`. Não há bypass de login, novo módulo pago ou alteração de `tabRequiredModule`.

## Validação e limites de homologação

Os testes Vitest usam mocks dos provedores, exercitam as rotas Express por HTTP, adulteração de assinatura, rejeição de valor/moeda/referência divergentes, idempotência, criptografia por loja, OAuth de uso único e renovação. Os testes de contrato SQL verificam grants/RLS/search_path offline. `supabase/tests/payments/rls.sql` contém testes reais de permissões, isolamento entre lojas, bloqueio de acesso a tokens e vetores CRC/BR Code usando o harness N1–N6.

A migration e o rollback são propostas e não foram aplicados. Por isso os testes SQL de RLS e o ciclo real de provedores não foram executados nesta entrega. A homologação precisa de um banco descartável já preparado, credenciais das aplicações e autorizações dos vendedores. Nenhuma transação real foi enviada.

A desconexão é recusada enquanto houver cobrança automática pendente ou em criação, preservando a capacidade de conciliar o recebimento. Códigos expirados não são recriados silenciosamente; a UI orienta falar com a loja. Reembolsos/chargebacks, troca de provedor em pedido com cobrança criada, jobs de conciliação e split ficam fora deste fluxo. Os endpoints nunca transformam um pedido cancelado ou estornado em pago.

## Documentação oficial consultada

- Mercado Pago OAuth e PKCE: https://www.mercadopago.com.br/developers/en/docs/security/oauth/creation
- Gestão da autorização: https://www.mercadopago.com.br/developers/en/docs/security/oauth/management
- Gestão de autorizações de aplicações (API de usuários): https://developers.mercadolivre.com.br/en_us/getting-started/manage-your-applications
- PIX Payments API: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix
- Preferências Checkout Pro: https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/create-preference/post
- Assinatura de webhooks: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
- PagBank Connect Authorization: https://developer.pagbank.com.br/docs/connect-authorization
- Obter token: https://developer.pagbank.com.br/reference/obter-access-token
- Renovar token: https://developer.pagbank.com.br/reference/renovar-access-token
- Revogar token: https://developer.pagbank.com.br/reference/revogar-access-token
- Pedidos PIX: https://developer.pagbank.com.br/reference/criar-pedido-pedido-com-qr-code (guia indicado como depreciado, descrevendo o endpoint `/orders` ainda usado no requisito)
- Criar checkout: https://developer.pagbank.com.br/reference/criar-checkout
- Consultar checkout: https://developer.pagbank.com.br/reference/consultar-checkout
- Autenticidade de notificações: https://developer.pagbank.com.br/reference/confirmar-autenticidade-da-notificacao
- InfinitePay Checkout: https://www.infinitepay.io/checkout-documentacao
