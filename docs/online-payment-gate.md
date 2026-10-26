# Pedido online só chega à loja depois do pagamento

Base: `main e6182c7`. Migration única: `20261026004301_online_payment_gate.sql`.

O checkout informa a escolha online no INSERT. PIX de cliente sempre aguarda pagamento; dinheiro/cartão na entrega e PDV preservam o fluxo atual. Reservas de cobrança de clientes antigos também ativam a proteção. O backfill marca pedidos não finais não pagos, incluindo os já CONFIRMED, sem mudar status, estoque ou timestamps.

RLS oculta pedido, itens, histórico, retirada, reservas, cobrança, notificações e auditoria. RPCs de KDS, despacho, CRM e relatórios também filtram o pedido. O cliente mantém acesso. Aceite, atribuição e UPDATE privilegiado de status recebem `PAYMENT_REQUIRED` até o pagamento. Os privilégios anteriores de UPDATE direto do navegador continuam revogados.

Em **Configurações → Pagamentos → Pagamentos para conferir**, OWNER/MANAGER ativos recebem apenas número, valor, forma, horário e primeiro nome. A confirmação resolve o número dentro da própria loja, valida PIX manual/InfinitePay e usa a confirmação existente; não expõe UUID, endereço ou itens. PIX legado sem cobrança também pode ser conferido. Confirmação automática continua restrita ao service_role. A liberação e a notificação são atômicas; retries não duplicam o aviso.

O job existente do servidor executa a expiração ao iniciar e a cada cinco minutos, com retenção de notificações/chat uma vez por dia. `npm run dispatch:retention` também expira pedidos na execução diária externa. Falha/expiração da cobrança ou mais de 60 minutos sem pagamento cancela com “Pagamento não concluído”, devolve estoque uma única vez e grava histórico/auditoria. O pedido cancelado permanece oculto e não é apagado.

## Validação local

```sh
npm run lint
npm test
npm run build
sh supabase/tests/pr_b/run_regressions.sh
bash supabase/tests/n1n6/run_all.sh online-payment-gate
```

SQL exige PostgreSQL 17 local descartável. O runner PR B testa primeiro suas regressões e depois o gate. O modo `online-payment-gate` do runner n1n6 aplica o histórico completo e roda a suíte focada com permissões padrão estritas e com defaults legados antes da migration nova. Fixtures/stubs nunca devem ser aplicados a um ambiente real. Testes cobrem cliente, equipe, entregador, KDS pareado, contagens, despacho, duas lojas, confirmações, bypass, estoque e expiração. Rollback compara hash de **todas** as definições/ACLs das funções públicas e de todas as policies, seguido de reaplicação e repetição dos testes.

## Aplicação e rollback

Aplique a migration e publique frontend/servidor no mesmo ciclo de deploy. O servidor precisa das variáveis privadas já usadas pelo job de manutenção. Esta entrega não aplica migration nem altera dados remotos.

Para reverter, restaure a versão anterior da aplicação/servidor junto de `supabase/rollback/20261026004301_online_payment_gate_down.sql`. O snapshot privado restaura assinaturas, definições, grants e policies; a coluna/índice e os triggers novos são removidos. Pedidos, pagamentos, notificações, auditoria e movimentações de estoque são preservados. Cancelamentos e pagamentos já concluídos não são desfeitos.
