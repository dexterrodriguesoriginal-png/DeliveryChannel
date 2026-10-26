# Correções do teste real de pagamentos e entrega

A migration `20261026004100_payment_primary_accounts.sql` corrige a linha proposta do INSERT de `configure_store_payment`: uma conta desconectada nunca propõe `is_primary=true` antes do `ON CONFLICT`. O UPDATE preserva a lógica existente. As duas RPCs bloqueiam a loja para serializar escolha, conexão e desconexão.

A primeira conexão (OAuth Mercado Pago/PagBank, InfiniteTag ou PIX manual) vira principal. Desconectar promove a conta conectada mais antiga, com desempate pelo provedor. O backfill preenche lojas conectadas sem principal e preserva escolhas existentes. Com 2+ contas, o dono vê “Escolha a conta em que deseja receber” e “Receber nesta conta”. O checkout já ordenava a principal primeiro.

Erros conhecidos do banco são traduzidos por uma lista explícita; mensagens arbitrárias, constraints e detalhes internos continuam privados.

## Por que zero podia parecer salvo

- `DriverSettingsTab` tinha estado inicial `deliveryFee || 6.5`, um campo de taxa e um botão que apenas executava `setTimeout` e mostrava sucesso. Não havia chamada de persistência. O campo duplicado e o repasse editável foram retirados; essa tela indica o local correto em Configurações.
- `DriversPage` também usava `|| 6.5`; agora usa `??`, preservando zero.
- Configurações → `settingsToDb` já enviava zero corretamente. Os outros `deliveryFee || 0` encontrados apenas leem/apresentam valores; não transformam zero em taxa positiva. Não foi encontrado um segundo formulário persistindo e sobrescrevendo a taxa.
- O UPDATE N1–N6 agora confirma que uma linha foi gravada antes de informar sucesso. Uma linha ausente ou bloqueada por RLS produz orientação para o dono.

O código explica os caminhos encontrados; esta revisão não consultou logs nem alterou os registros de produção para atribuir a ocorrência específica das 00:46 BRT a um deles.

Configurações concentra o interruptor “Entrega grátis para o cliente”: ligado grava 0 (cliente 0 / loja 7); desligado grava 7 (cliente 3,50 / loja 3,50). O entregador recebe 7 em ambos os casos, conforme a migration 1700. O limite opcional de frete grátis continua na mesma seção.

## Validação

- `npm test`: 129 arquivos, 1.099 testes passando.
- `npm run lint` e `npm run build`: passando.
- PostgreSQL 17 descartável: `supabase/tests/payments/run_regressions.sh` cria dados sintéticos, aplica as migrations, verifica backfill, seleção principal, conexão dos quatro provedores, promoção, rejeição de conta desconectada, callback obsoleto e checkout grátis/compartilhado. Faz rollback, compara definições e grants das funções com a versão anterior e reaplica a migration. Remove o banco ao terminar.
- `rls.sql`, `privacy.sql` e `attacks.sql`: executados no PostgreSQL local, sem falhas.

Para repetir o runner, usar PostgreSQL 17+ local com usuário autorizado a criar bancos e papéis: `PGUSER=postgres sh supabase/tests/payments/run_regressions.sh`. Ele recusa PGHOST remoto. Os stubs incluem Vault sintético, publicação realtime e ACL explícita do proprietário para o precheck histórico da migration 0800.

Rollback: `supabase/rollback/20261026004100_payment_primary_accounts_down.sql`. Restaura as funções 040 e preserva as escolhas já gravadas. A correção exige aplicar a migration 041 no deploy; nesta entrega ela foi aplicada somente em banco descartável local. Nenhum pagamento real foi criado.
