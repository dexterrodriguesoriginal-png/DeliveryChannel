# Voz do cliente, documentos e direitos LGPD

Implementação sobre `main`. As migrations `20261024003600_store_feedback.sql` e
`20261024003700_legal_and_data_rights.sql` são propostas para revisão; não foram
aplicadas a nenhum banco. Seus rollbacks estão em `supabase/rollback` e devem ser
avaliados na ordem inversa. O rollback de LGPD remove o histórico de aceites;
antes de usá-lo, preserve os registros conforme a política de retenção aplicável.

## Feedback e isolamento

- Perfil e rodapé de `/app/:slug` permitem enviar sem login ou com sessão real.
  A mensagem tem 10–1000 caracteres; tipo obrigatório, área e nota opcionais.
- `POST /api/store-feedback/:slug` verifica o JWT quando fornecido e calcula
  HMAC-SHA256 com segredo do servidor, separado por loja, dia e usuário/IP.
  Não usa hash enviado pelo cliente, não guarda IP e não registra payloads.
- A RPC `submit_store_feedback` é executável somente por `service_role` no
  servidor. Resolve a loja pública ativa pelo slug. O slug é o destino público
  do envio, necessário inclusive sem sessão; não é uma autorização administrativa.
  Não há parâmetro `tenant_id` vindo do cliente.
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
- Os dois contadores (usuário e IP) são atualizados atomicamente em ordem estável
  por chave única; o sexto envio gera erro e reverte ambos. Para visitantes, o
  contador é o de IP. Contadores antigos são limpos no próximo envio; hashes são
  separados por dia/loja. Sem informações pessoais incluídas voluntariamente na
  mensagem, a loja não recebe dados que identifiquem o autor. O formulário explica
  que o texto livre também deve evitar informações identificadoras.
- A aba `est-feedback` pertence a OWNER/MANAGER, em todos os planos, fora do mapa
  de módulos. Os gates dos demais módulos continuam nos mesmos locais.

## Configuração do servidor

O app deve ser servido pelo Express (`npm run build` e `npm start`) ou ter a rota
`/api/store-feedback/*` encaminhada a esse servidor. Hospedar somente os arquivos
estáticos não atende ao envio. Variáveis de runtime necessárias:

- `SUPABASE_URL` (ou a URL pública existente) e `SUPABASE_SERVICE_ROLE_KEY`.
- `FEEDBACK_HASH_SECRET`: segredo aleatório exclusivo, com pelo menos 32 caracteres.
  Guardá-lo no gerenciador de segredos; nunca usar prefixo `VITE_`.
- `TRUSTED_PROXY_CIDRS`: lista de CIDRs de proxies de ingresso conhecidos, quando
  houver proxy. O padrão ignora `X-Forwarded-For`. Sem a configuração correta, os
  visitantes atrás do mesmo proxy compartilham o limite; não usar `true` nem
  confiar em cabeçalhos arbitrários. O ingresso deve remover cabeçalhos de origem
  fornecidos pelo visitante antes de inserir o IP validado.

O caminho de feedback retorna 503 quando faltar configuração. Não há fallback
que simule sucesso, login ou gravação em armazenamento local. A política de logs
do proxy/ingresso deve evitar corpos de requisição e credenciais nessa rota.
Nenhuma variável ou credencial de produção foi configurada nesta entrega.

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

`npm test`, `npm run lint` e `npm run build`. Os testes de HTTP usam Supabase
mockado e servidor local. Cobrem validação, JWT inválido, spoofing de IP/identidade,
hashes, resposta de rate-limit, filtros/paginação, estado, dados próprios, cookies,
entradas de UI, permissões e contratos de migrations/rollbacks. Nenhum teste novo
aplica SQL ou se conecta a bancos. Testes de integração PostgreSQL não foram
executados, pois seu setup aplica migrations, contrariando a regra desta tarefa.
A execução real das funções SQL ainda requer validação posterior autorizada em
ambiente próprio; os testes offline verificam seus contratos de segurança.

Validação final: suíte completa com 941 testes em 118 arquivos, lint e build
aprovados. As duas migrations e os dois rollbacks também passaram pelo parser
pglast (SQL/PL/pgSQL), exclusivamente para análise de sintaxe, sem banco.
