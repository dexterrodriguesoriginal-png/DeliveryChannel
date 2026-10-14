# Quarentena das migrations 021–027 — NÃO APLICAR

Os arquivos `.sql` desta pasta são **legado NÃO aplicado em produção** (projeto Supabase de produção está no estado 001–020).
Foram movidos de `supabase/migrations/` com `git mv` no `main` (fonte oficial) por decisão do fundador
(decisão 17 do DESIGN_N1_N6_ARQUITETURA_v3; opção B de 14/10/2026: a sequência oficial é N1–N6). **Não foram apagados** e ficam apenas como referência histórica.

Regras:

- **Não aplicar** nenhum destes arquivos em nenhum ambiente (produção, staging ou local de homologação).
- **Não executar `supabase db push`** com estes arquivos em `supabase/migrations/`.
- **Não mesclar** de volta para `supabase/migrations/`. A guarda de CI `scripts/ci/check_migration_quarantine.sh`
  (workflow `.github/workflows/migration-quarantine-guard.yml`) falha se qualquer um deles — por versão, nome ou conteúdo — voltar.
- O Supabase CLI só lê `supabase/migrations/`; por isso, nesta pasta, os arquivos não são candidatos a push.
- O que substituiu estas migrations: N1–N6 (`supabase/migrations/20261006000100_*` … `20261006000600_*`), construídas a partir
  do estado real 001–020.

| Arquivo | Situação |
|---|---|
| `20261002000021_tenant_default_prep_time.sql` | legado, não aplicado (default 30 de prep time foi rejeitado — decisão 14) |
| `20261002000022_promotional_carousels_and_coupons.sql` | legado, não aplicado (policies sem tenant — vazamento de cupons) |
| `20261003000023_promotional_cards_media_and_atomic_coupons.sql` | legado, não aplicado (bucket público inteiro; `redeem_coupon` para anon) |
| `20261003000024_promotional_cards_scheduling_datetime.sql` | legado, não aplicado |
| `20261003000025_campaigns_cards_analytics_attribution.sql` | legado, não aplicado |
| `20261003000026_promotional_cards_own_checkout.sql` | legado, não aplicado |
| `20261014000027_promo_card_attribution_integrity.sql` | legado, não aplicado. Criada em 14/10 sobre a 026 para a aba Desempenho & Vendas; **substituída pelo N5** (`get_promo_offer_performance`, atribuição com FK composta tenant+id e imutabilidade da N1). Rollback e teste local dela ficam em `rollbacks/` e `tests/` desta pasta, só como referência. |
| `20261003000027_fix_promotional_cards_public_store.sql` | **não existe no `main`** (só na branch remota `fix/promotional-cards-public-store`, commit `4c3f119`); não foi trazido para cá. A guarda de CI também bloqueia sua versão, nome e hash (`4d562297…a39666`). |
