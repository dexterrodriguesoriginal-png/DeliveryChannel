# ADEGAFOOD — MANUAL DE INTEGRAÇÃO COM SUPABASE REAL (COMANDO 06 & 07)
Versão: 2.0 Hardened Multi-Tenant

## 1. Visão Geral da Arquitetura de Conexão

O AdegaFood está conectado com o projeto remoto do **Supabase**.

- **URL do Projeto:** `https://qjmhlbipmwobnuctzpft.supabase.co`
- **Chave de API:** `VITE_SUPABASE_PUBLISHABLE_KEY` (Chave pública padrão Supabase, segura para uso no cliente via browser).
- **Sem Segredos Expostos:** Nenhuma `service_role` ou chave secreta foi inserida na aplicação frontend.
- **Client Central:** Inicializado em `src/lib/supabase.ts` com `createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true } })`.

---

## 2. Camada de Repositórios & RPCs Seguras

A comunicação com o banco é estruturada através do **Repository Pattern** em conformidade com o hardening de segurança (Comando 07):

1. **`src/repositories/publicStoreRepository.ts`** *(NOVO - Hardening Comando 07)*:
   - Consome a RPC `public.get_public_store(p_slug)` para buscar cardápio, produtos, categorias, banners e temas de modo seguro.
   - Dispara eventos de navegação/carrinho via RPC `public.track_public_event(p_tenant_slug, p_event_name, p_metadata)`.
   - Impede vazamento global de produtos ou custos para usuários não autenticados.

2. **`src/repositories/productRepository.ts`**:
   - Gestão autenticada de catálogo na tabela `public.products`.
   - Integração com `publicStoreRepository` para o cardápio público seguro.

3. **`src/repositories/orderRepository.ts`**:
   - Processamento de pedidos via procedure atômica `public.process_checkout_atomic`.
   - Valida estoque com bloqueio de concorrência (`FOR UPDATE`), status ativo do tenant e recálculo server-side dos preços.
   - Sincronização em tempo real via canais `supabase.channel('tenant-orders-${tenantId}')`.

4. **`src/repositories/categoryRepository.ts`**:
   - Gestão de categorias na tabela `public.categories`.

5. **`src/repositories/offerRepository.ts`**:
   - Gestão de banners e ofertas na tabela `public.offers`.

6. **`src/repositories/inventoryRepository.ts`**:
   - Movimentações de Kardex na tabela `public.inventory_movements`.

7. **`src/repositories/tenantRepository.ts`**:
   - Multi-tenant real nas tabelas `public.tenants`, `public.tenant_settings` e `public.tenant_themes`.

8. **`src/repositories/customerRepository.ts`**:
   - Gestão de clientes e histórico de compras na tabela `public.customers`.

9. **`src/repositories/auditLogRepository.ts`**:
   - Trilha de auditoria centralizada na tabela `public.audit_logs`.

---

## 3. Autenticação Oficial (Supabase Auth)

A autenticação em `src/context/AuthContext.tsx` gerencia:
- **`signInWithPassword`**: Login com e-mail e senha.
- **`signUp`**: Cadastro de novos usuários.
- **`signInWithGoogle`**: Integração direta via OAuth do Supabase.
- **`signOut`**: Encerramento seguro da sessão.
- **`onAuthStateChange`**: Sincronização contínua do estado de sessão.

---

## 4. Status da Migration

- Arquivo: `supabase/migrations/20260922000001_initial_schema.sql`
- Total de tabelas: **17 tabelas de domínio**.
- Status: **Auditada e Pronta para Aplicação**.
- *Nota*: A migration ainda NÃO foi executada no banco remoto, aguardando comando do operador.
