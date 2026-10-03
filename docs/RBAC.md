# ADEGAFOOD — CONTROLE DE ACESSO BASEADO EM PAPÉIS (RBAC & RLS)
Versão: 2.5 Hardened Multi-Tenant (PostgreSQL / Supabase)

## 1. Matriz de Papéis e Níveis de Privilégio

O modelo RBAC do AdegaFood é implementado na tabela `public.roles` e vinculado aos usuários através da tabela `public.tenant_users`. O princípio de segurança adotado é:
**ROLE + TENANT + PERMISSION** (nunca apenas `tenant_id` cego).

| Papel | Nível | Escopo | Descrição das Permissões |
| :--- | :---: | :--- | :--- |
| **CEO** | 100 | Global (Todos os Tenants) | Acesso irrestrito a métricas consolidadas (GMV, pedidos globais), auditoria geral forense, patrocínios e modo suporte com registro de log obrigatório. |
| **SUPER_ADMIN** | 95 | Global (Todos os Tenants) | Administração global técnica do SaaS. |
| **OWNER** | 80 | Tenant Próprio | Gestão total do estabelecimento: catálogo, produtos, categorias, ofertas, pedidos, estoque (Kardex), financeiro, gestão de membros e customização de tema. |
| **MANAGER** | 60 | Tenant Próprio | Operação diária: gestão de catálogo, produtos, categorias, alteração de status de pedidos, atendimento e relatórios operacionais. Sem permissão de exclusão estrutural ou gestão de temas. |
| **OPERATOR** | 40 | Tenant Próprio | Operação de cozinha/balcão, visualização e atualização de status de pedidos. Sem permissão para editar produtos, categorias ou configurações sensíveis. |
| **CASHIER** | 35 | Tenant Próprio | Fechamento de caixa, recebimentos, confirmação de pagamento e visualização de pedidos. |
| **DELIVERY_MANAGER**| 30 | Tenant Próprio | Despacho de entregas e atribuição de rotas aos entregadores. |
| **DRIVER** | 20 | Tenant Próprio | Acesso exclusivo ao fluxo de entregas: visualização de rota atribuída e confirmação de entrega. Bloqueado de editar produtos, estoque ou ver clientes globais. |
| **CUSTOMER** | 10 | Público / Tenant Ativo | Acesso ao catálogo público via RPC segura (`get_public_store`), carrinho e checkout atômico (`process_checkout_atomic`). Bloqueado de consultar tabelas de pedidos e clientes diretamente. |

---

## 2. Funções de Autorização no Banco (Security Definer)

1. **`public.is_ceo(user_id UUID)`**:
   - Valida se o usuário autenticado possui role `CEO` ou `SUPER_ADMIN` ativa em `tenant_users`.
   - Utilizada em todas as políticas RLS para conceder visão global analítica e de suporte auditado.

2. **`public.has_tenant_role(p_user_id UUID, p_tenant_id UUID, p_roles TEXT[])`**:
   - Valida no banco se o usuário possui vínculo ativo no tenant correspondente com qualquer um dos papéis informados (ou se é CEO/SUPER_ADMIN).
   - Não confia em `tenant_id` ou `role_id` enviados pelo frontend.

3. **`public.has_tenant_permission(p_user_id UUID, p_tenant_id UUID, p_permission TEXT)`**:
   - Helper de autorização granular que checa capacidades de domínio (ex: `manage_catalog`, `manage_orders`, `view_customers`).

4. **`public.is_tenant_admin(user_id UUID, p_tenant_id UUID)`**:
   - Invoca `has_tenant_role(user_id, p_tenant_id, ARRAY['OWNER', 'MANAGER'])`.

5. **`public.get_auth_tenant(user_id UUID)`**:
   - Retorna o tenant primário do usuário logado para fins de compatibilidade legada.

---

## 3. Políticas RLS Aplicadas

Todas as 17 tabelas de domínio possuem `ROW LEVEL SECURITY` estritamente habilitado:

- **Tenants (`public.tenants`)**: Leitura pública ampla removida. Acesso público concedido estritamente via RPC `get_public_store(slug)`. Staff só visualiza o tenant ao qual pertence.
- **Configurações e Temas (`tenant_settings`, `tenant_themes`)**: Apenas OWNER e MANAGER autorizados. DRIVER e CUSTOMER completamente bloqueados.
- **Catálogo (`categories`, `products`, `offers`)**: Gerenciamento restrito a OWNER/MANAGER. Leitura administrativa apenas para staff do tenant. DRIVER e CUSTOMER não alteram dados.
- **Vendas (`orders`, `order_items`, `order_status_history`)**: Apenas membros autorizados do tenant e CEO podem consultar/atualizar. Criação de pedidos públicos blindada na procedure atômica `process_checkout_atomic`. Histórico de status é append-only.
- **Clientes e Privacidade (`customers`, `customer_consents`)**: Protegidos por LGPD. Restritos a OWNER, MANAGER e CASHIER do próprio tenant. DRIVER e CUSTOMER não consultam a base.
- **Estoque (`inventory_movements`)**: Kardex append-only. DRIVER e CUSTOMER bloqueados.
- **Auditoria (`audit_logs`)**: Append-only e blindada. `EXECUTE` de `log_audit_event` revogado de `authenticated` e `anon`. Logs são gerados internamente por procedures seguras.
- **Telemetria (`app_events`)**: Escrita pública controlada via `track_public_event` com validação de slug, whitelist de eventos, limite de 2KB e filtro contra dados sensíveis. Consulta apenas para OWNER/MANAGER/CEO.
