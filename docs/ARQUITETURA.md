# ADEGAFOOD — ARQUITETURA DE SISTEMA (COMANDO 06 & 07 HARDENED)
Versão: 2.0 Hardened Multi-Tenant (React + Vite + PostgreSQL / Supabase)

## 1. Visão Geral da Arquitetura

O AdegaFood é construído como uma aplicação SaaS multi-tenant em **React + Vite + TypeScript**, conectada à infraestrutura de backend do **Supabase**.

```
+-----------------------------------------------------------------------------------+
|                                CAMADA DE APRESENTAÇÃO                             |
|  - Painel do Lojista (15 módulos)   - App PWA do Cliente (Catálogo Seguro, Checkout)|
|  - Command Center CEO (HQ)          - App do Entregador (Rotas & GPS)             |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                           CAMADA DE CONTEXTO E ESTADO                             |
|  - AuthContext (supabase.auth, getSession, onAuthStateChange, Google OAuth)        |
|  - ToastContext (Notificações visuais)                                            |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                           CAMADA DE SERVIÇOS DE DOMÍNIO                           |
|  - productService, orderService, categoryService, offerService, etc.              |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                     CAMADA DE REPOSITÓRIOS & CLIENTE SUPABASE                     |
|  - publicStoreRepository (RPC get_public_store & track_public_event) [NOVO]       |
|  - orderRepository (RPC atômica process_checkout_atomic com LOCK FOR UPDATE)      |
|  - productRepository, categoryRepository, offerRepository, customerRepository     |
|  - inventoryRepository (Kardex), tenantRepository, auditLogRepository            |
+-----------------------------------------------------------------------------------+
                     |                                           |
    (Operação Primária / Nuvem)                    (Fallback Local / Cache)
                     v                                           v
+------------------------------------+          +------------------------------------+
|          SUPABASE REMOTO           |          |           DATASTORE LOCAL          |
|  - PostgreSQL Database (17 tabelas)|          |  - Memória Reativa (Listeners)     |
|  - Row Level Security (RLS 100%)   |          |  - LocalStorage Persistência       |
|  - Funções SECURITY DEFINER        |          |  - SecurityEngine Zero-Trust       |
|  - Supabase Auth (JWT & OAuth)     |          +------------------------------------+
|  - Supabase Realtime (WebSockets)  |
+------------------------------------+
```

## 2. Princípios de Isolamento Multi-Tenant & Hardening

1. **Separação Obrigatória por `tenant_id`:** Toda entidade de negócio (produtos, categorias, pedidos, movimentações de estoque, clientes) é obrigatoriamente vinculada a um `tenant_id` (UUID).
2. **Prevenção contra Exposição Global:**
   - As tabelas `products`, `categories` e `offers` **não** possuem políticas abertas com `is_active = true`.
   - O acesso ao cardápio público ocorre exclusivamente via função RPC `get_public_store(p_slug)`, blindando dados de custo e estoque interno de outros estabelecimentos.
3. **Checkout Atômico com Lock Anti-Overselling:**
   - A procedure `process_checkout_atomic` resolve o tenant através do slug, bloqueia as linhas com `SELECT ... FOR UPDATE`, recalcula preços no banco, valida estoque e insere o pedido em uma única transação ACID.
4. **Isolamento em Tabelas Filhas:**
   - `order_items`, `order_status_history` e `customer_consents` possuem validação relacional estrita com a tabela pai correspondente.
5. **CEO Global com Auditoria:**
   - O CEO tem privilégios concedidos via verificação no banco (`public.is_ceo(auth.uid())`), com auditoria forense obrigatória em todas as ações de suporte.
