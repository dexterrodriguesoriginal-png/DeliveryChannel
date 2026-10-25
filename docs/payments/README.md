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

RLS protege as cinco tabelas da migration 039 e a tabela privada de bloqueio de religação da migration 040. Contas só são legíveis por owner/manager da loja; pagamentos por owner/manager/cashier. Clientes usam o endpoint autenticado com validação de posse do pedido, sem leitura direta da tabela. Nenhum papel da API, inclusive service_role, tem acesso direto às tabelas privadas; apenas a função SECURITY DEFINER com grant exclusivo para service_role manipula ciphertext. Todas as funções novas têm `SET search_path = ''`.

O trigger de pedidos bloqueia também os caminhos antigos de alteração de pagamento via browser/RPC quando existe `order_payments`. Não há bypass de login, novo módulo pago ou alteração de `tabRequiredModule`.

## Validação e limites de homologação

Os testes Vitest usam mocks dos provedores, exercitam as rotas Express por HTTP, adulteração de assinatura, rejeição de valor/moeda/referência divergentes, idempotência, criptografia por loja, OAuth de uso único e renovação. Os testes de contrato SQL verificam grants/RLS/search_path offline. `supabase/tests/payments/rls.sql` contém testes reais de permissões, isolamento entre lojas, bloqueio de acesso a tokens e vetores CRC/BR Code usando o harness N1–N6.

A migration e o rollback são propostas e não foram aplicados. Por isso os testes SQL de RLS e o ciclo real de provedores não foram executados nesta entrega. A homologação precisa de um banco descartável já preparado, credenciais das aplicações e autorizações dos vendedores. Nenhuma transação real foi enviada.

A desconexão apaga imediatamente as credenciais e invalida autorizações pendentes, mesmo com cobranças em aberto. A confirmação automática dessas cobranças é interrompida; o lojista deve conciliá-las no provedor. A revogação remota é tentada depois da exclusão local, sem impedir esta exclusão caso o provedor esteja indisponível. Códigos expirados não são recriados silenciosamente; a UI orienta falar com a loja. Reembolsos/chargebacks, troca de provedor em pedido com cobrança criada, jobs de conciliação e split ficam fora deste fluxo. Os endpoints nunca transformam um pedido cancelado ou estornado em pago.

## LGPD: minimização, retenção e exclusão

A migration adicional `20261024004000_payment_privacy_retention.sql`, com rollback separado, estende a 039; nenhuma das duas foi aplicada nesta entrega. A versão dos termos/política passa a `2026-10-24.2` tanto na UI como no banco, sem apagar o histórico de aceites. O deploy deve acompanhar a revisão e aplicação das migrations pelo responsável pelo banco.

Cartão só é preenchido no checkout hospedado: a API recusa campos de cartão, PAN, CVV/CVC e validade, inclusive aninhados. Os adapters de cartão e InfinitePay não recebem dados pessoais do pagador. Apenas PIX recebe o e-mail exigido pelo Mercado Pago ou nome/e-mail/documento exigidos pelo PagBank. CPF/CNPJ não é enviado para cartão, InfinitePay ou PIX manual. A leitura de nome/e-mail do pedido é restrita à criação PIX que os necessita; consulta de status e webhook não leem esses campos.

A persistência usa projeções explícitas de cobrança/confirmação. Respostas extras do provedor, dados de cartão/pagador e o corpo do webhook são descartados. O corpo original fica temporariamente na memória para verificar a assinatura e é sobrescrito ao terminar a requisição. `raw_status` aceita somente códigos conhecidos; texto livre é substituído por `unknown`. Códigos PIX e links são removidos após a confirmação/expiração, sem guardar o payload da notificação. O token original de assinatura PagBank pode ser usado para retries autenticados por até sete dias após pagamento, sendo sempre apagado imediatamente na desconexão, exclusão da loja ou anonimização do pagamento.

O prazo fiscal configurado é de cinco anos civis desde `paid_at` ou, para cobrança não confirmada, desde `created_at`. A rotina `anonymize_expired_payments` usa o relógio do banco e lotes com `SKIP LOCKED`. Depois do prazo remove vínculos com pedido/loja/provedor, instruções de cobrança e tokens associados; preserva valor, método, status e datas financeiras. Não exclui o registro financeiro. A tabela privada `payment_erased_orders` guarda apenas pedidos impedidos de receber novo vínculo, sem associação a cliente ou registro de pagamento.

No processamento de uma solicitação de exclusão (`PROCESSED`), na exclusão física em `auth.users` ou ao excluir/desvincular o cadastro do cliente, triggers removem o vínculo pessoal em `order_payments` e os dados de acesso à cobrança, preservando valor e data. A solicitação `PENDING` continua usando a fila de processamento existente; não declara uma exclusão concluída. A loja ainda pode consultar os dados financeiros mínimos até o prazo fiscal. Na exclusão física ou lógica (`INACTIVE`) da loja, as credenciais e autorizações são apagadas na mesma transação, e o livro financeiro é desvinculado sem ser apagado.

A exclusão local de tokens acontece antes de qualquer tentativa de revogação remota. O versionamento da conexão impede que um callback OAuth em andamento recrie credenciais após desconectar. A renovação usa comparação do ciphertext anterior para não sobrescrever uma conexão nova ou ressuscitar um token removido.

O Express executa a manutenção ao iniciar e a cada 24 horas, com no máximo dez lotes por execução, sem sobreposição. `npm run build` também gera o worker privado `dist/payment-retention.cjs`; `npm run payments:retention` permite configurá-lo como tarefa diária da infraestrutura, inclusive em hospedagens que desligam o servidor por inatividade. A infraestrutura deve agendar essa tarefa diária para garantir a periodicidade independentemente de tráfego; nenhum agendamento externo foi provisionado nesta sessão. Os dois bundles do servidor são bloqueados no servidor estático, inclusive com nomes codificados na URL.

Logs próprios de pagamentos têm somente escopo, código fixo de evento e contagem numérica. Não registram exceções, identidades, CPF, e-mail, tokens, headers, cookies ou payloads. Configurar também ingress/APM para não capturar corpo, credenciais ou query strings de `/api/payments`, especialmente do callback OAuth.

Os testes novos exercitam minimização, rejeição de cartão, projeção de persistência, descarte do webhook, logs, renovação/OAuth concorrentes com desconexão, worker e textos legais. `supabase/tests/payments/privacy.sql` verifica no banco a fronteira de cinco anos, exclusão de cliente/loja, preservação de valor/data e restrição das RPCs. Esse roteiro foi preparado e validado sintaticamente, sem execução/aplicação de migrations.

Bases legais e responsabilidades foram descritas segundo a execução de contrato (LGPD, art. 7º, V) e obrigação legal para a retenção fiscal (art. 7º, II). Os prestadores são operadores quando seguem instruções e controladores independentes nos tratamentos próprios, conforme seus contratos e avisos; a plataforma não controla a retenção realizada por eles.

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

- LGPD (arts. 7º e 16): https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Privacidade Mercado Pago: https://www.mercadopago.com.br/privacidade
- Direitos de anonimização PagBank: https://faq.pagbank.com.br/duvida/lgpd-como-solicitar-a-anonimizacao-dos-dados/1727
- Privacidade InfinitePay: https://www.infinitepay.io/legal/aviso-de-privacidade
