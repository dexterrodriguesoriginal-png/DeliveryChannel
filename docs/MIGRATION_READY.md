# ADEGAFOOD — STATUS DE PRONTIDÃO DA MIGRATION (MIGRATION READY)
Versão: 2.5 Hardened Multi-Tenant (PostgreSQL 15+ / Supabase Zero-Trust)
Status: **PRONTA PARA EXECUÇÃO FUTURA** (NÃO APLICADA - CONFORME COMANDO 09)

---

## 1. Sumário de Validações Realizadas

| Área de Auditoria | Status | Descrição |
|---|---|---|
| **Contagem de Tabelas** | 100% OK | 17 tabelas de domínio com chaves primárias UUID e chaves estrangeiras com integridade referencial. |
| **RBAC Granular** | 100% OK | Funções `has_tenant_role` e `has_tenant_permission` implementadas em `SECURITY DEFINER`. |
| **Proteção de DRIVER** | 100% OK | DRIVER impedido de editar produtos, categorias, temas, alterar estoque ou consultar toda a base de clientes. |
| **Proteção de CUSTOMER** | 100% OK | CUSTOMER sem acesso direto ao painel administrativo, clientes ou pedidos de terceiros. |
| **Catálogo Público Seguro** | 100% OK | `get_public_store(p_slug)` entrega dados sanitizados. Removidos `stockQuantity`, `sku`, `email` administrativo e `cost_price`. |
| **Disponibilidade** | 100% OK | Retorno público baseado exclusivamente no booleano `isAvailable = (stock_quantity > 0 AND is_active = true)`. |
| **Configurações Públicas** | 100% OK | Restritas estritamente aos parâmetros de cálculo de frete, pedido mínimo e dados de endereço/WhatsApp. |
| **Isolamento de Tenants** | 100% OK | Removida leitura ampla da tabela tenants (`status = ACTIVE`). O catálogo público resolve somente via slug. |
| **Checkout Atômico** | 100% OK | `process_checkout_atomic` resolve por slug no backend, bloqueia com `FOR UPDATE`, recalcula preços e taxas no banco e atualiza LTV/datas do cliente. |
| **Integridade de Auditoria** | 100% OK | `log_audit_event` com permissão de execução REVOGADA de `authenticated` e `anon`. Tabela `audit_logs` é append-only. |
| **Telemetria de Eventos** | 100% OK | `track_public_event` com validação de slug, whitelist de eventos, limite de 2KB e filtro regex contra dados sensíveis. |
| **Compilação e Tipagem** | 100% OK | TypeScript compilado com sucesso e lint validado. |
| **Ambiente Remoto** | PRESERVADO | Nenhuma query ou comando SQL foi executado contra o Supabase remoto. |

---

## 2. Relação das 17 Tabelas Prontas

1. `public.tenants`
2. `public.tenant_settings`
3. `public.tenant_themes`
4. `public.users`
5. `public.roles`
6. `public.tenant_users`
7. `public.customers`
8. `public.customer_consents`
9. `public.categories`
10. `public.products`
11. `public.offers`
12. `public.orders`
13. `public.order_items`
14. `public.order_status_history`
15. `public.inventory_movements`
16. `public.audit_logs`
17. `public.app_events`

---

## 3. Matriz de Autorização RLS / RBAC (Zero-Trust)

- **CEO / SUPER_ADMIN**: Acesso global auditado e leitura/suporte em todos os tenants.
- **OWNER**: Acesso irrestrito apenas ao próprio tenant.
- **MANAGER**: Acesso de gestão operacional do próprio tenant (catálogo, pedidos, relatórios), sem alteração de tema ou exclusão estrutural.
- **OPERATOR**: Acesso de atendimento e preparo de pedidos no próprio tenant.
- **CASHIER**: Acesso a fechamento de caixa e conferência de pedidos no próprio tenant.
- **DELIVERY_MANAGER**: Acesso de despacho e atribuição de rotas aos entregadores.
- **DRIVER**: Acesso restrito ao aplicativo de entrega (pedidos atribuídos). Bloqueado de alterações administrativas.
- **CUSTOMER / ANÔNIMO**: Consulta via `get_public_store(slug)` e checkout via `process_checkout_atomic(slug)`. Consulta direta a tabelas de banco NEGADA por RLS.
