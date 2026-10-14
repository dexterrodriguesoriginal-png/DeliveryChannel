# Ativação do frontend N1–N6 (flag `VITE_BACKEND_SCHEMA`)

O `main` é publicado no AI Studio, mas o banco de produção continua em **001–020** até o staging
validar N1–N6. Por isso o frontend escolhe o caminho de servidor por uma variável de **build**:

| Valor | Quando usar | Banco esperado |
|---|---|---|
| `legacy-020` (**padrão**; também se a variável faltar, estiver vazia ou inválida) | hoje, produção | 001–020 |
| `n1n6` | somente depois de N1 → N1.V → N2 … N6 aplicadas e validadas no banco alvo | 001–020 + N1–N6 |

Código: `src/lib/backendSchema.ts` (`isN1N6Backend()`), usado pelos repositórios.
Em nenhum dos modos existe fallback silencioso para `localStorage`/mock/`dataStore` quando o Supabase
está configurado; o modo demonstração local só existe em `DEV` **sem** Supabase (`isLocalDemoAllowed`).

## Como trocar na ativação

1. Staging: aplicar a sequência oficial **001–020 → N1 → N1.V (`supabase/manual/n1v_validate_constraints.sql`, manual) → N2 → N3 → N4 → N5 → N6**
   (021–027 seguem em `supabase/migrations_quarantine/` e não fazem parte da ativação). Rodar
   `supabase/tests/n1n6/run_all.sh` localmente antes, e os prechecks no staging.
2. Build de staging com `VITE_BACKEND_SCHEMA=n1n6` e validar os fluxos abaixo (checklist F6).
3. Produção: aplicar a mesma sequência; **só depois** publicar o build com `VITE_BACKEND_SCHEMA=n1n6`.
   Publicar `n1n6` contra banco 001–020 quebra checkout/PDV/PIX (RPCs inexistentes) — por isso o padrão é `legacy-020`.
4. Rollback: voltar o build para `legacy-020` **antes** de reverter as migrations (scripts em `supabase/rollback/`).

## O que cada modo faz

| Fluxo | `legacy-020` (001–020) | `n1n6` |
|---|---|---|
| Status do pedido | `UPDATE orders` sob RLS de staff + histórico; cancelado não reabre (bloqueio no cliente); motivo obrigatório para cancelar | `update_order_status(p_order_id,p_new_status,p_note)` — regras no servidor |
| Pagamento (PAGO/ESTORNADO) | indisponível (`N1N6_REQUIRED`) | `update_order_payment_status`; estorno só OWNER/MANAGER com motivo |
| PDV (balcão) | **indisponível** (`N1N6_REQUIRED`, botão desabilitado): 001–020 não tem política RLS de INSERT em `orders`, então não há caminho de servidor (o antigo INSERT direto só "funcionava" porque o fallback local mascarava a falha) | `process_pos_sale_atomic` com idempotência; cupom pelo servidor (`validate_coupon_pos`); OWNER/MANAGER/CASHIER |
| Checkout da vitrine | `process_checkout_atomic` (exige login; preço do servidor; origem mapeada para o CHECK legado) | `process_checkout_atomic_v2` com `p_idempotency_key` e cupom |
| Checkout promocional (oferta/card) | indisponível | `process_promotional_checkout_atomic` (oferta ou card de campanha) |
| PIX | sem BR Code fictício; mostra a chave pública da loja (ou "loja enviará pelo WhatsApp"); chave editável só por OWNER/MANAGER | `tenant_payment_settings` via `upsert_tenant_payment_settings` (OWNER/MANAGER; chave mascarada); cliente recebe só o payload do **próprio** pedido (`get_order_pix_payload`) |
| Cupons | indisponível | `validate_coupon` / `validate_coupon_pos`; CASHIER aplica mas não gerencia |
| Cards promocionais (offers) | grava só colunas de 001 | + colunas N4 (`has_promo_checkout`, `promo_price`, `promo_fulfillment`, `promo_max_qty_per_order`, `promo_usage_limit`, `start_at/end_at`, `auto_overlay`, `media_asset_id`); nunca `promo_times_used`; checkout promocional exige produto |
| Mídia | upload indisponível (usar URL) | N3: `register_marketing_asset` → upload `marketing` → `confirm_marketing_upload` → publicar em `marketing-public`; despublicar com motivo |
| Campanhas/cards/métricas | indisponível (aba oculta) | N5 (OWNER/MANAGER): CRUD, `get_campaign_metrics`, eventos `track_campaign_event` |
| Vitrine | `get_public_store` de 001–020 | `get_public_store` N6 (mídia publicada, carrosséis, cards de campanha) |
| Tempo de preparo | sem default 30 | `default_prep_time_minutes` (N1), sem default 30 |
| Login | sem bypass ("Acessar Painel sem Fazer Login" removido) | idem |
| Desempenho & Vendas | `get_promo_offer_performance` (N5) — só funciona com N5 aplicada | idem |

### Limitações conhecidas do `legacy-020` (não pioradas; corrigidas no N1–N6)
- Cancelamento devolve estoque pelo navegador (não atômico) e o servidor 001–020 não impede reabrir pedido cancelado (o frontend bloqueia).
- `tenant_settings.pix_key` continua legível por quem lê `tenant_settings` em 001–020.
- Sem cupons, PDV, checkout promocional, PIX por pedido, mídia N3 e campanhas N5.

## Testes
- Unidade/contrato: `npm test` (inclui `src/repositories/__tests__/n1n6Frontend.test.ts`, com JSON real do `get_public_store` N6 extraído do PostgreSQL local).
- Integração **real** (supabase-js → PostgREST local → PostgreSQL local; nunca remoto):
  `tests/integration/setup_local_backend.sh /caminho/postgrest` e depois `npm run test:integration`.
- Navegador (Chrome headless): `tests/integration/e2e_https_proxy.mjs` (proxy HTTPS local + `/auth/v1/user` de teste) e `tests/integration/e2e_browser.mjs`, com `vite` apontando para o proxy.
- SQL: `supabase/tests/n1n6/run_all.sh`; guarda de quarentena: `scripts/ci/check_migration_quarantine.sh`.
