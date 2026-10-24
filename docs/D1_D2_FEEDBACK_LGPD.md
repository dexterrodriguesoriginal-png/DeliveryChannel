# Voz do cliente, documentos e direitos LGPD

Implementação sobre `main`. As migrations `20261024003600_store_feedback.sql`,
`20261024003700_legal_and_data_rights.sql` e
`20261024003800_submit_store_feedback_v2.sql` são propostas para revisão; não foram
aplicadas a nenhum banco. Seus rollbacks estão em `supabase/rollback` e devem ser
avaliados na ordem inversa. O rollback de LGPD remove o histórico de aceites;
antes de usá-lo, preserve os registros conforme a política de retenção aplicável.

## Feedback e isolamento

- Perfil e rodapé de `/app/:slug` permitem enviar sem login ou com sessão real.
  A mensagem tem 10–1000 caracteres; tipo obrigatório, área e nota opcionais.
- O frontend chama `submit_store_feedback_v2` diretamente pelo supabase-js, com a
  chave publicável e o JWT da sessão quando houver. A RPC SECURITY DEFINER permite
  execução a `anon` e `authenticated`, com search_path vazio. Valida tipo, área,
  nota e tamanho da mensagem no servidor.
- O slug ou UUID recebido seleciona apenas o destino público. O banco resolve o
  tenant e exige a mesma condição da vitrine `get_public_store`: loja ACTIVE com
  slug público não vazio. Não existe flag adicional de publicação neste esquema;
  `is_open` é horário de operação e não controla a publicação da loja.
- O segredo de 32 bytes é gerado por `extensions.gen_random_bytes(32)` na migration
  e fica exclusivamente em `private.store_feedback_secret`, com RLS e sem acesso
  para PUBLIC/anon/authenticated/service_role. Não é retornado por nenhuma RPC.
  HMAC-SHA256 usa como chave esse segredo e como dados a identidade, UUID canônico
  da loja e data UTC em ISO. A identidade é `auth.uid()` quando disponível; para
  visitantes, o primeiro IP de `request.headers` → `x-forwarded-for`, fornecido pelo
  ingresso Supabase/PostgREST. UUID e slug da mesma loja compartilham a quota.
  IP e UID nunca são persistidos nos relatos ou contadores, somente o HMAC diário.
- `list_store_feedback` e `set_store_feedback_state` derivam o tenant dos vínculos
  ativos OWNER/MANAGER de `auth.uid()` no banco. O slug seleciona uma das lojas
  autorizadas desse usuário, inclusive para donos com mais de uma loja. Trocar o
  slug não concede acesso a uma loja sem vínculo. CEO não acessa conteúdo pela
  conta global: sua RPC própria retorna apenas ID/nome da loja e contagem.
- RLS habilitada sem políticas de acesso direto. PUBLIC/anon/authenticated não
  têm acesso às tabelas. Todos os helpers ficam sem EXECUTE público e todas as
  funções SECURITY DEFINER usam `SET search_path = ''`.
- Nenhum vínculo do relato a customer, conta, pedido ou contato. As respostas ao
  lojista contêm só conteúdo, campos escolhidos, estado e dia UTC. Ordenação dentro
  de cada dia por UUID aleatório não revela a sequência de envio. Contagens e
  médias usam todo o filtro; o log tem páginas de 50, sem truncamento silencioso
  pelo limite de linhas do PostgREST.
- Um contador por remetente/loja/dia é atualizado por UPSERT atômico em chave
  única; o sexto envio gera erro e reverte a operação, inclusive sob concorrência.
  Com sessão, a quota é por UID; sem sessão, por IP. O dia UTC altera o hash e
  reinicia a quota. Contadores antigos são limpos no próximo envio. Sem informações
  pessoais incluídas voluntariamente na mensagem, a loja não recebe dados que
  identifiquem o autor. O formulário orienta evitar informações identificadoras.
- A aba `est-feedback` pertence a OWNER/MANAGER, em todos os planos, fora do mapa
  de módulos. Os gates dos demais módulos continuam nos mesmos locais.

## Envio direto ao Supabase e rollback

O envio de feedback funciona com hospedagem estática do frontend e as variáveis
públicas existentes `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. A rota
Express de feedback, seu registro e os testes antigos dessa rota foram removidos.
O Express continua atendendo suas outras funções, incluindo PWA.

`FEEDBACK_HASH_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` e `TRUSTED_PROXY_CIDRS` não são
mais utilizados nem necessários neste fluxo e foram removidos de `.env.example`.
O alias `SUPABASE_URL` foi retirado desse template; o resolvedor PWA ainda aceita
esse alias público por compatibilidade. Nenhuma configuração remota foi alterada.

O ingresso Supabase precisa fornecer `x-forwarded-for` sanitizado; a RPC não recebe
IP nem identidade como argumento e recusa visitantes sem origem disponível. Os
logs da infraestrutura devem evitar payloads e credenciais. O frontend mostra
mensagens genéricas para falhas, sem repassar detalhes internos do banco.

A migration 038 remove a RPC antiga que recebia hashes externos. O rollback em
`supabase/rollback/20261024003800_submit_store_feedback_v2.sql` restaura exatamente
a definição anterior e seu EXECUTE exclusivo para `service_role`, remove a RPC v2
e a tabela de segredo e preserva relatos e contadores. Mantém o schema `private`,
que pode ser compartilhado com outros objetos. Para restaurar também o fluxo de
aplicação, reverta o commit e restaure as variáveis do servidor pelo gerenciador de
segredos. Não armazene seus valores no Git.

A mudança de algoritmo/segredo não permite reaproveitar a quota da versão anterior:
contadores antigos são preservados, mas os novos hashes começam sua própria quota
no dia da transição. Para uma futura implantação, prefira a virada do dia UTC.
Nenhuma migration ou rollback foi aplicado em qualquer banco nesta entrega.

## Documentos e consentimentos

Documentos públicos em `/legal/terms-owner`, `/legal/terms-customer`,
`/legal/privacy` e `/legal/cookies`, versão `2026-10-24.1`, publicada em 24/10/2026.
O perfil usa a mesma fonte de textos, eliminando a versão provisória duplicada.

O cadastro por senha exige checkbox desmarcado e metadados de aceite. Um trigger
valida a versão no INSERT de `auth.users` e registra o horário do servidor; updates
posteriores em metadados não fabricam aceites. OAuth mantém o fluxo oficial do
provedor e exige aceite no retorno, antes do cadastro comercial/compra. Triggers
em tenants, customers e orders reforçam o aceite para essas operações. Não se
criam aceites retroativos para contas existentes.

`LegalBoundary` consulta o aceite por usuário e público, falha de forma fechada
quando a consulta falha e solicita reaceite quando a versão muda. Revalida ao
retornar à aba. Atualizar documentos exige nova versão no frontend e em
`_legal_version()` por nova migration com rollback; o frontend não permite aceitar
uma versão de servidor diferente do texto que está mostrando. As rotas públicas
dos documentos e o acesso a Meus dados/exclusão permanecem disponíveis durante esse gate,
sem exigir um novo aceite para exercer esses direitos.

O banner permite somente essenciais ou opt-in analítico. `trackEvent` e
`trackPublicEvent` não enviam analíticos sem opt-in; o ID analítico da sessão
não é criado antes do aceite e é removido ao revogar. A escolha pode ser reaberta
no rodapé/perfil e fica neste navegador. Marketing continua separado no fluxo
existente de Permissão para contato e nas RPCs `crm_*`; o aceite legal e a escolha
de cookies não concedem permissão de contato.

## Meus dados

O perfil chama `export_my_customer_data()` sem IDs de cliente/loja. A RPC deriva
os dados de `auth.uid()` e exporta perfil, cadastros próprios por loja, pedidos e
itens, aceites, consentimentos e solicitações existentes de exclusão. Não inclui
notas privadas da loja, dados operacionais de terceiros, segredos nem feedback
anônimo. O JSON também inclui preferências locais permitidas no namespace do
usuário atual (endereços, favoritos, busca e notificações); não exporta tokens.

A exclusão usa `DeleteAccountSheet` e o callback existente que chama
`request_my_account_deletion`; nenhuma nova tabela ou fluxo de exclusão foi
criado. A solicitação continua sendo processada pela plataforma, respeitando a
retenção legal.

## Validação sem banco

`npm test`, `npm run lint` e `npm run build`. Os testes de envio exercitam o
transporte real do supabase-js com fetch mockado, sem rede: visitante e sessão,
allowlist dos cinco argumentos, limites da mensagem, validação de campos e
tratamento de erros/rate-limit. Contratos SQL verificam acesso ao segredo, tenant,
HMAC, quota atômica, dia UTC e restauração exata da RPC anterior no rollback.
Nenhum teste aplica SQL ou se conecta a bancos. Os testes de integração PostgreSQL
não são executados, pois o setup aplica migrations, contrariando a regra desta
tarefa. A execução real das funções SQL requer validação posterior autorizada;
os contratos offline não comprovam execução ou concorrência em PostgreSQL.

Validação da tarefa E: 949 testes em 119 arquivos, lint e build aprovados; 25 novos
testes cobrem o envio v2 e seus contratos SQL. A migration 038 e seu rollback
passaram pelo parser pglast (SQL e PL/pgSQL), exclusivamente para análise de
sintaxe, sem banco.
