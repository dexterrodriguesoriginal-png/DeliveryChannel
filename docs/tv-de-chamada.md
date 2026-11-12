# TV de chamada com acesso próprio

Base: main `74e8a9742708c0bb5cf091de3b8e38518011c82b`. A rota `/chamada` continua disponível para a equipe; `/tv` não monta AuthProvider nem o painel.

## Uso

1. OWNER/MANAGER abre **Marketing → QR Code de Retirada → TV de chamada**.
2. Informa o nome e clica em **Ativar nova TV**. O código tem seis dígitos, validade de dez minutos e uso único. O QR/link abre `/tv`, sem incluir credenciais na URL.
3. Na TV, informa o código. Alternativamente, informa o identificador da loja (slug), nome da TV e conta de dono/gerente uma única vez.
4. A TV mantém apenas o token de dispositivo em `localStorage` (`dc.tv.device.v1`). O login temporário usa outro cliente Supabase, em memória, com persistência e renovação desabilitadas; o cliente de leitura continua anônimo mesmo se o logout remoto falhar.
5. A lista mostra nome e último acesso. **Desativar** revoga imediatamente no servidor. A tela recebe uma invalidação realtime e revalida; o polling de cinco segundos cobre quedas do realtime. Sem conexão, senhas anteriores são ocultadas.
6. A opção já existente **Mostrar primeiro nome na TV** do QR de retirada controla o nome; desligada, a RPC retorna `name: null`.

## Banco e segurança

Aplicar, quando autorizado pelo responsável pelo ambiente, `supabase/migrations/20261110000400_tv_device_access.sql` após as migrações anteriores. Este PR não aplica migrações nem realiza deploy.

- Tabelas `tv_devices`, `tv_pairing_codes`, `tv_pairing_attempts` e `tv_access_audit`: RLS ligada, sem políticas ou privilégios diretos para anon/authenticated.
- RPCs SECURITY DEFINER com `search_path=''` e privilégios explícitos. Administração reutiliza `_totem_require_manager`, restrito a OWNER/MANAGER da loja.
- Token aleatório de 256 bits, SHA-256 no banco, separado dos tokens do totem. A RPC `tv_read` não aceita tenant/order ID: deriva a loja exclusivamente do token, valida revogação e loja ativa em cada leitura.
- Pareamento serializado por origem e código para uso único e contagem concorrente. Cinco falhas por origem ou trinta falhas globais bloqueiam novos pareamentos por dez minutos desde o início da respectiva janela. O teto global independe dos cabeçalhos e também limita ataques distribuídos; sob ataque, novas ativações por código podem ficar indisponíveis até o fim da janela, sem afetar TVs já ativas ou ativação autenticada. Tentativas já bloqueadas não geram novas linhas de auditoria. Resultados de erro são retornados como JSON para preservar contador e auditoria na transação.
- Origem: `cf-connecting-ip`, com fallback para o último salto de `x-forwarded-for`. O gateway Supabase/proxy deve sobrescrever esses cabeçalhos; sem endereço, usa um único bucket compartilhado. Nunca recebe IP/identificador de limite como argumento da RPC. Cabeçalhos são apenas uma barreira adicional: mesmo se falsificados, não contornam o teto global.
- Auditoria registra emissão de código, ativação, revogação e falha; inclui ator quando autenticado. Não grava tokens/códigos em claro nem credenciais de funcionário.
- Payload: `ok`, nome da loja, campos visuais explicitamente selecionados e `entries` com `code`, `name` (primeiro nome opcional), `kind` (pronto/chamado). Não retorna IDs de pedidos/clientes, telefone, endereço, itens ou valores. Totens prontos exigem pagamento PAID; chamados pelo QR respeitam janela de trinta minutos e pedidos abertos.
- Cores derivadas do motor central de tema. A TV não usa cores literais. `/chamada` também recebe fundos/textos do tema e botão de tela cheia.
- Realtime: canais opacos `tv-<SHA-256 do token>`, calculados localmente, enviam somente `{}`. Nenhum subscribe a linhas de pedidos/chegadas ou concessão de acesso a essas tabelas. Triggers invalidam por loja em chegada, status, revogação, tema e preferência de nome. Requer `realtime.send(jsonb,text,text,boolean)`; o precheck falha claramente se ausente. O fallback é polling de cinco segundos.

## Validação

```sh
bun install
bun x tsc --noEmit
node supabase/tests/tv_access/run_pglite.mjs
node supabase/tests/totem_access/run_pglite.mjs
node supabase/tests/entrega3/run_pglite.mjs
bun run test
```

PGlite aplica as migrações reais do padrão de totem e desta funcionalidade sobre fixtures isoladas. Cobre pareamento, validade, expiração, reuso, hash, token inválido/revogado, outra loja, perfis, cinco falhas, desbloqueio, auditoria, RLS/privilégios, minimização dos dados, notificações vazias, rollback e reaplicação. Os doubles de criptografia e transporte realtime vêm das fixtures; o teste não prova comportamento de rede do Supabase hospedado.

Vitest cobre os componentes, armazenamento, isolamento do login temporário, erros, polling/realtime, revogação, tela cheia e a compatibilidade de `/chamada`.

Smoke no Chromium com RPCs simuladas: abrir `/tv` sem sessão, parear, conferir tema e código/nome, recarregar para recuperar token, revogar e aguardar até cinco segundos; a tela volta ao pareamento e remove o token. Sem erros JavaScript. Para validação integrada em ambiente de teste, repetir com Supabase real e confirmar os eventos realtime e a origem dos cabeçalhos no gateway.

## Rollback

`supabase/rollback/20261110000400_tv_device_access_down.sql` remove apenas triggers, funções e tabelas desta funcionalidade, preservando pedidos, fila, temas e acesso do totem. Invalida todos os dispositivos de TV e remove o histórico de auditoria específico da TV; exportar esse histórico antes caso seja necessário retê-lo. Reverter o frontend junto para não apresentar uma rota sem backend.

## Revisão do PR #43 — 12/11/2026

Achados corrigidos na branch `feat/tv-device-access`:

- Rate limit dependia exclusivamente da origem declarada em cabeçalhos. Acrescentado teto global de trinta falhas em dez minutos, serializado no banco e testado com rotação dos dois cabeçalhos de IP. Requisições já bloqueadas não ampliam a auditoria indefinidamente.
- Campos de ativação e QR administrativo ainda dependiam de cores padrão do navegador/componente. Agora usam a paleta do motor de tema; o painel recebe o tema da loja.
- Teste estrutural de Marketing não aceitava o novo painel de TV na aba. Atualizado para conferir os dois componentes e a autorização OWNER/MANAGER.
- Runner PGlite do totem usava dependência e fixture em `/tmp/pglite`. Agora usa a dependência instalada e a fixture versionada.

Validação final: `bun install`, `tsc --noEmit`, Vitest completo (**303 arquivos, 2.501 testes aprovados**) e os três runners PGlite (`tv_access`, `totem_access`, `entrega3`) aprovados. Os testes da TV também verificam SECURITY DEFINER/search_path, bloqueio de SELECT/DELETE para anon/authenticated, prontos pagos, chamados expirados, fila encerrada e loja inativa. Smoke Chromium com RPCs simuladas aprovado: pareamento, tema, persistência/reload e revogação por polling, sem erros JavaScript.

Veredito: **APROVADO após as correções**. Validação hospedada de gateway, pgcrypto e transporte realtime não foi realizada; PGlite usa doubles dessas integrações. Nenhuma migração aplicada a banco remoto, merge ou deploy.
