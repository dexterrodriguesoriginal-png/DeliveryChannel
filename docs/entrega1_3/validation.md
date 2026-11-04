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
