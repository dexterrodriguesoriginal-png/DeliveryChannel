# Marketing → Desempenho & Vendas

Painel analítico **somente dos Cards Promocionais** (tabela `offers`) e dos pedidos que eles originaram.
Não é dashboard geral da loja.

## Fonte dos dados e regras
| Indicador | Fonte | Regra |
|---|---|---|
| Pedidos via promoção | `orders.offer_id` gravado pela RPC `process_promotional_checkout_atomic` | pedido conta 1 vez, só para o card de origem; `CANCELLED` ou `payment_status = REFUNDED` ficam fora |
| Faturamento promocional | `orders.total_amount − orders.delivery_fee` | só pedidos válidos; itens já com desconto, sem frete |
| Benefícios resgatados | `orders.campaign_metadata.redemption_number` (gravado pelo servidor) | pedido válido com registro de resgate |
| Ticket médio | faturamento ÷ pedidos válidos | `—` quando não há pedidos |
| Desconto × faturamento | `order_items.discount_amount` dos itens do card + `orders.discount` | desconto por R$ 1 vendido; `sem faturamento` quando 0 |
| Comparação com período anterior | mesmo cálculo no período imediatamente anterior de mesma duração | sem base anterior → não exibe % |
| Top 3 | faturamento atribuído no período | só cards com faturamento > 0 |
| Sem venda há 7 dias | cards de checkout promocional ativos há ≥ 7 dias sem pedido válido nos últimos 7 dias | independe do período selecionado |
| Limite de usos ≥ 90% | `offers.promo_times_used / promo_usage_limit` | contador acumulado (sem período) |
| CSV | mesmos números da tabela, por card e período | `;` como separador, decimal com vírgula, UTF-8 com BOM |

Sem dado não há número: visualizações, cliques e conversão **não** são exibidos (sem rastreamento confiável);
cards "Apenas visual" e "Produto do catálogo" mostram `n/a` (a venda comum do produto não é atribuída ao card).

Isolamento: consulta com filtro explícito `tenant_id` + RLS `orders_staff_select`/`order_items_staff_select`;
a lógica descarta pedidos e cards de outra loja.

## Banco: o que precisa estar ativo
Sequência do `main` (fonte oficial): `supabase/migrations` 001–026 + **027**.

* **026** `20261003000026_promotional_cards_own_checkout.sql`: cria `orders.offer_id`, `order_items.offer_id/discount_amount`,
  `offers.promo_times_used` e a RPC de checkout promocional que grava a origem no servidor (valida card × loja).
* **027** `20261014000027_promo_card_attribution_integrity.sql`:
  * corrige dois defeitos da 026 que faziam **todo** checkout promocional falhar (reproduzido em Postgres local):
    `customers.notes` inexistente (coluna nula adicionada) e `campaign_analytics_events.card_id` recebendo um id de
    `offers` (FK para `campaign_cards`; agora `NULL`, `offer_id` mantido);
  * triggers que exigem card da mesma loja do pedido e tornam imutáveis a origem (`offer_id`), o resgate
    (`redemption_number`) e o desconto promocional do item;
  * prechecks que abortam se a 026 não estiver aplicada ou se existir atribuição entre lojas.
  * Rollback manual: `supabase/rollbacks/20261014000027_promo_card_attribution_integrity.rollback.sql`.

A 027 depende de 021–026 (025 cria `campaign_analytics_events`/`orders.campaign_metadata`).
Produção hoje está em 001–020: até 021–027 serem aplicadas (staging antes), a tela mostra o estado vazio
"origem promocional não registrada" e nenhum número.

## Relação com N1–N6 e quarentena 021–027
O ciclo N1–N6 (branch local `feat/n1-n6-clean-production`, não publicada) move 021–026 para
`supabase/migrations_quarantine/` e reconstrói a atribuição no N5 (`orders.offer_id` com FK composta tenant+id).
O `main` **não** adotou essa quarentena: 021–026 continuam em `supabase/migrations` e a 027 segue essa estrutura.
Se N1–N6 for integrado ao `main`, a 027 deve ir para a quarentena junto com 021–026 e o painel passa a ler
os mesmos campos criados pelo N5 (`orders.offer_id`; o registro de resgate deve ser mantido no N5).
Nenhuma das duas sequências deve ser aplicada por `db push` sem a validação em staging.
