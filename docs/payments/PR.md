# feat: pagamentos por loja com proteção LGPD e retenção fiscal

Cada loja pode conectar Mercado Pago, PagBank ou InfinitePay em Configurações → Pagamentos online, além de usar chave PIX manual. Os meios habilitados aparecem no checkout; o pagamento vai para a conta da loja, com PIX em QR/copia e cola, contador e atualização do status. O pagamento na entrega continua disponível. Split permanece desligado.

Mercado Pago e PagBank usam OAuth por loja, renovação automática e confirmação pela API com referência, valor e moeda do pedido. Webhooks autenticados apenas iniciam a consulta; o corpo não confirma recebimento. InfinitePay usa o fallback de confirmação manual porque a documentação pública consultada não especifica autenticação da consulta ou assinatura de webhook. Confirmação manual está restrita à equipe autorizada da loja.

## Segurança e banco

- Credenciais AES-256-GCM no schema `private`, sem acesso direto de anon/authenticated/service_role; apenas gateway SECURITY DEFINER restrito a service_role, com `search_path = ''`.
- Tenant derivado de membership validada ou do pedido autorizado; nenhum tenant/valor/status vindo do cliente é aceito como autoridade.
- RLS nas cinco tabelas da migration 039 e no bloqueio privado de religação da 040; owner/manager leem contas, equipe autorizada lê pagamentos. Identidade única por provedor/pagamento, reserva por pedido, leases e confirmação transacional idempotente.
- Assinaturas MP/PagBank, proteção de OAuth com PKCE/state de uso único/cookie, limites de solicitações e de payload, erros sem segredos e bloqueio dos caminhos antigos de confirmação de pagamentos online.
- Migrations propostas `20261024003900_store_online_payments.sql` e `20261024004000_payment_privacy_retention.sql`, cada uma com rollback separado. Nenhuma migration foi aplicada. Assets proibidos e migrations anteriores não foram alterados. Sem novas dependências do projeto e sem alterar o gating de módulos ou os planos.

## Validação

- `npm run lint`: passou.
- `npm test`: 1.068 testes passaram, em 124 arquivos (949 anteriores + 119 novos; 24 testes adicionais nesta revisão LGPD).
- `npm run build`: passou.
- As duas migrations e seus rollbacks passaram pela validação sintática SQL/PLpgSQL, sem execução no banco. A migration 040 tem 44 comandos e 13 funções; o roteiro SQL LGPD também foi validado sintaticamente.
- RLS/grants/search_path têm testes de contrato offline e roteiro SQL real em `supabase/tests/payments/rls.sql`. Os roteiros SQL não foram executados, pois as migrations não foram aplicadas.
- Provedores testados com mocks. Homologação OAuth/checkout/webhook real depende de credenciais e contas de teste, não disponibilizadas nesta sessão.

## Requisitos LGPD

- **Minimização:** somente checkout hospedado para cartão; API rejeita dados de cartão, inclusive aninhados. Somente PIX recebe os dados exigidos pelo provedor; não encaminha CPF/CNPJ para cartão ou InfinitePay. As consultas de status/webhook não leem nome/e-mail do pedido.
- **Webhooks e persistência:** corpo usado apenas em memória para assinatura, sobrescrito ao final. Projeções explícitas guardam identificadores técnicos, status normalizado, valor e método; não persistem payload bruto, pagador ou detalhes de cartão. QR/link são descartados ao confirmar/expirar.
- **Retenção fiscal:** cinco anos desde pagamento/criação; depois anonimização dos vínculos, sem apagar valor, status, método e datas. Worker diário em lotes, executado no Express e disponível em `npm run payments:retention` para scheduler da infraestrutura. O agendamento externo não foi provisionado nesta sessão.
- **Exclusões:** solicitação processada, exclusão física do usuário ou desvinculação/exclusão do cliente anonimizam o vínculo pessoal do pagamento. Exclusão física/lógica da loja e desconexão apagam OAuth/refresh, credenciais de webhook e autorizações pendentes na mesma transação. Callbacks/refresh em andamento não podem recriar os tokens.
- **Transparência:** Política de Privacidade e Termos do Lojista identificam Mercado Pago, PagBank e InfinitePay, finalidades, operadores/controladores independentes e bases legais de execução de contrato (art. 7º, V) e obrigação legal (art. 7º, II). Versão `2026-10-24.2` exige reaceite; histórico preservado.
- **Logs:** somente eventos fixos/contagens; sem dados pessoais, tokens, query strings, headers, payloads ou exceções brutas. Orientação de configuração equivalente para ingress/APM.
- **Testes:** minimização, bloqueio de cartão, projeção de armazenamento, limpeza do corpo, logs, worker, disputa entre desconexão/OAuth/refresh, documentos legais e contratos SQL. Roteiro SQL real em `supabase/tests/payments/privacy.sql`; não executado porque as migrations não foram aplicadas.

## Variáveis de ambiente (somente Express)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENTS_PUBLIC_URL`, `PAYMENTS_ENCRYPTION_KEY` (32 bytes em hexadecimal), `PAYMENTS_STATE_SECRET` (mínimo 32 caracteres), `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`, `MP_TEST_TOKEN` (opcional), `PAGBANK_CLIENT_ID`, `PAGBANK_CLIENT_SECRET`, `PAGBANK_PLATFORM_TOKEN`, `PAGBANK_SANDBOX` (opcional).

Não usar prefixo `VITE_` nas credenciais. PagBank usa o token original da cobrança para validar `x-authenticity-token`; não há segredo HMAC adicional nesse fluxo. Sem configuração, o provedor mostra “Em breve”. Exemplo sem valores em `docs/payments/server-env.example`.

## Cadastrar as aplicações

1. **Mercado Pago:** criar a aplicação em Suas integrações, configurar checkout online e permissões de leitura/escrita/acesso offline, cadastrar `https://SEU_DOMINIO/api/payments/oauth/mercadopago/callback`, habilitar authorization code + PKCE S256, ativar eventos `payment` e copiar a assinatura para `MP_WEBHOOK_SECRET`. Usar vendedor/comprador de teste distintos e `MP_TEST_TOKEN=true` na homologação.
2. **PagBank:** cadastrar a aplicação Connect, obter Client ID/Secret e token da plataforma, cadastrar `https://SEU_DOMINIO/api/payments/oauth/pagbank/callback`, habilitar `payments.read payments.create checkout.create checkout.view accounts.read` e concluir a homologação do provedor. Usar `PAGBANK_SANDBOX=true` com credenciais sandbox. Cada cobrança envia a URL de webhook, limitada a 100 caracteres pelo PagBank.
3. O owner/manager conecta **a conta da própria loja** pelo painel. Depois escolhe principal e meios aceitos. PIX PagBank solicita CPF/CNPJ do pagador. InfinitePay solicita InfiniteTag, protegida no servidor; PIX manual aproveita o cadastro existente.

Detalhes operacionais, recuperação e limites em `docs/payments/README.md`. A desconexão apaga imediatamente as credenciais, inclusive com cobranças pendentes; cobranças expiradas ou criação InfinitePay de resultado incerto exigem conciliação, sem recriação silenciosa. Reembolsos/chargebacks e jobs de conciliação estão fora deste fluxo.

## Documentação oficial


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


- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Privacidade Mercado Pago: https://www.mercadopago.com.br/privacidade
- Privacidade/direitos PagBank: https://faq.pagbank.com.br/duvida/lgpd-como-solicitar-a-anonimizacao-dos-dados/1727
- Privacidade InfinitePay: https://www.infinitepay.io/legal/aviso-de-privacidade

## Arquivos alterados

- `docs/payments/PR.md`
- `docs/payments/README.md`
- `docs/payments/server-env.example`
- `package.json`
- `server.ts`
- `server/payments/__tests__/adapters.test.ts`
- `server/payments/__tests__/migration.test.ts`
- `server/payments/__tests__/privacy.test.ts`
- `server/payments/__tests__/routes.test.ts`
- `server/payments/__tests__/service.test.ts`
- `server/payments/http.ts`
- `server/payments/infinitepay.ts`
- `server/payments/manualPix.ts`
- `server/payments/mercadopago.ts`
- `server/payments/pagbank.ts`
- `server/payments/privacy.ts`
- `server/payments/retention.ts`
- `server/payments/routes.ts`
- `server/payments/runRetention.ts`
- `server/payments/security.ts`
- `server/payments/service.ts`
- `server/payments/store.ts`
- `server/payments/types.ts`
- `src/components/client/OnlineOrderPaymentPanel.tsx`
- `src/components/client/OnlinePaymentOptions.tsx`
- `src/components/establishment/CompactOrderCard.tsx`
- `src/components/establishment/KanbanOrderCard.tsx`
- `src/components/establishment/OnlinePaymentBadge.tsx`
- `src/components/establishment/OnlinePaymentSettings.tsx`
- `src/components/establishment/OrderCard.tsx`
- `src/lib/legal/documents.ts`
- `src/pages/client/ClientApp.tsx`
- `src/pages/establishment/OrdersPage.tsx`
- `src/pages/establishment/SettingsPage.tsx`
- `src/repositories/__tests__/feedbackLegalMigrations.test.ts`
- `src/repositories/orderRepository.ts`
- `src/repositories/paymentRepository.ts`
- `src/types/index.ts`
- `supabase/migrations/20261024003900_store_online_payments.sql`
- `supabase/migrations/20261024004000_payment_privacy_retention.sql`
- `supabase/rollback/20261024003900_store_online_payments_down.sql`
- `supabase/rollback/20261024004000_payment_privacy_retention_down.sql`
- `supabase/tests/payments/privacy.sql`
- `supabase/tests/payments/rls.sql`
