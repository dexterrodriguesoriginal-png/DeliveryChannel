# Marketing → Desempenho & Vendas

Aba de desempenho dos cards/ofertas promocionais (OWNER/MANAGER). Sequência oficial do banco: **001–020 → N1 → (N1.V manual) → N2 → N3 → N4 → N5 → N6**. As migrations 021–027 estão em `supabase/migrations_quarantine/` (decisão do fundador, opção B, 14/10/2026) e **não** fazem parte da ativação.

## Fonte dos dados e regras

- Fonte única: RPC `public.get_promo_offer_performance(p_tenant_id, p_from, p_to)` (migration N5), `SECURITY DEFINER`, exige `auth.uid()` e `is_tenant_owner_or_manager` (CEO/SUPER_ADMIN, CASHIER, OPERATOR, cliente e anon recebem `FORBIDDEN`/sem EXECUTE). Período máximo 400 dias (`INVALID_PERIOD`).
- Atribuição: só pedidos com `orders.offer_id` gravado **pelo servidor** em `process_promotional_checkout_atomic` (N6), após validar a cadeia tenant → campanha → card → oferta → produto (`_resolve_promotional_terms`). Colunas de atribuição são imutáveis (trigger N1 `_orders_protect_columns`; INSERT/UPDATE em `orders` revogados de `authenticated`).
- Um pedido conta uma única vez (agregação por pedido). Venda comum do mesmo produto não é atribuída.
- Faturamento válido = `total_amount − delivery_fee` de pedidos não cancelados/estornados. Cancelados e estornados aparecem só como "invalidados"; a transição válido → inválido reverte de forma atômica os usos da promoção e o cupom (`_orders_promo_lifecycle`).
- Benefícios resgatados = unidades de itens `item_kind = 'OFFER'`; desconto = (preço original − preço promocional) × qtd + parcela de cupom.
- Visualizações/cliques não são exibidos (sem rastreamento confiável); conversão não é calculada.

## Como a aba consome

`promoPerformanceRepository.getPerformance` chama a RPC para o período atual e o anterior (comparação). Resultados:
- `server`: linhas validadas por `parseServerPerformance` e resumidas por `summarizeServerPerformance`.
- `unavailable` (função inexistente — N1–N6 não aplicado): estado vazio explicativo, KPIs "—", nenhum número inventado.
- erro: mensagem amigável (permissão/período) com "Tentar novamente".
- `demo` apenas sem Supabase configurado (ambiente local).

## Dependências para ativar N1–N6 (nada é aplicado automaticamente)

1. Ensaiar em projeto de staging separado (não Supabase Branching) com cópia F6 (`supabase/staging/`), rodar prechecks e `supabase/tests/n1n6/run_all.sh`.
2. Aplicar na ordem N1 → N1.V (`supabase/manual/n1v_validate_constraints.sql`, manual) → N2 … N6; rollbacks manuais em `supabase/rollback/`.
3. Frontend pendente (N1/N2 quebram o front atual): status/pagamento de pedido via RPCs, PDV via `process_pos_sale_atomic`, checkout v2/promocional com idempotência, PIX em `tenant_payment_settings`, cupom validado no servidor, mídia N3, campanhas/analytics N5/N6, mapper da loja pública, `prep_time` sem default 30, colunas de ofertas compatíveis com N4 e remoção do bypass de login.
4. Só então produção, com backup e janela definida pelo fundador.

O workflow `migration-quarantine-guard.yml` só roda o guard estático (sem segredos, sem conexão a banco).
