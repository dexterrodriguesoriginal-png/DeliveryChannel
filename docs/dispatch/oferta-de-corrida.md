# Oferta de corrida com aceite do entregador

Base: `main` em `5ffe88e`. Branch: `feat/driver-ride-offer`.

A loja chama o entregador para um pedido de entrega pronto. A oferta não muda o pedido nem a disponibilidade do entregador. O aceite do próprio entregador atribui a corrida, muda o pedido para `WAITING_FOR_DRIVER`, ocupa o entregador e rotaciona o código de retirada. Recusa ou expiração mantém o pedido pronto e sem entregador; a fila automática tenta o próximo sem repetir quem recusou ou expirou.

O prazo padrão é 60 segundos, configurável entre 20 e 300 por proprietário/gerente em Configurações de despacho. O entregador vê apenas número do pedido, loja, bairro, frete e prazo antes do aceite. Endereço e código de retirada continuam protegidos pela atribuição e pelas políticas existentes. Não há backfill. Pedidos já atribuídos mantêm o código atual.

## Validação

- `npm test`: 147 arquivos / 1.201 testes; `npm run lint` e `npm run build` passaram.
- PostgreSQL 17 local descartável: `sh supabase/tests/driver_ride_offers/run_regressions.sh`, com cliente PostgreSQL e `PGUSER` configurados. O harness recusa host remoto e cria um banco sintético próprio; não o remove automaticamente.
- Repetir com argumento `legacy` para defaults amplos de permissões. O harness aplica toda a base, verifica uma corrida criada antes da migração, executa os fluxos em transação com `ROLLBACK`, reverte com uma oferta pendente e compara pedidos/códigos/histórico e todas as definições/permissões das funções. Depois reaplica e repete os testes. Também exercita duas sessões chamando o mesmo entregador por lojas diferentes: a chamada concorrente segue para o próximo da fila.
- `security_and_flows.sql` usa usuários, lojas e pedidos sintéticos exclusivos dentro de `BEGIN`/`ROLLBACK`, sem depender das fixtures locais. Nunca aplicar os stubs de `n1n6/harness` em staging ou produção.

## Staging e publicação

1. Usar um projeto de staging separado, atualizado até `20261026004400`, com backup e a versão anterior da aplicação identificada. Configurar `STAGING_PROJECT_REF`, `STAGING_DB_URL` e `STAGING_CONFIRM` no ambiente seguro; não registrar valores em logs ou no Git.
2. Conferir o plano com `bash supabase/tests/driver_ride_offers/run_staging.sh`. Executar o mesmo comando com `--execute` para aplicar → testar → reverter → comparar funções/permissões → reaplicar → testar. As guardas existentes recusam o projeto de produção. O ensaio exige ausência da tabela de ofertas; não descarta ofertas de uma instalação já ativa.
3. Publicar o frontend desta branch em staging e conferir proprietário/gerente/logística, entregador e cliente em dois aparelhos. Ativar o som das chamadas no aparelho do entregador: os navegadores exigem interação para liberar áudio. Validar vibração em aparelho compatível, reconexão, aceite/recusa, prazo esgotado e retirada/entrega com códigos.
4. Em produção, confirmar backup recuperável e preparar previamente o artefato do frontend. Aplicar somente `20261026004500_driver_ride_offers.sql`, registrar a versão pelo fluxo de migrations usado pelo projeto e publicar o frontend/servidor logo em seguida, no mesmo ciclo. O cliente antigo de loja passa a criar ofertas via `assign_order_to_driver`, e o app antigo do entregador precisa ser atualizado para exibi-las.
5. Verificar a publicação realtime de `order_driver_offers`. Com `pg_cron`, a migração agenda expiração a cada 30 segundos e usa um minuto se a versão não aceitar segundos. Sem `pg_cron`, o servidor Express executa `expire_driver_offers` a cada 30 segundos com a configuração privada de serviço já usada nos pagamentos. Chamadas também expiram de forma lazy ao ofertar, responder e consultar ofertas; a loja e o entregador consultam a cada 10 segundos como reserva do realtime. Em hospedagem estática/escala a zero sem cron, configurar um job externo de serviço para a mesma RPC.
6. Conferir que uma corrida que já estava em andamento usa o código anterior e continua até a entrega. Não executar backfill ou limpeza de pedidos/histórico.

## Reversão

Preparar a versão anterior da aplicação e aplicar `supabase/rollback/20261026004500_driver_ride_offers_down.sql` no mesmo ciclo. O down remove o job e os objetos novos e restaura exatamente `assign_order_to_driver`, `driver_accept_order` e `get_dispatch_queue`, incluindo as guardas de pagamento de 4301. Remove somente a tabela de ofertas e a configuração de prazo; pedidos, códigos, histórico, auditoria e notificações permanecem. Ofertas pendentes deixam de existir, sem atribuir ou alterar pedidos. Corridas aceitas continuam com seu código válido.

## Evidências desta implementação

Validação local em PostgreSQL 17: aplicar → reverter → reaplicar, permissões/RLS, isolamento, código novo, corrida legada, recusa, expiração lazy, continuação da fila, cancelamento e liberação do entregador. A execução em staging, a verificação física de áudio/vibração e a publicação em produção dependem dos acessos externos; não foram executadas neste ambiente.
