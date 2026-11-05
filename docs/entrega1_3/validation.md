# Entrega 1.3

Base: `origin/main` em `5ee626eb8a27adf389de6915bf82e9a32dd32c48`. Branch: `feat/entrega1-3`. Autor: David Rodrigues <dexterrodriguesoriginal@gmail.com>. Sem merge, deploy ou acesso a dados de produção.

## Parte A — fluxo de todas as rodadas

- Cada rodada pronta tem um chamado próprio; entregar uma não encerra o chamado de outra rodada. O app avisa também quando uma nova rodada chega na primeira consulta já pronta.
- O acompanhamento flutuante existe somente enquanto algum pedido estiver em andamento. O histórico continua acessível na conta.
- Os alertas do dashboard usam a mesma paleta dos pedidos e mantêm o pedido servido até a entrega; entregue sai da fila.
- Entrega exige `OUT_FOR_DELIVERY` (balcão clicou em Servir). Garçom não pode servir; nem dono pode servir antes de `READY`. Interfaces e RPCs aplicam a regra.

Migration: `supabase/migrations/20261104000400_entrega1_3_a.sql`. Rollback correspondente: `supabase/rollback/20261104000400_entrega1_3_a_down.sql`.

O rollback restaura as definições e ACL das funções anteriores, remove o trigger e o vínculo por rodada, sem alterar pedidos, valores ou pessoas. A suíte compara fingerprints de funções/ACL, RLS, tabelas, colunas, constraints, triggers e índices em dois ciclos completos de aplicação e reversão por modo.

SQL novo: `supabase/tests/entrega1_3/a.sql`, executado por `sh supabase/tests/entrega1_3/run_regressions.sh strict A` e `legacy A`. Os fixtures são sintéticos e os runners recusam conexões remotas.

Regressões frontend incluem três rodadas da mesma conta, aviso ao observar a segunda pronta, cores, balão após entrega e botões antes/depois da liberação. Isolamento SQL inclui cliente, outra loja e garçom de outra mesa na mesma loja.

Validação A: `npx tsc --noEmit` sem erros; Vitest completo **239 arquivos / 1.982 testes aprovados**, zero falhas ou pendências; **12/12 runners SQL em strict e legacy (24 execuções) aprovados**, incluindo Entrega 1.3 com **29/29 verificações em cada modo** e dois ciclos de rollback exato. Os testes HTTP usaram permissão de rede para abrir somente seus servidores locais; a primeira tentativa em sandbox sem sockets foi substituída pela rodada completa aprovada.

## Parte B — cores, autorização do garçom, comprovante por e-mail e balão da conta

- **Item 7**: Mapa de mesas do Salão e App do Garçom exibem `READY` (azul `#1AB0F5`) com legenda explícita `"Pedido novo / Pronto no balcão"`, e no KDS da Cozinha o cabeçalho de `"Em preparo"` usa amarelo `#FFDD00` com texto escuro.
- **Item 8**: Fechamento de conta no App do Garçom é bloqueado quando a comanda está apenas em `BILL_REQUESTED`, exigindo status `WAITER_AUTHORIZED` (ou `AWAITING_PAYMENT` com PIX ativo) concedido pelo dono/caixa.
- **Item 9**: O garçom autorizado pode fechar a conta diretamente pelo `WaiterTableSheet` (PIX na mesa, dinheiro com cálculo de troco ou cartão com confirmação de recebimento).
- **Item 10**: Na confirmação de pagamento (`TabPaymentConfirmation` e `WaiterBillPanel`), o botão `"Enviar comprovante por e-mail"` exibe feedback claro de envio, sucesso (`"Comprovante enviado para ..."`), aviso quando o cliente não tem e-mail cadastrado ou erro com botão `"Tentar novamente"`, e `sendTabReceipt` envia o comprovante por Resend quando `RESEND_API_KEY` está configurada.
- **Item 11**: Quando o cliente pede a conta (`request_bill`), o chamado `BILL` atende o garçom e `PanelBillRequestedAlert` acompanha `dining_tabs` por Realtime e atualização periódica. O balão para dono/gerente/caixa oferece “Ver conta” e “Fechar conta”, saindo quando a comanda muda de status; não depende de um tipo inexistente `BILL_REQUESTED` em `owner_notifications`.
- **Item 12**: Quando o cliente contesta a entrega (`"Não recebi"`), a rodada no App do Garçom fica amarela (`PREPARING`) com selo `"Entrega contestada · verificar"` até a resolução.
- **Item 13**: No modal `"Lançar pedido na mesa"` do Salão e do App do Garçom, o seletor foi substituído por lista visual com foto/ícone, preço, busca e filtro por categoria, e o botão foi renomeado para `"Fazer pedido"`.

Migration: `supabase/migrations/20261104000500_entrega1_3_b.sql`. Rollback correspondente: `supabase/rollback/20261104000500_entrega1_3_b_down.sql`.
SQL de testes: `supabase/tests/entrega1_3/b.sql`.

## Parte C — trocar/juntar mesas e código de entrega por rodada

- **Item 1 (Trocar de mesa / juntar mesas)**:
  - **Cliente**: No app da mesa (`DineInClientApp`), botão `"Mudar de mesa"` lista as mesas livres (`list_free_tables_for_session`) ou aceita o QR/token de outra mesa (`customer_move_table`). A comanda aberta (pedidos, valores e pessoas/sessões) muda inteira para a nova mesa e a mesa antiga fica livre. Garçom e dono recebem aviso `"Mesa X → Mesa Y"`.
  - **Garçom e dono**: Botão `"Juntar mesas"` (`staff_join_tables`) une 2 ou mais mesas numa única comanda, e `"Separar"` (`staff_separate_table`) desvincula uma mesa. Mesas juntas aparecem ligadas no Salão e no App do Garçom com a mesma cor, comanda e selo `"Mesas juntas: ..."`.
  - **Anti-fraude**: Proibido mudar para mesa ocupada sem ação da equipe (`TABLE_OCCUPIED`); mudança bloqueada com conta pedida ou aguardando PIX (`MOVE_BLOCKED_BILL`); histórico de trocas/junções gravado na comanda (`tab_table_moves`: quem, quando, de/para); a dívida acompanha a sessão do cliente e nunca se perde na mesa antiga.
- **Item 3 (Código de entrega por rodada)**:
  - **Configuração opcional do dono (padrão desligado)**: `"Exigir código de entrega na mesa"` (`require_delivery_code` em `tenant_modules` / RPC `set_salon_delivery_code_required`), disponível em Configurações do Salão (`SalonSetupPanel`) e no topo do Salão (`SalonPage`).
  - **Geração e exibição**: Quando ativado, cada rodada gera um código exclusivo de 4 dígitos (`salon_order_delivery_codes`), exibido **apenas** no app do cliente daquela comanda (`get_my_tab` / `DineInTracking` / `Minha conta`).
  - **Validação no servidor**: O garçom só consegue marcar `"Entregue"` digitando o código de 4 dígitos informado pelo cliente (`waiter_mark_delivered(uuid, text)`), com limite de 5 tentativas (`DELIVERY_CODE_LOCKED`) e log em `tab_access_events`.
  - **Bloqueio de contestação**: Com código validado (`delivery_confirmed_with_code = true`), `"Não recebi"` (`customer_dispute_delivery` e UI) fica bloqueado para aquele pedido e exibe `"Entrega confirmada com código"`.

Migration: `supabase/migrations/20261104000600_entrega1_3_c.sql`. Rollback correspondente: `supabase/rollback/20261104000600_entrega1_3_c_down.sql`.
SQL de testes: `supabase/tests/entrega1_3/c.sql`.

## Revisão de B/C

Os commits `769be0b` e `110e8ed` foram revisados, preservando A. Achados, correções e reprodução em `docs/entrega1_3/revisao-b-c.md`. Validação final: tsc verde, **2.031 testes Vitest**, **12 suítes SQL em strict/legacy**, Entrega1.3 com **166/166 por modo**, rollback005/006 exato isolado e acumulado em dois ciclos, concorrência e preservação do histórico após uso. Sem merge/deploy.

