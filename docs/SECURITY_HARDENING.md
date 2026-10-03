# ADEGAFOOD — HARDENING DE SEGURANÇA DA MIGRATION SUPABASE
Versão: 2.5 Hardened (PostgreSQL 15+ / Supabase Multi-Tenant Zero-Trust)

Este documento registra as auditorias e melhorias de segurança aplicadas no arquivo `supabase/migrations/20260922000001_initial_schema.sql` antes de sua aplicação em produção.

---

## 1. Resumo Executivo das Correções (Comandos 07, 08 e 09)

| Item | Vulnerabilidade Anterior | Solução Implementada (Hardening) |
|---|---|---|
| **Contagem de Tabelas** | Documentava 16 tabelas | Corrigido para 17 tabelas oficiais de domínio |
| **Exposição Global de Tenants** | Consulta direta `SELECT USING (status = 'ACTIVE')` expunha todos os lojistas | Removida leitura ampla da tabela tenants. Acesso público concedido unicamente via `get_public_store(p_slug)` |
| **Privacidade de Estoque e SKU** | `stockQuantity` e `sku` retornados para visitantes anônimos | No catálogo público, `stock_quantity` e `sku` foram removidos. O cliente recebe unicamente `isAvailable` (booleano) |
| **Email Administrativo** | Email da loja retornado publicamente | Removido do catálogo público; apenas nome, telefone e categoria pública são fornecidos |
| **RBAC Granular** | Autorização baseada puramente em `tenant_id` ou `is_tenant_admin` genérico | Implementadas funções `has_tenant_role` e `has_tenant_permission`. Papéis restritos: DRIVER/CUSTOMER não alteram catálogo, estoque ou clientes |
| **Integridade de Auditoria** | `log_audit_event` com permissão pública `authenticated` permitindo forjar logs | Revogado `EXECUTE` de `authenticated` e `anon`. Tabelas de audit_logs são append-only e operadas internamente por transações do sistema |
| **Checkout IDOR / Spoofing** | Confiabilidade em `tenant_id` enviado pelo navegador | `process_checkout_atomic` aceita unicamente `p_tenant_slug` e resolve internamente o `tenant_id` |
| **Overselling / Concorrência** | Múltiplos pedidos simultâneos podiam negativar estoque | Implementado `SELECT ... FOR UPDATE` nos produtos durante a transação |
| **Integridade de Preço** | Risco de manipulação de preços via payload | Preço é recalculado no banco com base no catálogo oficial (ignora frontend) |
| **Status do Tenant** | Pedidos podiam ser gerados para tenants suspensos/inativos | O checkout aborta a transação se o tenant não estiver com status `ACTIVE` |
| **Pedido Mínimo** | Validação apenas na interface | O checkout rejeita no PostgreSQL caso o subtotal seja menor que `min_order_value` |
| **Tabelas Filhas** | `order_items` e `order_status_history` dependiam de herança fraca | Políticas RLS com cláusula relacional garantem isolamento estrito |
| **Telemetria Pública** | `app_events` exposto a injeção ou dados confidenciais | `track_public_event` com validação de slug (2 a 100 caracteres), whitelist rígida, limite de 2KB e rejeição regex a dados sensíveis |

---

## 2. Assinatura e Funcionamento das RPCs Seguras

### 2.1 `public.get_public_store(p_slug TEXT) -> JSONB`
- **Modo**: `SECURITY DEFINER` com `SET search_path = public, pg_temp`.
- **Comportamento**:
  - Verifica se o tenant existe e está com `status = 'ACTIVE'`.
  - Retorna em um único objeto JSON otimizado: `tenant` (sem email admin), `theme`, `settings` (apenas campos operacionais de checkout), `categories`, `products` (sem custo, sem sku, sem stockQuantity numérico, apenas `isAvailable`), e `offers`.
  - Concedido para `anon` e `authenticated`.

### 2.2 `public.process_checkout_atomic(...) -> UUID`
- **Modo**: `SECURITY DEFINER` com `SET search_path = public, pg_temp`.
- **Garantias**:
  - Transação ACID completa: se houver falta de estoque em qualquer item, o pedido não é criado.
  - Baixa de estoque atômica no cadastro de produtos e no Kardex (`inventory_movements`).
  - Criação ou atualização do cliente com cálculo de LTV e histórico de datas.

### 2.3 `public.track_public_event(p_tenant_slug TEXT, p_event_name TEXT, p_metadata JSONB) -> VOID`
- **Modo**: `SECURITY DEFINER` com `SET search_path = public, pg_temp`.
- **Garantias**:
  - Aceita apenas eventos válidos (`page_view`, `view_item`, `add_to_cart`, `remove_from_cart`, `begin_checkout`, `purchase_completed`).
  - Limita payload a 2048 bytes e proíbe dados confidenciais (senhas, documentos, cartões).

---

## 3. Estado de Prontidão

A migration `supabase/migrations/20260922000001_initial_schema.sql` está **100% pronta e auditada**, em conformidade com as melhores práticas de PostgreSQL e Supabase.
**Importante**: Nenhuma migration foi aplicada remotamente, respeitando a diretriz de não executar o SQL antes de ordem expressa.
