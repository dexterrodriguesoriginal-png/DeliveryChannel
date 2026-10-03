-- ==============================================================================
-- ADEGAFOOD — MIGRATION 001: INITIAL SCHEMA & ROW LEVEL SECURITY (RLS)
-- Versão: 2.1 Hardened (PostgreSQL 15+ / Supabase Multi-Tenant Zero-Trust)
-- Total de Tabelas: 17
-- ==============================================================================

-- 1. EXTENSÕES OBRIGATÓRIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TABELAS DE TENANTS E CONFIGURAÇÃO
-- ==============================================================================

-- Tabela 1: Estabelecimentos (Tenants)
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    document VARCHAR(32) NOT NULL, -- CNPJ ou CPF
    phone VARCHAR(32) NOT NULL,
    email VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'ADEGA',
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING', 'INACTIVE')),
    plan_tier VARCHAR(32) NOT NULL DEFAULT 'STANDARD' CHECK (plan_tier IN ('FREE', 'STANDARD', 'PRO', 'ENTERPRISE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants(status);

-- Tabela 2: Configurações Operacionais do Tenant
CREATE TABLE IF NOT EXISTS public.tenant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
    is_open BOOLEAN NOT NULL DEFAULT true,
    min_order_value NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (min_order_value >= 0),
    delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (delivery_fee >= 0),
    free_delivery_threshold NUMERIC(10,2) CHECK (free_delivery_threshold >= 0),
    estimated_delivery_time VARCHAR(64) NOT NULL DEFAULT '30-45 min',
    address TEXT NOT NULL,
    city VARCHAR(128) NOT NULL DEFAULT 'São Paulo',
    phone_whatsapp VARCHAR(32) NOT NULL,
    pix_key VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabela 3: Personalização Visual / White-Label do Tenant (Tema)
CREATE TABLE IF NOT EXISTS public.tenant_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
    store_name VARCHAR(255) NOT NULL,
    tagline TEXT,
    logo_url TEXT,
    banner_url TEXT,
    primary_color VARCHAR(16) NOT NULL DEFAULT '#15803d',
    secondary_color VARCHAR(16) NOT NULL DEFAULT '#166534',
    background_color VARCHAR(16) NOT NULL DEFAULT '#f8fafc',
    card_color VARCHAR(16) NOT NULL DEFAULT '#ffffff',
    button_color VARCHAR(16) NOT NULL DEFAULT '#15803d',
    text_color VARCHAR(16) NOT NULL DEFAULT '#0f172a',
    border_radius VARCHAR(16) NOT NULL DEFAULT '1rem',
    font_family VARCHAR(64) NOT NULL DEFAULT 'Inter',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 3. AUTENTICAÇÃO, USUÁRIOS E RBAC
-- ==============================================================================

-- Tabela 4: Perfis de Usuários (Conectada com chave estrangeira real a auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabela 5: Definição de Papéis (Roles)
CREATE TABLE IF NOT EXISTS public.roles (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    description TEXT,
    level INT NOT NULL CHECK (level >= 0 AND level <= 100)
);

INSERT INTO public.roles (id, name, description, level) VALUES
('CEO', 'CEO Global', 'Acesso irrestrito a todos os estabelecimentos e auditoria global', 100),
('SUPER_ADMIN', 'Super Administrador', 'Administração global do SaaS', 95),
('OWNER', 'Proprietário', 'Controle total sobre o estabelecimento e financeiro', 80),
('MANAGER', 'Gerente', 'Gestão de catálogo, pedidos e operação', 60),
('OPERATOR', 'Operador de Loja', 'Controle operacional e preparo de pedidos', 40),
('CASHIER', 'Operador de Caixa', 'Abertura, fechamento e cobranças', 35),
('DELIVERY_MANAGER', 'Coordenador de Entregas', 'Despacho de motoboys e rotas', 30),
('DRIVER', 'Entregador', 'Aceite e conclusão de corridas', 20),
('CUSTOMER', 'Cliente Final', 'Compra de produtos no cardápio público', 10)
ON CONFLICT (id) DO NOTHING;

-- Tabela 6: Vínculo de Usuários com Tenants e Roles (Multi-Tenant RBAC)
CREATE TABLE IF NOT EXISTS public.tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE, -- NULL caso seja CEO/SUPER_ADMIN global
    role_id VARCHAR(32) NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INVITED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON public.tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON public.tenant_users(tenant_id);

-- Proteção contra duplicação de vínculos globais quando tenant_id é NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_users_global_user ON public.tenant_users(user_id) WHERE tenant_id IS NULL;

-- ==============================================================================
-- 4. CLIENTES E CONSENTIMENTOS LGPD
-- ==============================================================================

-- Tabela 7: Clientes (com suporte a marketplace, qr_code, etc)
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    email VARCHAR(255),
    origin VARCHAR(32) NOT NULL DEFAULT 'direct' CHECK (origin IN ('qr_code', 'whatsapp', 'instagram', 'direct', 'marketplace', 'google', 'indicacao', 'direto', 'outros')),
    total_orders INT NOT NULL DEFAULT 0,
    ltv_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (ltv_amount >= 0),
    first_order_date DATE,
    last_order_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON public.customers(tenant_id, phone);

-- Tabela 8: Consentimentos LGPD
CREATE TABLE IF NOT EXISTS public.customer_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    consent_type VARCHAR(64) NOT NULL DEFAULT 'LGPD_TERMS',
    accepted BOOLEAN NOT NULL DEFAULT true,
    ip_address VARCHAR(64),
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 5. CATÁLOGO: CATEGORIAS, PRODUTOS E OFERTAS
-- ==============================================================================

-- Tabela 9: Categorias de Produtos
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    image_url TEXT,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant ON public.categories(tenant_id, is_active);

-- Tabela 10: Produtos
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    promotional_price NUMERIC(10,2) CHECK (promotional_price >= 0),
    cost_price NUMERIC(10,2) CHECK (cost_price >= 0),
    sku VARCHAR(64),
    unit VARCHAR(16) NOT NULL DEFAULT 'un',
    stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0), -- Saldo protegido no DB
    min_stock_alert INT DEFAULT 5,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_featured BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON public.products(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);

-- Tabela 11: Banners e Ofertas Promocionais
CREATE TABLE IF NOT EXISTS public.offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    subtitle TEXT,
    description TEXT,
    badge VARCHAR(64),
    discount_percentage INT,
    original_price NUMERIC(10,2),
    promotional_price NUMERIC(10,2),
    image_url TEXT NOT NULL,
    internal_link TEXT,
    display_order INT NOT NULL DEFAULT 0,
    start_date DATE,
    end_date DATE,
    background_color VARCHAR(16),
    accent_color VARCHAR(16),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offers_tenant ON public.offers(tenant_id, is_active);

-- ==============================================================================
-- 6. PEDIDOS, ITENS E HISTÓRICO DE AUDITORIA DE STATUS
-- ==============================================================================

-- Tabela 12: Pedidos (Orders)
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    driver_id UUID REFERENCES public.users(id) ON DELETE SET NULL, -- Atribuição real de motorista
    order_number SERIAL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(32) NOT NULL,
    customer_email VARCHAR(255),
    delivery_address TEXT NOT NULL,
    address_details JSONB,
    subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
    delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (delivery_fee >= 0),
    discount NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
    total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
    payment_method VARCHAR(32) NOT NULL CHECK (payment_method IN ('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH')),
    payment_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'PAYMENT_ON_DELIVERY', 'REFUNDED')),
    fulfillment_type VARCHAR(32) NOT NULL DEFAULT 'DELIVERY' CHECK (fulfillment_type IN ('DELIVERY', 'PICKUP')),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'WAITING_FOR_DRIVER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
    notes TEXT,
    origin VARCHAR(32) NOT NULL DEFAULT 'direct',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON public.orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_driver ON public.orders(driver_id, status, created_at DESC);

-- Tabela 13: Itens do Pedido
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(10,2) NOT NULL CHECK (total_price >= 0),
    notes TEXT,
    unit VARCHAR(16) NOT NULL DEFAULT 'un'
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);

-- Tabela 14: Histórico de Alterações de Status do Pedido
CREATE TABLE IF NOT EXISTS public.order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL,
    note TEXT,
    changed_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_history_order ON public.order_status_history(order_id);

-- ==============================================================================
-- 7. KARDEX & CONTROLE DE ESTOQUE ATÔMICO
-- ==============================================================================

-- Tabela 15: Movimentações de Kardex
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL, -- Positivo (entrada) ou Negativo (baixa/venda)
    type VARCHAR(32) NOT NULL CHECK (type IN ('ENTRADA', 'SAIDA', 'VENDA', 'ESTORNO', 'AJUSTE', 'PERDA')),
    reference_id VARCHAR(64), -- ID do pedido ou nota fiscal
    reason TEXT NOT NULL,
    previous_stock INT NOT NULL,
    new_stock INT NOT NULL,
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON public.inventory_movements(tenant_id, product_id, created_at DESC);

-- ==============================================================================
-- 8. AUDITORIA E EVENTOS DO SISTEMA (ZERO-TRUST FORENSE)
-- ==============================================================================

-- Tabela 16: Log de Auditoria
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    user_role VARCHAR(32) NOT NULL,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    tenant_name VARCHAR(255),
    action VARCHAR(64) NOT NULL,
    resource VARCHAR(64) NOT NULL,
    resource_id VARCHAR(64),
    details TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    ip_address VARCHAR(64),
    is_ceo_support BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON public.audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);

-- Tabela 17: Eventos da Aplicação
CREATE TABLE IF NOT EXISTS public.app_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    event_name VARCHAR(64) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_events_tenant ON public.app_events(tenant_id, created_at DESC);

-- ==============================================================================
-- 9. FUNÇÕES DE AUTORIZAÇÃO E SEGURANÇA (SECURITY DEFINER - SEMPRE auth.uid())
-- ==============================================================================

-- Helper 1: Identificar se o usuário autenticado é CEO Global / Super Admin
-- Usa auth.uid() internamente, desconsiderando spoofing de user_id pelo frontend.
CREATE OR REPLACE FUNCTION public.is_ceo(user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE user_id = auth.uid() 
          AND role_id IN ('CEO', 'SUPER_ADMIN') 
          AND status = 'ACTIVE'
    );
$$;

-- Helper 2: Identificar se o usuário autenticado possui papéis específicos em um determinado tenant
-- A verificação sempre afere o sujeito autenticado em auth.uid()
CREATE OR REPLACE FUNCTION public.has_tenant_role(
    p_user_id UUID,
    p_tenant_id UUID,
    p_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE user_id = auth.uid() 
          AND (
            (tenant_id = p_tenant_id AND role_id = ANY(p_roles) AND status = 'ACTIVE')
            OR 
            (role_id IN ('CEO', 'SUPER_ADMIN') AND status = 'ACTIVE')
          )
    );
$$;

-- Helper 3: Identificar se o usuário autenticado possui permissão específica sobre o tenant
CREATE OR REPLACE FUNCTION public.has_tenant_permission(
    p_user_id UUID,
    p_tenant_id UUID,
    p_permission TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.tenant_users tu
        WHERE tu.user_id = auth.uid() 
          AND (tu.tenant_id = p_tenant_id OR tu.role_id IN ('CEO', 'SUPER_ADMIN'))
          AND tu.status = 'ACTIVE'
          AND (
            tu.role_id IN ('CEO', 'SUPER_ADMIN')
            OR (tu.role_id = 'OWNER')
            OR (tu.role_id = 'MANAGER' AND p_permission IN ('view_dashboard', 'manage_catalog', 'manage_orders', 'view_customers', 'view_reports', 'manage_inventory'))
            OR (tu.role_id = 'OPERATOR' AND p_permission IN ('manage_orders', 'view_orders'))
            OR (tu.role_id = 'CASHIER' AND p_permission IN ('view_orders', 'manage_orders', 'view_finances'))
            OR (tu.role_id = 'DELIVERY_MANAGER' AND p_permission IN ('view_orders', 'dispatch_orders'))
            OR (tu.role_id = 'DRIVER' AND p_permission IN ('view_assigned_orders', 'deliver_orders'))
          )
    );
$$;

-- Helper 4: Identificar se o usuário logado é Proprietário ou Gerente (compatibilidade)
CREATE OR REPLACE FUNCTION public.is_tenant_admin(user_id UUID, p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER', 'MANAGER']);
$$;

-- Helper 5: Pegar o tenant_id primário do usuário autenticado (auth.uid())
CREATE OR REPLACE FUNCTION public.get_auth_tenant(user_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT tenant_id FROM public.tenant_users
    WHERE user_id = auth.uid() AND status = 'ACTIVE'
    LIMIT 1;
$$;

-- Helper 6: Registro Seguro de Log de Auditoria INTERNO pelo Sistema
-- Somente para uso interno por procedures autorizadas (EXECUTE revogado de anon e authenticated)
CREATE OR REPLACE FUNCTION public.log_audit_event(
    p_action VARCHAR(64),
    p_resource VARCHAR(64),
    p_details TEXT,
    p_resource_id VARCHAR(64) DEFAULT NULL,
    p_previous_value TEXT DEFAULT NULL,
    p_new_value TEXT DEFAULT NULL,
    p_tenant_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_role VARCHAR(32) := 'ANONYMOUS';
    v_user_name VARCHAR(255) := 'Sistema';
    v_tenant_id UUID := p_tenant_id;
    v_tenant_name VARCHAR(255) := NULL;
    v_is_ceo BOOLEAN := false;
    v_log_id UUID;
BEGIN
    IF v_user_id IS NOT NULL THEN
        SELECT u.name, tu.role_id, COALESCE(v_tenant_id, tu.tenant_id)
        INTO v_user_name, v_user_role, v_tenant_id
        FROM public.users u
        LEFT JOIN public.tenant_users tu ON tu.user_id = u.id AND tu.status = 'ACTIVE'
        WHERE u.id = v_user_id
        LIMIT 1;

        v_is_ceo := public.is_ceo(v_user_id);
    END IF;

    IF v_tenant_id IS NOT NULL THEN
        SELECT name INTO v_tenant_name FROM public.tenants WHERE id = v_tenant_id;
    END IF;

    INSERT INTO public.audit_logs (
        user_id,
        user_name,
        user_role,
        tenant_id,
        tenant_name,
        action,
        resource,
        resource_id,
        details,
        previous_value,
        new_value,
        is_ceo_support
    ) VALUES (
        COALESCE(v_user_id::text, 'system'),
        COALESCE(v_user_name, 'Sistema'),
        COALESCE(v_user_role, 'SYSTEM'),
        v_tenant_id,
        v_tenant_name,
        p_action,
        p_resource,
        p_resource_id,
        p_details,
        p_previous_value,
        p_new_value,
        v_is_ceo
    ) RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

-- ==============================================================================
-- 10. OPERAÇÃO SEGURA DE ENTREGADOR (UPDATE_DRIVER_ORDER_STATUS)
-- ==============================================================================

-- Atualiza apenas o status de entrega do pedido pelo motorista atribuído.
-- Impede expressamente a alteração de dados cadastrais ou financeiros do pedido.
CREATE OR REPLACE FUNCTION public.update_driver_order_status(
    p_order_id UUID,
    p_status VARCHAR,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_driver_name VARCHAR(255);
    v_order RECORD;
    v_allowed_driver_status VARCHAR[] := ARRAY['OUT_FOR_DELIVERY', 'DELIVERED', 'WAITING_FOR_DRIVER'];
BEGIN
    -- 1. Validar autenticação do motorista
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Validar que o usuário é motorista ativo
    SELECT u.name INTO v_driver_name
    FROM public.users u
    JOIN public.tenant_users tu ON tu.user_id = u.id
    WHERE u.id = v_driver_id 
      AND tu.role_id = 'DRIVER' 
      AND tu.status = 'ACTIVE'
    LIMIT 1;

    IF v_driver_name IS NULL THEN
        RAISE EXCEPTION 'Usuário não autorizado: papel DRIVER ativo não encontrado.';
    END IF;

    -- 3. Validar se o status solicitado é operacionalmente permitido ao motorista
    IF NOT (p_status = ANY(v_allowed_driver_status)) THEN
        RAISE EXCEPTION 'Status "%" não permitido para operação por motorista.', p_status;
    END IF;

    -- 4. Bloquear e validar o pedido atribuído
    SELECT id, tenant_id, status, driver_id INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_order.driver_id IS NULL OR v_order.driver_id <> v_driver_id THEN
        RAISE EXCEPTION 'Acesso negado: o pedido não está atribuído ao motorista autenticado.';
    END IF;

    -- 5. Atualizar EXCLUSIVAMENTE status e updated_at
    UPDATE public.orders
    SET status = p_status,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- 6. Inserir histórico de status com identidade garantida do motorista
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    ) VALUES (
        p_order_id,
        p_status,
        COALESCE(p_note, 'Atualização de rota pelo entregador'),
        v_driver_name,
        NOW()
    );

    -- 7. Gravar log de auditoria interno com contexto forense
    PERFORM public.log_audit_event(
        'ORDER_STATUS_UPDATE_DRIVER',
        'orders',
        'Motorista atualizou status do pedido #' || p_order_id::text || ' de ' || v_order.status || ' para ' || p_status,
        p_order_id::text,
        v_order.status,
        p_status,
        v_order.tenant_id
    );
END;
$$;

-- ==============================================================================
-- 11. CONTROLE ATÔMICO DE ESTOQUE E KARDEX (ADJUST_INVENTORY)
-- ==============================================================================

-- Realiza ajuste de estoque com validação de permissão e consistência matemática.
-- Impede estoque negativo, garante auditoria forense e gera Kardex verificado no DB.
CREATE OR REPLACE FUNCTION public.adjust_inventory(
    p_product_id UUID,
    p_quantity INT,
    p_type VARCHAR,
    p_reason TEXT,
    p_reference_id VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_name VARCHAR(255);
    v_prod RECORD;
    v_tenant_id UUID;
    v_prev_stock INT;
    v_new_stock INT;
    v_allowed_types VARCHAR[] := ARRAY['ENTRADA', 'SAIDA', 'AJUSTE', 'PERDA', 'ESTORNO'];
    v_movement_id UUID;
BEGIN
    -- 1. Validar autenticação
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Validar tipo de movimentação
    IF NOT (p_type = ANY(v_allowed_types)) THEN
        RAISE EXCEPTION 'Tipo de movimentação "%" inválido.', p_type;
    END IF;

    IF p_quantity = 0 THEN
        RAISE EXCEPTION 'A quantidade informada não pode ser zero.';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'O motivo do ajuste de estoque é obrigatório.';
    END IF;

    -- 3. Obter e bloquear a linha do produto
    SELECT id, tenant_id, name, stock_quantity INTO v_prod
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado.';
    END IF;

    v_tenant_id := v_prod.tenant_id;

    -- 4. Validar se o usuário autenticado possui permissão de gestão de estoque no tenant
    IF NOT public.has_tenant_permission(v_user_id, v_tenant_id, 'manage_inventory') THEN
        RAISE EXCEPTION 'Permissão negada: o usuário não possui autorização para gerenciar estoque neste estabelecimento.';
    END IF;

    -- Obter nome do usuário autenticado
    SELECT name INTO v_user_name FROM public.users WHERE id = v_user_id;
    v_user_name := COALESCE(v_user_name, 'Operador');

    -- 5. Calcular estoque de forma segura e consistente
    v_prev_stock := v_prod.stock_quantity;
    v_new_stock := v_prev_stock + p_quantity;

    IF v_new_stock < 0 THEN
        RAISE EXCEPTION 'Operação não permitida: estoque final resultante não pode ser negativo (Estoque atual: %, Ajuste: %).',
            v_prev_stock, p_quantity;
    END IF;

    -- 6. Atualizar estoque no produto
    UPDATE public.products
    SET stock_quantity = v_new_stock,
        updated_at = NOW()
    WHERE id = p_product_id;

    -- 7. Inserir movimento no Kardex oficial
    INSERT INTO public.inventory_movements (
        tenant_id,
        product_id,
        product_name,
        quantity,
        type,
        reference_id,
        reason,
        previous_stock,
        new_stock,
        created_by_name,
        created_at
    ) VALUES (
        v_tenant_id,
        p_product_id,
        v_prod.name,
        p_quantity,
        p_type,
        p_reference_id,
        p_reason,
        v_prev_stock,
        v_new_stock,
        v_user_name,
        NOW()
    ) RETURNING id INTO v_movement_id;

    -- 8. Gerar registro forense de auditoria
    PERFORM public.log_audit_event(
        'INVENTORY_ADJUSTMENT',
        'products',
        'Ajuste manual de estoque (' || p_type || ') de ' || p_quantity::text || ' unidades para o produto "' || v_prod.name || '". Motivo: ' || p_reason,
        p_product_id::text,
        v_prev_stock::text,
        v_new_stock::text,
        v_tenant_id
    );

    RETURN jsonb_build_object(
        'movementId', v_movement_id,
        'productId', p_product_id,
        'previousStock', v_prev_stock,
        'newStock', v_new_stock
    );
END;
$$;

-- ==============================================================================
-- 12. CATÁLOGO PÚBLICO SEGURO POR SLUG (SEM VAZAMENTO GLOBAL)
-- ==============================================================================

-- Retorna SOMENTE dados públicos da loja do slug informado.
-- Impede consulta global a produtos/categorias de outros tenants.
-- Nunca expõe custos, clientes, pedidos, financeiro, ou estoque detalhado interno.
-- Valida rigorosamente promoções (promotional_price > 0 e <= price).
CREATE OR REPLACE FUNCTION public.get_public_store(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant RECORD;
    v_theme RECORD;
    v_settings RECORD;
    v_categories JSONB;
    v_products JSONB;
    v_offers JSONB;
BEGIN
    -- 1. Resolver e validar o tenant pelo slug (apenas ACTIVE)
    SELECT id, slug, name, phone, category, status
    INTO v_tenant
    FROM public.tenants
    WHERE slug = p_slug AND status = 'ACTIVE';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Estabelecimento com slug "%" não encontrado ou inativo', p_slug;
    END IF;

    -- 2. Obter tema visual público
    SELECT store_name, tagline, logo_url, banner_url, primary_color, 
           secondary_color, background_color, card_color, button_color, 
           text_color, border_radius, font_family
    INTO v_theme
    FROM public.tenant_themes
    WHERE tenant_id = v_tenant.id;

    -- 3. Obter configurações operacionais públicas necessárias para a compra/retirada
    SELECT is_open, min_order_value, delivery_fee, free_delivery_threshold,
           estimated_delivery_time, address, city, phone_whatsapp
    INTO v_settings
    FROM public.tenant_settings
    WHERE tenant_id = v_tenant.id;

    -- 4. Obter categorias públicas do tenant
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'tenantId', c.tenant_id,
        'name', c.name,
        'description', c.description,
        'imageUrl', c.image_url,
        'order', c.display_order,
        'isActive', c.is_active
    ) ORDER BY c.display_order ASC), '[]'::jsonb)
    INTO v_categories
    FROM public.categories c
    WHERE c.tenant_id = v_tenant.id AND c.is_active = true;

    -- 5. Obter produtos públicos ativos do tenant
    -- PROTEÇÃO DE PRIVACIDADE: Não expõe cost_price, sku ou stock_quantity detalhado.
    -- O cliente apenas recebe 'isAvailable' (disponível ou indisponível).
    -- PromotionalPrice validado: promotional_price > 0 AND promotional_price <= price.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'tenantId', p.tenant_id,
        'categoryId', p.category_id,
        'name', p.name,
        'description', p.description,
        'imageUrl', p.image_url,
        'price', p.price,
        'promotionalPrice', CASE 
            WHEN p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price <= p.price 
            THEN p.promotional_price 
            ELSE NULL 
        END,
        'unit', p.unit,
        'isAvailable', (p.stock_quantity > 0 AND p.is_active = true),
        'isActive', p.is_active,
        'isFeatured', p.is_featured
    ) ORDER BY p.name ASC), '[]'::jsonb)
    INTO v_products
    FROM public.products p
    WHERE p.tenant_id = v_tenant.id AND p.is_active = true;

    -- 6. Obter ofertas públicas ativas do tenant dentro da vigência
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id,
        'tenantId', o.tenant_id,
        'productId', o.product_id,
        'title', o.title,
        'subtitle', o.subtitle,
        'description', o.description,
        'badge', o.badge,
        'discountPercentage', o.discount_percentage,
        'originalPrice', o.original_price,
        'promotionalPrice', o.promotional_price,
        'imageUrl', o.image_url,
        'internalLink', o.internal_link,
        'order', o.display_order,
        'backgroundColor', o.background_color,
        'accentColor', o.accent_color,
        'isActive', o.is_active
    ) ORDER BY o.display_order ASC), '[]'::jsonb)
    INTO v_offers
    FROM public.offers o
    WHERE o.tenant_id = v_tenant.id 
      AND o.is_active = true
      AND (o.start_date IS NULL OR o.start_date <= CURRENT_DATE)
      AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE);

    -- Montagem do objeto seguro (SEM dados corporativos internos)
    RETURN jsonb_build_object(
        'tenant', jsonb_build_object(
            'id', v_tenant.id,
            'slug', v_tenant.slug,
            'name', v_tenant.name,
            'phone', v_tenant.phone,
            'category', v_tenant.category,
            'status', v_tenant.status
        ),
        'theme', to_jsonb(v_theme),
        'settings', to_jsonb(v_settings),
        'categories', v_categories,
        'products', v_products,
        'offers', v_offers
    );
END;
$$;

-- ==============================================================================
-- 13. REGISTRO SEGURO DE EVENTOS PÚBLICOS (APP EVENTS)
-- ==============================================================================

-- Função segura para registrar eventos públicos (add_to_cart, view_item, etc.)
-- O usuário informa apenas o slug; valida tamanho do payload e proíbe dados sensíveis.
CREATE OR REPLACE FUNCTION public.track_public_event(
    p_tenant_slug TEXT,
    p_event_name TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id UUID;
    v_allowed_events TEXT[] := ARRAY['page_view', 'view_item', 'add_to_cart', 'remove_from_cart', 'begin_checkout', 'purchase_completed'];
    v_meta_str TEXT;
BEGIN
    -- 1. Validação de tamanho e formato do slug
    IF p_tenant_slug IS NULL OR length(p_tenant_slug) < 2 OR length(p_tenant_slug) > 100 THEN
        RAISE EXCEPTION 'Slug inválido';
    END IF;

    -- 2. Validação estrita de whitelist de eventos
    IF p_event_name IS NULL OR NOT (p_event_name = ANY(v_allowed_events)) THEN
        RAISE EXCEPTION 'Evento "%" não permitido para rastreamento público', p_event_name;
    END IF;

    -- 3. Limitar o tamanho do metadata a no máximo 2KB para evitar flood/abuso
    v_meta_str := COALESCE(p_metadata::text, '{}');
    IF octet_length(v_meta_str) > 2048 THEN
        RAISE EXCEPTION 'Payload de metadata excede o limite máximo permitido (2KB)';
    END IF;

    -- 4. Proteção contra dados sensíveis no payload do evento público (ex: senhas, cartões, tokens)
    IF v_meta_str ~* '(password|token|secret|credit_card|cvv|cpf|cnpj|document)' THEN
        RAISE EXCEPTION 'Dados sensíveis não permitidos no payload de telemetria pública';
    END IF;

    -- 5. Resolver o tenant pelo slug (apenas ACTIVE)
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE slug = p_tenant_slug AND status = 'ACTIVE';

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant com slug "%" não encontrado ou inativo', p_tenant_slug;
    END IF;

    -- 6. Inserir evento seguro
    INSERT INTO public.app_events (tenant_id, event_name, metadata)
    VALUES (v_tenant_id, p_event_name, p_metadata);
END;
$$;

-- ==============================================================================
-- 14. CHECKOUT ATÔMICO E SEGURO (PROCESS_CHECKOUT_ATOMIC)
-- ==============================================================================

-- Função atômica que processa o checkout via SLUG (sem confiar em tenant_id do cliente)
-- Bloqueia produtos com FOR UPDATE, valida estoque, recalcula preços no DB com regras promocionais válidas,
-- valida pedido mínimo, atualiza cliente com first_order_date, last_order_date e ltv_amount.
CREATE OR REPLACE FUNCTION public.process_checkout_atomic(
    p_tenant_slug TEXT,
    p_customer_name VARCHAR,
    p_customer_phone VARCHAR,
    p_customer_email VARCHAR,
    p_delivery_address TEXT,
    p_address_details JSONB,
    p_payment_method VARCHAR,
    p_fulfillment_type VARCHAR,
    p_notes TEXT,
    p_origin VARCHAR,
    p_items JSONB -- Array de [{ "productId": UUID, "quantity": INT, "notes": TEXT }]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id UUID;
    v_tenant_status VARCHAR(32);
    v_min_order_value NUMERIC(10,2) := 0.00;
    v_delivery_fee NUMERIC(10,2) := 0.00;
    v_free_threshold NUMERIC(10,2);
    v_order_id UUID;
    v_item RECORD;
    v_prod RECORD;
    v_unit_price NUMERIC(10,2);
    v_subtotal NUMERIC(10,2) := 0.00;
    v_total_amount NUMERIC(10,2) := 0.00;
    v_customer_id UUID;
    v_prev_stock INT;
    v_new_stock INT;
    v_items_count INT;
BEGIN
    -- 1. Resolver e validar o tenant pelo slug (apenas ACTIVE pode vender)
    SELECT t.id, t.status, s.min_order_value, s.delivery_fee, s.free_delivery_threshold
    INTO v_tenant_id, v_tenant_status, v_min_order_value, v_delivery_fee, v_free_threshold
    FROM public.tenants t
    LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
    WHERE t.slug = p_tenant_slug;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Estabelecimento com slug "%" não encontrado.', p_tenant_slug;
    END IF;

    IF v_tenant_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'O estabelecimento "%" está temporariamente desativado ou suspenso para pedidos.', p_tenant_slug;
    END IF;

    -- 2. Validar itens enviados
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'A lista de itens do pedido não pode estar vazia.';
    END IF;

    v_items_count := jsonb_array_length(p_items);

    -- 3. Validar cada item com LOCK FOR UPDATE no produto para evitar overselling concorrente
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        "productId" UUID,
        "quantity" INT,
        "notes" TEXT
    ) LOOP
        IF v_item."productId" IS NULL THEN
            RAISE EXCEPTION 'ID do produto inválido no pedido.';
        END IF;

        IF v_item."quantity" IS NULL OR v_item."quantity" <= 0 THEN
            RAISE EXCEPTION 'A quantidade do item deve ser um número inteiro maior que zero.';
        END IF;

        -- Bloqueia a linha do produto no banco até o término desta transação
        SELECT * INTO v_prod FROM public.products
        WHERE id = v_item."productId" AND tenant_id = v_tenant_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto % não encontrado no estabelecimento "%".', v_item."productId", p_tenant_slug;
        END IF;

        IF NOT v_prod.is_active THEN
            RAISE EXCEPTION 'O produto "%" está desativado no momento.', v_prod.name;
        END IF;

        IF v_prod.stock_quantity < v_item."quantity" THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto "%". Disponível: %, Solicitado: %', 
                v_prod.name, v_prod.stock_quantity, v_item."quantity";
        END IF;

        -- Calcula o preço OFICIAL gravado no banco de dados com validação promocional estrita
        IF v_prod.promotional_price IS NOT NULL AND v_prod.promotional_price > 0 AND v_prod.promotional_price <= v_prod.price THEN
            v_unit_price := v_prod.promotional_price;
        ELSE
            v_unit_price := v_prod.price;
        END IF;

        v_subtotal := v_subtotal + (v_unit_price * v_item."quantity");
    END LOOP;

    -- 4. Validar Pedido Mínimo obrigatório
    IF v_min_order_value > 0 AND v_subtotal < v_min_order_value THEN
        RAISE EXCEPTION 'Valor mínimo do pedido não atingido. O valor mínimo é de R$ % e o subtotal atual é R$ %.',
            v_min_order_value, v_subtotal;
    END IF;

    -- 5. Calcular taxa de entrega oficial a partir das configurações do tenant no banco
    IF p_fulfillment_type = 'DELIVERY' THEN
        IF v_free_threshold IS NOT NULL AND v_subtotal >= v_free_threshold THEN
            v_delivery_fee := 0.00;
        END IF;
    ELSE
        v_delivery_fee := 0.00;
    END IF;

    v_total_amount := v_subtotal + v_delivery_fee;

    -- 6. Upsert do Cliente com first_order_date, last_order_date e incremento real de ltv_amount
    SELECT id INTO v_customer_id FROM public.customers 
    WHERE tenant_id = v_tenant_id AND phone = p_customer_phone;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (
            tenant_id, 
            name, 
            phone, 
            email, 
            origin, 
            total_orders, 
            ltv_amount, 
            first_order_date, 
            last_order_date
        ) VALUES (
            v_tenant_id, 
            p_customer_name, 
            p_customer_phone, 
            p_customer_email, 
            COALESCE(p_origin, 'direct'), 
            1, 
            v_total_amount, 
            CURRENT_DATE, 
            CURRENT_DATE
        ) RETURNING id INTO v_customer_id;
    ELSE
        UPDATE public.customers
        SET total_orders = total_orders + 1,
            ltv_amount = ltv_amount + v_total_amount,
            last_order_date = CURRENT_DATE,
            name = COALESCE(p_customer_name, name),
            email = COALESCE(p_customer_email, email)
        WHERE id = v_customer_id;
    END IF;

    -- 7. Criar o Pedido
    INSERT INTO public.orders (
        tenant_id,
        customer_id,
        customer_name,
        customer_phone,
        customer_email,
        delivery_address,
        address_details,
        subtotal,
        delivery_fee,
        discount,
        total_amount,
        payment_method,
        payment_status,
        fulfillment_type,
        status,
        notes,
        origin
    ) VALUES (
        v_tenant_id,
        v_customer_id,
        p_customer_name,
        p_customer_phone,
        p_customer_email,
        p_delivery_address,
        p_address_details,
        v_subtotal,
        v_delivery_fee,
        0.00,
        v_total_amount,
        p_payment_method,
        CASE WHEN p_payment_method = 'PIX' THEN 'PENDING' ELSE 'PAYMENT_ON_DELIVERY' END,
        p_fulfillment_type,
        'PENDING',
        p_notes,
        COALESCE(p_origin, 'direct')
    ) RETURNING id INTO v_order_id;

    -- 8. Gravar Itens e Decrementar Estoque de Forma Atômica no Kardex
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        "productId" UUID,
        "quantity" INT,
        "notes" TEXT
    ) LOOP
        SELECT * INTO v_prod FROM public.products WHERE id = v_item."productId";

        IF v_prod.promotional_price IS NOT NULL AND v_prod.promotional_price > 0 AND v_prod.promotional_price <= v_prod.price THEN
            v_unit_price := v_prod.promotional_price;
        ELSE
            v_unit_price := v_prod.price;
        END IF;

        v_prev_stock := v_prod.stock_quantity;
        v_new_stock := v_prev_stock - v_item."quantity";

        -- Gravar item oficial
        INSERT INTO public.order_items (
            order_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            total_price,
            notes,
            unit
        ) VALUES (
            v_order_id,
            v_prod.id,
            v_prod.name,
            v_item."quantity",
            v_unit_price,
            (v_unit_price * v_item."quantity"),
            v_item."notes",
            v_prod.unit
        );

        -- Decrementa o saldo de estoque com garantia não-negativa
        UPDATE public.products
        SET stock_quantity = v_new_stock,
            updated_at = NOW()
        WHERE id = v_prod.id;

        -- Registra movimentação oficial no Kardex
        INSERT INTO public.inventory_movements (
            tenant_id,
            product_id,
            product_name,
            quantity,
            type,
            reference_id,
            reason,
            previous_stock,
            new_stock,
            created_by_name
        ) VALUES (
            v_tenant_id,
            v_prod.id,
            v_prod.name,
            -v_item."quantity",
            'VENDA',
            v_order_id::text,
            'Baixa atômica por venda - Pedido #' || v_order_id::text,
            v_prev_stock,
            v_new_stock,
            'Sistema (process_checkout_atomic)'
        );
    END LOOP;

    -- 9. Histórico inicial de status com identidade consistente
    INSERT INTO public.order_status_history (order_id, status, note, changed_by)
    VALUES (v_order_id, 'PENDING', 'Pedido confirmado com sucesso pelo checkout online', 'Checkout Público');

    RETURN v_order_id;
END;
$$;

-- ==============================================================================
-- 15. HABILITAÇÃO COMPLETA DE RLS EM TODAS AS 17 TABELAS
-- ==============================================================================

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- 16. POLÍTICAS ROW LEVEL SECURITY (RLS) RIGOROSAS (RBAC GRANULAR)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 16.1 TENANTS
-- ------------------------------------------------------------------------------
CREATE POLICY "tenants_ceo_all" ON public.tenants
    FOR ALL USING (public.is_ceo(auth.uid()));

CREATE POLICY "tenants_owner_update" ON public.tenants
    FOR UPDATE USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), id, ARRAY['OWNER'])
    );

CREATE POLICY "tenants_staff_select" ON public.tenants
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER', 'DRIVER'])
    );

-- ------------------------------------------------------------------------------
-- 16.2 TENANT SETTINGS
-- ------------------------------------------------------------------------------
CREATE POLICY "tenant_settings_staff_select" ON public.tenant_settings
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER'])
    );

CREATE POLICY "tenant_settings_admin_manage" ON public.tenant_settings
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

-- ------------------------------------------------------------------------------
-- 16.3 TENANT THEMES
-- ------------------------------------------------------------------------------
CREATE POLICY "tenant_themes_staff_select" ON public.tenant_themes
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

CREATE POLICY "tenant_themes_admin_manage" ON public.tenant_themes
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER'])
    );

-- ------------------------------------------------------------------------------
-- 16.4 USERS (PERFIS)
-- ------------------------------------------------------------------------------
CREATE POLICY "users_select_self_or_ceo" ON public.users
    FOR SELECT USING (
        id = auth.uid() OR 
        public.is_ceo(auth.uid())
    );

CREATE POLICY "users_update_self" ON public.users
    FOR UPDATE USING (id = auth.uid());

-- ------------------------------------------------------------------------------
-- 16.5 ROLES (CATÁLOGO DE PAPÉIS DO SISTEMA)
-- ------------------------------------------------------------------------------
CREATE POLICY "roles_read_authenticated" ON public.roles
    FOR SELECT USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- 16.6 TENANT USERS (RBAC)
-- ------------------------------------------------------------------------------
CREATE POLICY "tenant_users_select_scope" ON public.tenant_users
    FOR SELECT USING (
        user_id = auth.uid() OR
        public.is_ceo(auth.uid()) OR
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

CREATE POLICY "tenant_users_admin_manage" ON public.tenant_users
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER'])
    );

-- ------------------------------------------------------------------------------
-- 16.7 CATEGORIES (GERENCIAMENTO EXCLUSIVO POR OWNER/MANAGER)
-- DRIVER e CUSTOMER não têm acesso de alteração.
-- ------------------------------------------------------------------------------
CREATE POLICY "categories_staff_select" ON public.categories
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER', 'DRIVER'])
    );

CREATE POLICY "categories_admin_manage" ON public.categories
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

-- ------------------------------------------------------------------------------
-- 16.8 PRODUCTS (GERENCIAMENTO EXCLUSIVO POR OWNER/MANAGER - PROTEÇÃO DE CUSTO E ESTOQUE)
-- DRIVER e CUSTOMER não podem alterar produtos nem consultar custos.
-- ------------------------------------------------------------------------------
CREATE POLICY "products_staff_select" ON public.products
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER', 'DRIVER'])
    );

CREATE POLICY "products_admin_manage" ON public.products
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

-- ------------------------------------------------------------------------------
-- 16.9 OFFERS (GERENCIAMENTO EXCLUSIVO POR OWNER/MANAGER)
-- ------------------------------------------------------------------------------
CREATE POLICY "offers_staff_select" ON public.offers
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER'])
    );

CREATE POLICY "offers_admin_manage" ON public.offers
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

-- ------------------------------------------------------------------------------
-- 16.10 ORDERS (ISOLAMENTO ESTRITO: DRIVER SOMENTE ACESSA ATRIBUÍDO A ELE)
-- ------------------------------------------------------------------------------
-- Consulta por staff operacional (sem DRIVER global)
CREATE POLICY "orders_staff_select" ON public.orders
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER'])
    );

-- Consulta por DRIVER: SOMENTE pedidos explicitamente atribuídos a auth.uid()
CREATE POLICY "orders_driver_select_assigned" ON public.orders
    FOR SELECT USING (
        driver_id = auth.uid() AND
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['DRIVER'])
    );

-- Atualização por staff administrativo/operacional da loja
CREATE POLICY "orders_staff_update" ON public.orders
    FOR UPDATE USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER'])
    );

-- Exclusão de pedidos: Restrita a OWNER e CEO
CREATE POLICY "orders_admin_delete" ON public.orders
    FOR DELETE USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER'])
    );

-- ------------------------------------------------------------------------------
-- 16.11 ORDER ITEMS (ISOLAMENTO RELACIONAL ATRAVÉS DO PEDIDO)
-- ------------------------------------------------------------------------------
CREATE POLICY "order_items_staff_select" ON public.order_items
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = public.order_items.order_id 
              AND (
                public.has_tenant_role(auth.uid(), o.tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER'])
                OR (o.driver_id = auth.uid() AND public.has_tenant_role(auth.uid(), o.tenant_id, ARRAY['DRIVER']))
              )
        )
    );

CREATE POLICY "order_items_staff_manage" ON public.order_items
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = public.order_items.order_id 
              AND public.has_tenant_role(auth.uid(), o.tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR'])
        )
    );

-- ------------------------------------------------------------------------------
-- 16.12 ORDER STATUS HISTORY (APPEND-ONLY - LEITURA SEGURA)
-- Inserções arbitrárias via frontend bloqueadas: geradas exclusivamente via RPC
-- ------------------------------------------------------------------------------
CREATE POLICY "order_status_history_staff_select" ON public.order_status_history
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = public.order_status_history.order_id 
              AND (
                public.has_tenant_role(auth.uid(), o.tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER'])
                OR (o.driver_id = auth.uid() AND public.has_tenant_role(auth.uid(), o.tenant_id, ARRAY['DRIVER']))
              )
        )
    );

-- ------------------------------------------------------------------------------
-- 16.13 CUSTOMERS (DADOS PESSOAIS / LGPD - RESTRITO A OWNER/MANAGER E CAIXA)
-- DRIVER e CUSTOMER não têm acesso à lista de clientes.
-- ------------------------------------------------------------------------------
CREATE POLICY "customers_staff_select" ON public.customers
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'CASHIER'])
    );

CREATE POLICY "customers_staff_manage" ON public.customers
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

-- ------------------------------------------------------------------------------
-- 16.14 CUSTOMER CONSENTS (LGPD)
-- ------------------------------------------------------------------------------
CREATE POLICY "customer_consents_staff_select" ON public.customer_consents
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        EXISTS (
            SELECT 1 FROM public.customers c
            WHERE c.id = public.customer_consents.customer_id 
              AND public.has_tenant_role(auth.uid(), c.tenant_id, ARRAY['OWNER', 'MANAGER'])
        )
    );

CREATE POLICY "customer_consents_staff_manage" ON public.customer_consents
    FOR ALL USING (
        public.is_ceo(auth.uid()) OR 
        EXISTS (
            SELECT 1 FROM public.customers c
            WHERE c.id = public.customer_consents.customer_id 
              AND public.has_tenant_role(auth.uid(), c.tenant_id, ARRAY['OWNER'])
        )
    );

-- ------------------------------------------------------------------------------
-- 16.15 INVENTORY MOVEMENTS (KARDEX - APPEND-ONLY VIA adjust_inventory)
-- Sem INSERT/UPDATE/DELETE arbitrário por usuários comuns.
-- ------------------------------------------------------------------------------
CREATE POLICY "inventory_movements_staff_select" ON public.inventory_movements
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR'])
    );

-- ------------------------------------------------------------------------------
-- 16.16 AUDIT LOGS (APPEND-ONLY FORENSE, CONSULTA APENAS ADMIN)
-- Escrita via procedures e integridade de sistema.
-- ------------------------------------------------------------------------------
CREATE POLICY "audit_logs_staff_select" ON public.audit_logs
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

-- ------------------------------------------------------------------------------
-- 16.17 APP EVENTS (CONSULTA APENAS ADMINISTRATIVA - INSERÇÃO VIA track_public_event)
-- ------------------------------------------------------------------------------
CREATE POLICY "app_events_staff_select" ON public.app_events
    FOR SELECT USING (
        public.is_ceo(auth.uid()) OR 
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

-- ==============================================================================
-- 17. PERMISSÕES DE EXECUÇÃO RESTRITAS (REVOKE/GRANT)
-- ==============================================================================

-- Revogar execução pública indiscriminada por padrão de todas as funções
REVOKE ALL ON FUNCTION public.is_ceo(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_tenant_role(UUID, UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_tenant_permission(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_tenant_admin(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_auth_tenant(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_audit_event(VARCHAR, VARCHAR, TEXT, VARCHAR, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_driver_order_status(UUID, VARCHAR, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_inventory(UUID, INT, VARCHAR, TEXT, VARCHAR) FROM PUBLIC, anon, authenticated;

-- Conceder permissão às funções de verificação administrativa a usuários autenticados
GRANT EXECUTE ON FUNCTION public.is_ceo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(UUID, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_permission(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_tenant(UUID) TO authenticated;

-- Conceder execução de operações específicas a usuários autenticados (validadas por auth.uid() e papéis)
GRANT EXECUTE ON FUNCTION public.update_driver_order_status(UUID, VARCHAR, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(UUID, INT, VARCHAR, TEXT, VARCHAR) TO authenticated;

-- NOTA CRÍTICA DE AUDITORIA:
-- log_audit_event NÃO tem permissão concedida para 'authenticated' nem para 'anon'.
-- Ela é restrita para uso interno por procedures do banco (SECURITY DEFINER)
-- ou triggers administrativos, impedindo categoricamente que o cliente fabrique logs falsos.

-- Funções públicas essenciais concedidas para anon e authenticated
GRANT EXECUTE ON FUNCTION public.get_public_store(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_checkout_atomic(TEXT, VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, VARCHAR, VARCHAR, TEXT, VARCHAR, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_public_event(TEXT, TEXT, JSONB) TO anon, authenticated;
