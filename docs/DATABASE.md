# ADEGAFOOD — ESQUEMA DE BANCO DE DADOS & ENTIDADES (POSTGRESQL / SUPABASE)
Versão: 2.5 Hardened Multi-Tenant (17 Tabelas de Domínio)

Este documento descreve detalhadamente o modelo de dados relacional oficial do AdegaFood implementado na migration `supabase/migrations/20260922000001_initial_schema.sql`.

---

## 1. Relação Oficial das 17 Tabelas

| # | Tabela | Descrição | Isolamento RLS & RBAC |
|---|---|---|---|
| 1 | `public.tenants` | Cadastro mestre do estabelecimento comercial | RLS (CEO / Staff do Tenant / Acesso público via RPC `get_public_store`) |
| 2 | `public.tenant_settings` | Regras operacionais (taxa frete, pedido mínimo, pix) | RLS por `tenant_id` + `has_tenant_role` |
| 3 | `public.tenant_themes` | Identidade visual white-label (cores, banner, logo) | RLS por `tenant_id` + `has_tenant_role` (apenas OWNER/CEO) |
| 4 | `public.users` | Perfis de usuários do painel (conectado ao auth.users) | RLS (Usuário dono ou CEO) |
| 5 | `public.roles` | Matriz de papéis RBAC do sistema | RLS (Leitura restrita a autenticados) |
| 6 | `public.tenant_users` | Associação de usuários a estabelecimentos e papéis | RLS por `user_id` / `tenant_id` / OWNER / CEO |
| 7 | `public.customers` | Cadastro de clientes com LTV e histórico | RLS por `tenant_id` + `has_tenant_role` (LGPD) |
| 8 | `public.customer_consents` | Registro forense de consentimento LGPD | RLS via `customer_id` -> `tenant_id` + RBAC |
| 9 | `public.categories` | Categorias do cardápio | RLS por `tenant_id` + `has_tenant_role` (sem vazamento público direto) |
| 10 | `public.products` | Catálogo de produtos, preços, custo e saldo de estoque | RLS por `tenant_id` + `has_tenant_role` (sem vazamento de custo/estoque) |
| 11 | `public.offers` | Banners promocionais e ofertas | RLS por `tenant_id` + `has_tenant_role` (sem vazamento público direto) |
| 12 | `public.orders` | Pedidos de venda com recalculo no backend | RLS por `tenant_id` + RBAC (inserção via RPC atômica) |
| 13 | `public.order_items` | Itens de cada pedido de venda | RLS via `order_id` -> `tenant_id` + RBAC |
| 14 | `public.order_status_history`| Trilha de auditoria das mudanças de status (append-only) | RLS via `order_id` -> `tenant_id` + RBAC (sem DELETE) |
| 15 | `public.inventory_movements`| Kardex oficial com rastreabilidade (append-only) | RLS por `tenant_id` + RBAC (sem UPDATE/DELETE) |
| 16 | `public.audit_logs` | Logs forenses de ações administrativas no sistema | RLS por `tenant_id` / CEO (append-only, sem insert do cliente) |
| 17 | `public.app_events` | Rastreamento analítico de eventos | RLS por `tenant_id` / CEO (inserção via `track_public_event`) |

---

## 2. Princípios de Segurança & Zero-Trust

1. **Acesso Público Seguro via RPC**:
   - As tabelas `tenants`, `products`, `categories` e `offers` **não** possuem políticas abertas com leitura pública direta.
   - Clientes públicos consom os dados exclusivamente através da função `SECURITY DEFINER` `public.get_public_store(p_slug TEXT)`, que mascara campos sensíveis (`cost_price`, `sku`, `stock_quantity` numérico, emails corporativos) e fornece apenas o status booleano `isAvailable`.
2. **Checkout Atômico Seguro (`process_checkout_atomic`)**:
   - Recebe `p_tenant_slug` (o servidor resolve o `tenant_id` internamente).
   - Bloqueia as linhas de estoque com `SELECT ... FOR UPDATE` para evitar condições de corrida (overselling).
   - Recalcula o subtotal com o preço oficial gravado no banco de dados.
   - Valida pedido mínimo e taxas de entrega a partir das configurações oficiais do tenant.
   - Atualiza o cliente (`first_order_date`, `last_order_date` e incremento no `ltv_amount`).
   - Insere o pedido, os itens, o histórico de status e gera as baixas no Kardex (`inventory_movements`).
3. **Isolamento Relacional das Tabelas Filhas**:
   - `order_items` e `order_status_history` são protegidas por políticas que inspecionam o vínculo relacional com `orders.tenant_id` e a role do usuário.
   - `customer_consents` é protegida pelo vínculo relacional com `customers.tenant_id`.
4. **Registro de Eventos Seguro (`track_public_event`)**:
   - Recebe o slug do tenant e valida se o evento faz parte de uma lista estrita de eventos analíticos permitidos.
   - Limita o payload de metadados a 2KB e aplica sanitização por regex contra vazamento de dados sensíveis.
5. **Auditoria Forense Blindada (`audit_logs`)**:
   - Append-only: proibido qualquer UPDATE ou DELETE por usuários normais.
   - Permissão de `EXECUTE` da procedure `log_audit_event` revogada de `PUBLIC`, `authenticated` e `anon`. Apenas procedures seguras e o sistema gravam logs.
