# PR B — notificações, despacho e chat

Base: `main` em `47eb51fcd199a849c170dc12341d78573e975177` (PR A já incorporado). Somente itens 6, 7, 8, 10, 11 e 12 do teste de 26/10. Nenhuma migration ou configuração remota foi aplicada nesta implementação.

## Comportamento

- **6:** três templates de Auth com nome público da loja e rodapé discreto. Cliente e entregador enviam `store_name` no cadastro; OAuth mantém o nome durante o retorno e atualiza o metadado da mesma conta. A API OAuth não tem `options.data`; detalhes, limitações de contas com várias lojas, SMTP e rollback manual estão em [auth-emails.md](auth-emails.md).
- **7:** painel de notificações com histórico, não lidas, “Ver”, “Marcar como lida” e balão de 3 segundos com X. Pedidos, solicitações pendentes e mensagens de entregadores geram avisos por trigger. Preferências de balão/som ficam por loja e conta em localStorage; os controles anteriores de som usam a mesma preferência. A lista mostra os 100 avisos mais recentes.
- **8:** `tenant_settings.dispatch_mode` começa em `OWNER_PICKS`. Configurações oferece “Dono escolhe” e “Fila automática”. A fila inclui apenas aprovados, disponíveis, com vínculo ativo e sem corrida ativa; quem nunca fez corrida vem antes, depois a última corrida, com desempate por ID. A loja confirma a sugestão no modal. O servidor ainda revalida disponibilidade ao atribuir. As RPCs antigas de corridas abertas devolvem lista vazia/negam aceite; os botões de despacho abrem atribuição pela loja.
- **10:** o entregador atribuído consulta seu código, com aprovação e vínculo ativos. A loja recebe apenas estado de bloqueio/confirmação, digita o código e confirma a retirada. Alterar diretamente para `OUT_FOR_DELIVERY` pela RPC antiga exige o fluxo do código. A retirada presencial do cliente (`pickup_arrivals`) mantém seu fluxo próprio.
- **11:** OWNER/MANAGER ativos podem usar “Desbloquear e gerar novo código” após bloqueio de retirada ou entrega. A RPC gera valor diferente, zera tentativas e audita sem registrar código. O cliente recebe o novo código de entrega pelo polling já existente. Cinco tentativas e o rate limit anterior são mantidos; regenerar não remove o rate limit. Os eventos de auditoria deste fluxo registram apenas o primeiro nome do ator.
- **12:** chat por pedido entre loja e entregador atribuído, com realtime e polling de reserva. Envio por RPC: corpo entre 1 e 500 caracteres, limite de 20/minuto por usuário/loja; tenant, papel e remetente são definidos no servidor. Mensagem do entregador gera aviso sem conteúdo no título; “Ver” abre pedido e chat. O app oferece “Falar com a loja” e o WhatsApp já cadastrado. Pedidos encerrados têm conversa somente para leitura.

As novas autorizações exigem vínculo e loja ativos; CEO/SUPER_ADMIN não ganham acesso implícito aos dados de outros tenants. Tabelas novas não aceitam escrita direta do cliente, exceto `read_at` das notificações. RPCs usam `SECURITY DEFINER`, `search_path=''` e execução revogada para anon. Nenhum conteúdo de conversa, código, telefone ou e-mail vai para logs/notificações.

## Staging antes de produção

1. Faça backup do banco e das configurações de e-mail. Registre a versão anterior da aplicação. Não use fixtures/stubs de teste em staging ou produção.
2. Aplique `supabase/migrations/20261026004200_notifications_dispatch_chat.sql` em staging. Ela pressupõe todas as migrations da base e a publicação `supabase_realtime`. PostgreSQL mínimo do histórico: 17.
3. Publique o frontend e o servidor deste PR no mesmo ciclo da migration: código antigo não funciona com a retirada invertida. Aplique os templates conforme `auth-emails.md`.
4. Teste com duas lojas e contas próprias: novo pedido, solicitação, aviso/lida/“Ver”, som ligado/desligado e balão; fila com dois aprovados e um pendente; retirada incorreta 5 vezes, desbloqueio e retirada correta; entrega incorreta, desbloqueio e código novo no cliente; chat nos dois sentidos, reconexão, troca de loja e WhatsApp.
5. Confirme retenção: a migration agenda `pr-b-retention` às 03:20 no fuso do banco se `pg_cron` estiver habilitado. Como alternativa, o servidor executa a manutenção ao iniciar e a cada 24 horas. Para hospedagem que escala a zero, agende diariamente `npm run dispatch:retention` após o build, com as mesmas variáveis privadas do servidor (`SUPABASE_URL` ou a configuração pública equivalente e `SUPABASE_SERVICE_ROLE_KEY`). O bundle `dispatch-retention.cjs` é bloqueado no servidor estático. Nenhum job externo foi provisionado neste PR.
6. Repita em produção apenas após conferir staging. Nunca coloque service-role ou SMTP em variáveis `VITE_*`.

Notificações são apagadas após 90 dias da criação. Mensagens são apagadas 90 dias após `delivered_at`; pedidos cancelados usam `updated_at`. Conversas abertas são preservadas. O job é idempotente e pode coexistir com pg_cron.

## Rollback

Pause o deploy e os jobs externos de retenção, faça backup das tabelas novas e aplique `supabase/rollback/20261026004200_notifications_dispatch_chat_down.sql`, junto da restauração da versão anterior da aplicação. O rollback remove o job pg_cron, triggers, tabelas de notificações/chat, coluna de modo e RPCs novas; restaura as definições anteriores das RPCs e da auditoria. **Os registros de notificações e chat são removidos.** Códigos e pedidos existentes são preservados. Restaure os templates/SMTP manualmente pelo painel se for reverter também o item 6.

## Validação reproduzível

```sh
npm run lint
npm test
npm run build
# Somente PostgreSQL local descartável, com usuário que possa criar banco e extensões:
sh supabase/tests/pr_b/run_regressions.sh
```

O harness cria/remove apenas o próprio banco local. Aplica todo o histórico, testa notificações, papéis ativos/inativos, anon, isolamento A/B, fila, retirada invertida, cinco erros, bloqueio/regeneração auditada, atualização do código do cliente, chat e retenção. Reverte, compara definições e ACLs das funções alteradas com o estado anterior, reaplica e repete os testes. A suíte TypeScript cobre notificações, troca de modos, preferências separadas por usuário/loja, branding de e-mail, contratos das RPCs e agendamento de retenção.

Resultado local desta entrega: lint e build passaram; **138 arquivos / 1.143 testes** passaram. PostgreSQL 17 passou pelo harness completo duas vezes (antes e após rollback/reaplicação), inclusive comparação de definições/ACLs de todas as funções modificadas. Configurações de Auth/SMTP, aprovação visual em celulares e aplicação em staging/produção ficam para o ciclo de deploy descrito acima.
