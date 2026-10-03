-- ==============================================================================
-- ADEGAFOOD - MIGRATION 005: INFRAESTRUTURA DE EQUIPE, CONVITES E MOTORISTAS
-- ==============================================================================
-- Descrição:
--   1. Criação da tabela de convites de colaboradores com token seguro e expiração (public.team_invites)
--   2. Criação da tabela operacional de entregadores e frotas (public.drivers)
--   3. Restrição de ciclo de vida: Motorista nasce EXCLUSIVAMENTE por convite aceito (accept_team_invite)
--   4. RLS restritivo com isolamento multi-tenant estrito:
--      - public.team_invites: Nenhum INSERT/UPDATE/DELETE direto por frontend (apenas SELECT admin do tenant e destinatário autenticado)
--      - public.drivers: Nenhum INSERT/UPDATE administrativo direto amplo
--      - public.drivers: Motorista só pode alterar seu status próprio entre AVAILABLE e UNAVAILABLE
--      - public.tenant_users: Revogação de política permissiva legada; mutações exclusivas via RPCs seguras
--   5. Regras de papéis: Bloqueio expresso de convites para OWNER, CEO e SUPER_ADMIN
--   6. Compatibilidade de banco e máquina de estados:
--      - OBJETOS EXISTENTES NO SUPABASE NÃO RECRIADOS (Preservação estrita):
--        * public.orders.driver_id (UUID, references users.id ON DELETE SET NULL) já existe; NÃO é recriado.
--        * Constraint orders_driver_id_fkey já existe; NÃO é recriada.
--        * Índice idx_orders_driver já existe; NÃO é recriado.
--        * Constraint orders_status_check já aceita WAITING_FOR_DRIVER; NÃO é alterada.
--        * Assinatura da função update_driver_order_status(uuid, character varying, text) preservada in-place via CREATE OR REPLACE.
--      - Novo fluxo operacional de entrega: READY -> OUT_FOR_DELIVERY -> DELIVERED
--      - Compatibilidade retroativa de status: WAITING_FOR_DRIVER é aceito e migrado para READY ou OUT_FOR_DELIVERY nas operações.
--      - Cancelamento: PENDING / CONFIRMED / PREPARING / READY -> CANCELLED
--   7. Padronização estrita de ordem de locks anti-deadlock:
--      - 1º PEDIDO(S) (public.orders FOR UPDATE) -> 2º MOTORISTA (public.drivers FOR UPDATE)
--   8. RPCs SECURITY DEFINER auditadas e protegidas:
--      - public.create_team_invite: Emissão formal de convite vinculada a auth.uid() e validação de tenant
--      - public.revoke_team_invite: Revogação de convite pendente por administradores do tenant
--      - public.accept_team_invite: Aceite, criação de membership em tenant_users e provisionamento automático em public.drivers
--      - public.remove_team_member: Inativação segura com travas anti-auto-remoção, locks ordenados e desatribuição para READY
--      - public.update_driver_profile: Atualização controlada de dados do veículo (imutabilidade de user_id/tenant_id; bloqueio de SUSPENDED e ON_DELIVERY)
--      - public.assign_order_to_driver: Atribuição atômica com locks ordenados, exigindo vínculo ativo e status AVAILABLE
--      - public.unassign_order_driver: Desatribuição com travas ordenadas e retorno do pedido para READY
--      - public.update_driver_order_status: Conclusão de entrega pelo motorista (OUT_FOR_DELIVERY -> DELIVERED) com validação de vínculo ativo e locks ordenados
--      - public.suspend_driver: Suspensão administrativa com travas ordenadas, desatribuição para READY e registro em histórico
--   9. Trilha de auditoria forense no PostgreSQL para todas as operações
--
-- ATENÇÃO CRÍTICA DE EXECUÇÃO:
--   ESTA MIGRATION NÃO DEVE SER EXECUTADA AUTOMATICAMENTE.
--   CRIADA EXCLUSIVAMENTE NO REPOSITÓRIO LOCAL PARA AUDITORIA E APROVAÇÃO.
-- ==============================================================================

-- ==============================================================================
-- 1. TABELA DE CONVITES DE EQUIPE (TEAM_INVITES)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.team_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role_id VARCHAR(32) NOT NULL,
    invited_by UUID NOT NULL REFERENCES public.users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES public.users(id),
    CONSTRAINT chk_team_invites_status CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT chk_team_invites_role CHECK (role_id IN ('MANAGER', 'CASHIER', 'OPERATOR', 'DELIVERY_MANAGER', 'DRIVER', 'WAITER'))
);

-- Índices operacionais e de integridade
CREATE INDEX IF NOT EXISTS idx_team_invites_tenant ON public.team_invites(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_team_invites_email ON public.team_invites(LOWER(email), status);

-- Impede múltiplos convites PENDING para o mesmo e-mail, tenant e papel
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_invites_pending 
    ON public.team_invites (tenant_id, LOWER(email), role_id) 
    WHERE status = 'PENDING';

COMMENT ON TABLE public.team_invites IS 'Convites formais de ingresso à equipe do estabelecimento com controle de validade e papel RBAC.';
COMMENT ON COLUMN public.team_invites.email IS 'E-mail do colaborador convidado (armazenado em minúsculas).';
COMMENT ON COLUMN public.team_invites.role_id IS 'Papel atribuído no estabelecimento. Bloqueado para OWNER, CEO e SUPER_ADMIN.';

-- ==============================================================================
-- 2. TABELA OPERACIONAL DE MOTORISTAS / ENTREGADORES (DRIVERS)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL DEFAULT '',
    document VARCHAR(32),
    vehicle_type VARCHAR(32) DEFAULT 'MOTO',
    vehicle_model VARCHAR(128),
    vehicle_plate VARCHAR(16),
    status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_drivers_user_tenant UNIQUE (user_id, tenant_id),
    CONSTRAINT chk_drivers_status CHECK (status IN ('AVAILABLE', 'UNAVAILABLE', 'ON_DELIVERY', 'SUSPENDED')),
    CONSTRAINT chk_drivers_vehicle_type CHECK (vehicle_type IS NULL OR vehicle_type IN ('MOTO', 'CARRO', 'BIKE', 'VAN', 'OUTRO'))
);

-- Índices operacionais
CREATE INDEX IF NOT EXISTS idx_drivers_tenant_status ON public.drivers(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_drivers_user ON public.drivers(user_id);

COMMENT ON TABLE public.drivers IS 'Cadastro e controle de frotas e entregadores do estabelecimento com rastreio de disponibilidade.';
COMMENT ON COLUMN public.drivers.user_id IS 'Referência imutável ao usuário autenticado no sistema (auth.uid).';
COMMENT ON COLUMN public.drivers.tenant_id IS 'Referência imutável ao tenant do estabelecimento.';
COMMENT ON COLUMN public.drivers.status IS 'Status operacional: AVAILABLE (disponível), UNAVAILABLE (offline), ON_DELIVERY (em rota), SUSPENDED (bloqueado via suspend_driver).';

-- ==============================================================================
-- 3. REVISÃO E ENDURECIMENTO DE RLS (ROW-LEVEL SECURITY)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 3.1 Endurecimento e Reconciliação de public.tenant_users
-- Remove a policy de escrita direta legada (tenant_users_admin_manage).
-- Preserva integralmente a policy de leitura canônica existente: tenant_users_select_scope.
-- NENHUMA policy de INSERT, UPDATE ou DELETE é criada para tenant_users.
-- Toda mutação ocorre estritamente via RPCs SECURITY DEFINER (accept_team_invite, remove_team_member).
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_users_admin_manage ON public.tenant_users;
DROP POLICY IF EXISTS p_tenant_users_admin_manage ON public.tenant_users;
DROP POLICY IF EXISTS p_tenant_users_select ON public.tenant_users;

-- Garantir RLS ativo
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

-- NOTA ARQUITETURAL:
-- A policy "tenant_users_select_scope" (já criada na Migration 001) é PRESERVADA como a
-- única política ativa para SELECT em public.tenant_users:
--   USING (user_id = auth.uid() OR public.is_ceo(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER']))
--
-- Nenhuma policy de escrita direta (INSERT, UPDATE, DELETE) é permitida.
-- Com o RLS habilitado e sem policies de escrita, o PostgreSQL rejeita sumariamente qualquer
-- tentativa de INSERT, UPDATE ou DELETE via cliente Supabase (PostgREST), mesmo para OWNER.

-- ------------------------------------------------------------------------------
-- 3.2 Políticas para public.team_invites
-- ------------------------------------------------------------------------------
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

-- Administradores do tenant (OWNER / MANAGER) podem visualizar convites do próprio estabelecimento
CREATE POLICY p_team_invites_admin_select ON public.team_invites
    FOR SELECT TO authenticated
    USING (
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
    );

-- Usuário autenticado pode consultar convites pendentes direcionados ao seu e-mail
CREATE POLICY p_team_invites_recipient_select ON public.team_invites
    FOR SELECT TO authenticated
    USING (
        status = 'PENDING' AND 
        (
            LOWER(email) = LOWER(auth.jwt()->>'email') 
            OR 
            EXISTS (
                SELECT 1 FROM public.users u 
                WHERE u.id = auth.uid() AND LOWER(u.email) = LOWER(team_invites.email)
            )
        )
    );

-- PROIBIDO INSERT DIRETO: remoção de p_team_invites_admin_insert.
-- Toda emissão de convite deve ser feita exclusivamente via create_team_invite().
DROP POLICY IF EXISTS p_team_invites_admin_insert ON public.team_invites;

-- PROIBIDO UPDATE DIRETO: não é permitido UPDATE direto no frontend.
-- A revogação passa exclusivamente por revoke_team_invite() e aceite por accept_team_invite().
DROP POLICY IF EXISTS p_team_invites_admin_update ON public.team_invites;

-- ------------------------------------------------------------------------------
-- 3.3 Políticas para public.drivers
-- ------------------------------------------------------------------------------
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- Administradores (OWNER, MANAGER, DELIVERY_MANAGER) podem consultar motoristas do seu tenant
CREATE POLICY p_drivers_admin_select ON public.drivers
    FOR SELECT TO authenticated
    USING (
        public.has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'DELIVERY_MANAGER'])
    );

-- O motorista pode consultar exclusivamente o seu próprio cadastro
CREATE POLICY p_drivers_self_select ON public.drivers
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
    );

-- PROIBIDO INSERT e UPDATE administrativos diretos:
-- Motoristas NÃO podem ser criados por INSERT arbitrário do admin.
-- Toda criação ocorre via accept_team_invite() (SECURITY DEFINER).
-- Toda atualização administrativa ocorre via update_driver_profile() (SECURITY DEFINER).
DROP POLICY IF EXISTS p_drivers_admin_insert ON public.drivers;
DROP POLICY IF EXISTS p_drivers_admin_update ON public.drivers;

-- O motorista pode atualizar SOMENTE veículo e status próprio entre AVAILABLE e UNAVAILABLE
-- ON_DELIVERY e SUSPENDED são expressamente proibidos via frontend direto
CREATE POLICY p_drivers_self_update ON public.drivers
    FOR UPDATE TO authenticated
    USING (
        user_id = auth.uid()
    )
    WITH CHECK (
        user_id = auth.uid() AND
        status IN ('AVAILABLE', 'UNAVAILABLE')
    );

-- ==============================================================================
-- 4. PROCEDIMENTOS DE NEGÓCIO E SEGURANÇA (SECURITY DEFINER)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 4.1 CRIAR CONVITE DE EQUIPE (CREATE_TEAM_INVITE)
-- Bloqueia expressamente convites para OWNER, CEO e SUPER_ADMIN
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_team_invite(
    p_tenant_id UUID,
    p_email VARCHAR,
    p_role_id VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_clean_email VARCHAR(255) := LOWER(TRIM(p_email));
    v_clean_role VARCHAR(32) := UPPER(TRIM(p_role_id));
    v_invite_id UUID;
    v_expires_at TIMESTAMPTZ := NOW() + INTERVAL '7 days';
    v_existing_membership_id UUID;
    v_existing_invite_id UUID;
BEGIN
    -- 1. Validar autenticação
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Validar se o solicitante possui papel OWNER ou MANAGER no tenant
    IF NOT public.has_tenant_role(v_operator_id, p_tenant_id, ARRAY['OWNER', 'MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: somente proprietários e gerentes podem convidar colaboradores.';
    END IF;

    -- 3. Validar se o papel solicitado é permitido para convite de equipe
    -- OWNER, CEO e SUPER_ADMIN não podem ser concedidos por convite de equipe
    IF v_clean_role IN ('OWNER', 'CEO', 'SUPER_ADMIN') THEN
        RAISE EXCEPTION 'Este cargo não pode ser concedido por convite de equipe.';
    END IF;

    IF v_clean_role NOT IN ('MANAGER', 'CASHIER', 'OPERATOR', 'DELIVERY_MANAGER', 'DRIVER', 'WAITER') THEN
        RAISE EXCEPTION 'Papel "%" inválido para convite de equipe.', v_clean_role;
    END IF;

    -- 4. Validar formato de e-mail básico
    IF v_clean_email NOT LIKE '%@%.%' THEN
        RAISE EXCEPTION 'Endereço de e-mail inválido.';
    END IF;

    -- 5. Verificar se o e-mail já pertence a um membro ativo do tenant
    SELECT tu.id INTO v_existing_membership_id
    FROM public.tenant_users tu
    JOIN public.users u ON u.id = tu.user_id
    WHERE tu.tenant_id = p_tenant_id 
      AND LOWER(u.email) = v_clean_email 
      AND tu.status = 'ACTIVE'
    LIMIT 1;

    IF v_existing_membership_id IS NOT NULL THEN
        RAISE EXCEPTION 'O usuário com o e-mail "%" já faz parte da equipe deste estabelecimento.', v_clean_email;
    END IF;

    -- 6. Verificar se já existe convite pendente válido para este e-mail e papel
    SELECT id INTO v_existing_invite_id
    FROM public.team_invites
    WHERE tenant_id = p_tenant_id 
      AND LOWER(email) = v_clean_email 
      AND role_id = v_clean_role 
      AND status = 'PENDING'
      AND expires_at > NOW()
    LIMIT 1;

    IF v_existing_invite_id IS NOT NULL THEN
        RAISE EXCEPTION 'Já existe um convite pendente ativo para este e-mail.';
    END IF;

    -- 7. Inserir o novo convite
    INSERT INTO public.team_invites (
        tenant_id,
        email,
        role_id,
        invited_by,
        status,
        expires_at,
        created_at
    ) VALUES (
        p_tenant_id,
        v_clean_email,
        v_clean_role,
        v_operator_id,
        'PENDING',
        v_expires_at,
        NOW()
    ) RETURNING id INTO v_invite_id;

    -- 8. Auditoria forense
    PERFORM public.log_audit_event(
        'TEAM_INVITE_CREATED',
        'team_invites',
        'Convite de equipe emitido para ' || v_clean_email || ' com papel ' || v_clean_role,
        v_invite_id::text,
        NULL,
        jsonb_build_object('email', v_clean_email, 'role', v_clean_role, 'expiresAt', v_expires_at)::text,
        p_tenant_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'inviteId', v_invite_id,
        'email', v_clean_email,
        'roleId', v_clean_role,
        'expiresAt', v_expires_at
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4.2 REVOGAR CONVITE DE EQUIPE (REVOKE_TEAM_INVITE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_team_invite(
    p_invite_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_invite RECORD;
BEGIN
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    SELECT id, tenant_id, email, role_id, status 
    INTO v_invite
    FROM public.team_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Convite não encontrado.';
    END IF;

    IF NOT public.has_tenant_role(v_operator_id, v_invite.tenant_id, ARRAY['OWNER', 'MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: você não é administrador deste estabelecimento.';
    END IF;

    UPDATE public.team_invites
    SET status = 'REVOKED'
    WHERE id = p_invite_id;

    PERFORM public.log_audit_event(
        'TEAM_INVITE_REVOKED',
        'team_invites',
        'Convite revogado para o e-mail ' || v_invite.email,
        p_invite_id::text,
        v_invite.status,
        'REVOKED',
        v_invite.tenant_id
    );

    RETURN jsonb_build_object('success', true, 'inviteId', p_invite_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 4.3 ACEITAR CONVITE DE EQUIPE (ACCEPT_TEAM_INVITE)
-- ÚNICO PONTO DE PROVISIONAMENTO INICIAL DE MOTORISTAS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_team_invite(
    p_invite_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_email VARCHAR(255);
    v_user_name VARCHAR(255);
    v_user_phone VARCHAR(32);
    v_invite RECORD;
BEGIN
    -- 1. Validar autenticação do usuário que está aceitando
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Localizar usuário no banco público
    SELECT email, name, phone INTO v_user_email, v_user_name, v_user_phone
    FROM public.users
    WHERE id = v_user_id;

    IF v_user_email IS NULL THEN
        v_user_email := auth.jwt()->>'email';
        v_user_name := COALESCE(auth.jwt()->>'name', 'Colaborador');
    END IF;

    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'Perfil do usuário não possui e-mail cadastrado.';
    END IF;

    -- 3. Localizar convite com trava de linha
    SELECT id, tenant_id, email, role_id, status, expires_at
    INTO v_invite
    FROM public.team_invites
    WHERE id = p_invite_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Convite não encontrado.';
    END IF;

    -- 4. Validar status e expiração
    IF v_invite.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Este convite não está mais pendente (Status: %).', v_invite.status;
    END IF;

    IF v_invite.expires_at <= NOW() THEN
        UPDATE public.team_invites SET status = 'EXPIRED' WHERE id = p_invite_id;
        RAISE EXCEPTION 'Este convite expirou em %.', v_invite.expires_at;
    END IF;

    -- 5. Validar que o e-mail autenticado corresponde ao destinatário do convite
    IF LOWER(v_user_email) <> LOWER(v_invite.email) THEN
        RAISE EXCEPTION 'Este convite foi emitido para "%", mas sua conta autenticada é "%".', v_invite.email, v_user_email;
    END IF;

    -- 6. Inserir ou reativar vínculo em public.tenant_users
    INSERT INTO public.tenant_users (
        tenant_id,
        user_id,
        role_id,
        status,
        created_at,
        updated_at
    ) VALUES (
        v_invite.tenant_id,
        v_user_id,
        v_invite.role_id,
        'ACTIVE',
        NOW(),
        NOW()
    )
    ON CONFLICT (tenant_id, user_id) 
    DO UPDATE SET 
        role_id = EXCLUDED.role_id,
        status = 'ACTIVE',
        updated_at = NOW();

    -- 7. Se o papel for DRIVER, criar ou ativar automaticamente o cadastro em public.drivers
    IF v_invite.role_id = 'DRIVER' THEN
        INSERT INTO public.drivers (
            user_id,
            tenant_id,
            full_name,
            phone,
            status,
            created_at,
            updated_at
        ) VALUES (
            v_user_id,
            v_invite.tenant_id,
            COALESCE(v_user_name, 'Entregador'),
            COALESCE(v_user_phone, ''),
            'AVAILABLE',
            NOW(),
            NOW()
        )
        ON CONFLICT (user_id, tenant_id)
        DO UPDATE SET 
            status = 'AVAILABLE',
            updated_at = NOW();

        PERFORM public.log_audit_event(
            'DRIVER_CREATED',
            'drivers',
            'Cadastro de motorista provisionado via aceite de convite para ' || v_user_email,
            v_user_id::text,
            NULL,
            'AVAILABLE',
            v_invite.tenant_id
        );
    END IF;

    -- 8. Atualizar status do convite para ACCEPTED
    UPDATE public.team_invites
    SET status = 'ACCEPTED',
        accepted_at = NOW(),
        accepted_by = v_user_id
    WHERE id = p_invite_id;

    -- 9. Auditoria forense
    PERFORM public.log_audit_event(
        'TEAM_INVITE_ACCEPTED',
        'team_invites',
        'Usuário ' || v_user_id::text || ' (' || v_user_email || ') ingressou no tenant com papel ' || v_invite.role_id,
        p_invite_id::text,
        'PENDING',
        'ACCEPTED',
        v_invite.tenant_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'tenantId', v_invite.tenant_id,
        'roleId', v_invite.role_id
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4.4 REMOVER MEMBRO DA EQUIPE (REMOVE_TEAM_MEMBER)
-- Inativação segura em tenant_users com locks ordenados (PEDIDO -> MOTORISTA)
-- Compatível exclusivamente com status reais (OUT_FOR_DELIVERY -> READY)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_team_member(
    p_tenant_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_target_membership RECORD;
    v_operator_role VARCHAR(32);
BEGIN
    -- 1. Validar autenticação
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Localizar vínculo alvo com trava
    SELECT id, tenant_id, user_id, role_id, status 
    INTO v_target_membership
    FROM public.tenant_users
    WHERE id = p_tenant_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vínculo de equipe não encontrado.';
    END IF;

    -- 3. Obter papel do operador no mesmo tenant
    SELECT role_id INTO v_operator_role
    FROM public.tenant_users
    WHERE tenant_id = v_target_membership.tenant_id 
      AND user_id = v_operator_id 
      AND status = 'ACTIVE'
    LIMIT 1;

    IF v_operator_role IS NULL OR v_operator_role NOT IN ('OWNER', 'MANAGER') THEN
        RAISE EXCEPTION 'Permissão negada: somente proprietários e gerentes podem remover membros da equipe.';
    END IF;

    -- 4. Impedir auto-remoção
    IF v_target_membership.user_id = v_operator_id THEN
        RAISE EXCEPTION 'Não é permitido remover a si próprio da equipe por esta operação.';
    END IF;

    -- 5. Gerente não pode remover OWNER
    IF v_target_membership.role_id = 'OWNER' AND v_operator_role <> 'OWNER' THEN
        RAISE EXCEPTION 'Permissão negada: gerentes não podem remover o proprietário do estabelecimento.';
    END IF;

    -- 6. Inativar vínculo
    UPDATE public.tenant_users
    SET status = 'INACTIVE',
        updated_at = NOW()
    WHERE id = p_tenant_user_id;

    -- 7. Se for DRIVER, suspender o motorista respeitando a ordem de lock (1º PEDIDO -> 2º MOTORISTA)
    IF v_target_membership.role_id = 'DRIVER' THEN
        -- Ordem 1: Bloquear pedidos pendentes do motorista em rota
        PERFORM 1
        FROM public.orders
        WHERE driver_id = v_target_membership.user_id 
          AND tenant_id = v_target_membership.tenant_id 
          AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER')
        FOR UPDATE;

        -- Ordem 2: Bloquear e suspender cadastro do motorista
        UPDATE public.drivers
        SET status = 'SUSPENDED',
            updated_at = NOW()
        WHERE user_id = v_target_membership.user_id 
          AND tenant_id = v_target_membership.tenant_id;

        -- Registrar histórico para os pedidos que serão desatribuídos
        INSERT INTO public.order_status_history (
            order_id,
            status,
            note,
            changed_by,
            created_at
        )
        SELECT 
            id,
            'READY',
            'Membro da equipe inativado; pedido retornado para despacho (READY)',
            'Administração da Loja',
            NOW()
        FROM public.orders
        WHERE driver_id = v_target_membership.user_id 
          AND tenant_id = v_target_membership.tenant_id 
          AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER');

        -- Desatribuir pedidos em rota voltando para READY
        UPDATE public.orders
        SET driver_id = NULL,
            status = 'READY',
            updated_at = NOW()
        WHERE driver_id = v_target_membership.user_id 
          AND tenant_id = v_target_membership.tenant_id 
          AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER');
    END IF;

    -- 8. Auditoria forense
    PERFORM public.log_audit_event(
        'TEAM_MEMBER_REMOVED',
        'tenant_users',
        'Membro ' || v_target_membership.user_id::text || ' (Papel: ' || v_target_membership.role_id || ') inativado pelo operador ' || v_operator_id::text,
        p_tenant_user_id::text,
        v_target_membership.status,
        'INACTIVE',
        v_target_membership.tenant_id
    );

    RETURN jsonb_build_object('success', true, 'membershipId', p_tenant_user_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 4.5 ATUALIZAR PERFIL DO MOTORISTA (UPDATE_DRIVER_PROFILE)
-- Impede alteração de id, user_id e tenant_id
-- Bloqueia expressamente SUSPENDED (exige suspend_driver) e ON_DELIVERY (exige despacho)
-- Permitidos para atualização de perfil: SOMENTE AVAILABLE e UNAVAILABLE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_driver_profile(
    p_driver_id UUID,
    p_full_name VARCHAR DEFAULT NULL,
    p_phone VARCHAR DEFAULT NULL,
    p_document VARCHAR DEFAULT NULL,
    p_vehicle_type VARCHAR DEFAULT NULL,
    p_vehicle_model VARCHAR DEFAULT NULL,
    p_vehicle_plate VARCHAR DEFAULT NULL,
    p_status VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_driver RECORD;
    v_is_admin BOOLEAN := FALSE;
    v_is_self BOOLEAN := FALSE;
    v_clean_status VARCHAR(32);
    v_new_status VARCHAR(32);
BEGIN
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    SELECT id, tenant_id, user_id, full_name, phone, document, vehicle_type, vehicle_model, vehicle_plate, status
    INTO v_driver
    FROM public.drivers
    WHERE id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Motorista não encontrado.';
    END IF;

    v_is_admin := public.has_tenant_role(v_operator_id, v_driver.tenant_id, ARRAY['OWNER', 'MANAGER', 'DELIVERY_MANAGER']);
    v_is_self := (v_driver.user_id = v_operator_id);

    IF NOT (v_is_admin OR v_is_self) THEN
        RAISE EXCEPTION 'Permissão negada para atualizar este motorista.';
    END IF;

    -- Validação do status operacional
    IF p_status IS NOT NULL THEN
        v_clean_status := UPPER(TRIM(p_status));

        -- Bloqueio de SUSPENDED como atalho (obrigatório utilizar suspend_driver)
        IF v_clean_status = 'SUSPENDED' THEN
            RAISE EXCEPTION 'A suspensão do motorista deve ser realizada exclusivamente através da operação específica (suspend_driver).';
        END IF;

        -- Bloqueio de ON_DELIVERY manual (obrigatório fluxo de despacho de pedidos)
        IF v_clean_status = 'ON_DELIVERY' THEN
            RAISE EXCEPTION 'O status "Em Entrega" só pode ser atribuído pelo fluxo controlado de despacho de pedidos.';
        END IF;

        -- Apenas AVAILABLE e UNAVAILABLE podem ser definidos por atualização de perfil
        IF v_clean_status NOT IN ('AVAILABLE', 'UNAVAILABLE') THEN
            RAISE EXCEPTION 'Status operacional inválido para atualização de perfil: %. Permitidos: AVAILABLE, UNAVAILABLE.', v_clean_status;
        END IF;

        v_new_status := v_clean_status;
    ELSE
        v_new_status := v_driver.status;
    END IF;

    -- Validação de vehicle_type
    IF p_vehicle_type IS NOT NULL AND p_vehicle_type NOT IN ('MOTO', 'CARRO', 'BIKE', 'VAN', 'OUTRO') THEN
        RAISE EXCEPTION 'Tipo de veículo inválido: %.', p_vehicle_type;
    END IF;

    -- Atualização controlada dos campos operacionais
    -- id, user_id e tenant_id NUNCA são alterados
    UPDATE public.drivers
    SET full_name = COALESCE(NULLIF(TRIM(p_full_name), ''), full_name),
        phone = COALESCE(p_phone, phone),
        document = COALESCE(p_document, document),
        vehicle_type = COALESCE(p_vehicle_type, vehicle_type),
        vehicle_model = COALESCE(p_vehicle_model, vehicle_model),
        vehicle_plate = COALESCE(p_vehicle_plate, vehicle_plate),
        status = v_new_status,
        updated_at = NOW()
    WHERE id = p_driver_id;

    PERFORM public.log_audit_event(
        'DRIVER_UPDATED',
        'drivers',
        'Perfil do motorista atualizado por ' || v_operator_id::text,
        p_driver_id::text,
        v_driver.status,
        v_new_status,
        v_driver.tenant_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'driverId', p_driver_id,
        'status', v_new_status
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4.6 ATRIBUIR PEDIDO A MOTORISTA (ASSIGN_ORDER_TO_DRIVER)
-- Ordem de locks padronizada: 1º PEDIDO -> 2º MOTORISTA
-- Exige estritamente vínculo ativo e status AVAILABLE
-- Transição oficial: READY -> OUT_FOR_DELIVERY
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_order_to_driver(
    p_order_id UUID,
    p_driver_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_order RECORD;
    v_driver RECORD;
    v_target_order_status VARCHAR(32);
BEGIN
    -- 1. Validar autenticação
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Bloquear pedido com FOR UPDATE (Ordem: 1º Pedido)
    SELECT id, tenant_id, status, driver_id, total_amount
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Validar se o status do pedido permite despacho operacional
    IF v_order.status NOT IN ('READY', 'WAITING_FOR_DRIVER', 'OUT_FOR_DELIVERY') THEN
        RAISE EXCEPTION 'O pedido não está pronto para despacho (Status atual: %).', v_order.status;
    END IF;

    -- 3. Bloquear motorista com FOR UPDATE (Ordem: 2º Motorista)
    SELECT id, full_name, status, tenant_id
    INTO v_driver
    FROM public.drivers
    WHERE user_id = p_driver_user_id 
      AND tenant_id = v_order.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cadastro operacional de motorista não encontrado para este estabelecimento.';
    END IF;

    -- 4. Validar tenant: operador deve ser administrador do tenant do pedido
    IF NOT public.has_tenant_role(v_operator_id, v_order.tenant_id, ARRAY['OWNER', 'MANAGER', 'DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: somente administradores do estabelecimento podem despachar pedidos.';
    END IF;

    -- 5. Validar vínculo em tenant_users com papel DRIVER e status ACTIVE
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE tenant_id = v_order.tenant_id 
          AND user_id = p_driver_user_id 
          AND role_id = 'DRIVER' 
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'O usuário informado não é um motorista ativo deste estabelecimento.';
    END IF;

    -- 6. Validação estrita de disponibilidade: EXIGE STATUS AVAILABLE
    IF v_driver.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Motorista não está disponível para receber novos pedidos (Status atual: %).', v_driver.status;
    END IF;

    -- 7. Determinar status efetivamente aplicado ao pedido (READY -> OUT_FOR_DELIVERY)
    v_target_order_status := 'OUT_FOR_DELIVERY';

    -- 8. Atribuir pedido
    UPDATE public.orders
    SET driver_id = p_driver_user_id,
        status = v_target_order_status,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- 9. Alterar status do motorista para ON_DELIVERY
    UPDATE public.drivers
    SET status = 'ON_DELIVERY',
        updated_at = NOW()
    WHERE id = v_driver.id;

    -- 10. Inserir histórico de status com o status EFETIVAMENTE APLICADO
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    ) VALUES (
        p_order_id,
        v_target_order_status,
        'Pedido atribuído ao entregador ' || v_driver.full_name,
        'Despacho da Loja',
        NOW()
    );

    -- 11. Auditoria forense
    PERFORM public.log_audit_event(
        'ORDER_ASSIGNED_DRIVER',
        'orders',
        'Pedido atribuído ao entregador ' || v_driver.full_name || ' (' || p_driver_user_id::text || ')',
        p_order_id::text,
        v_order.driver_id::text,
        p_driver_user_id::text,
        v_order.tenant_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'orderId', p_order_id,
        'driverUserId', p_driver_user_id,
        'driverName', v_driver.full_name,
        'orderStatus', v_target_order_status
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4.7 DESATRIBUIR MOTORISTA DO PEDIDO (UNASSIGN_ORDER_DRIVER)
-- Ordem de locks padronizada: 1º PEDIDO -> 2º MOTORISTA
-- Transição oficial: OUT_FOR_DELIVERY -> READY
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unassign_order_driver(
    p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_order RECORD;
    v_driver RECORD;
    v_prev_driver_id UUID;
    v_new_order_status VARCHAR(32);
    v_remaining_orders_count INT;
BEGIN
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- Ordem 1: Bloquear Pedido com FOR UPDATE
    SELECT id, tenant_id, status, driver_id
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF NOT public.has_tenant_role(v_operator_id, v_order.tenant_id, ARRAY['OWNER', 'MANAGER', 'DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: somente administradores podem alterar a atribuição de pedidos.';
    END IF;

    v_prev_driver_id := v_order.driver_id;

    IF v_prev_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'orderId', p_order_id, 'message', 'Pedido já não possuía motorista.');
    END IF;

    -- Ordem 2: Bloquear Motorista com FOR UPDATE
    SELECT id, status INTO v_driver
    FROM public.drivers
    WHERE user_id = v_prev_driver_id 
      AND tenant_id = v_order.tenant_id
    FOR UPDATE;

    -- Se OUT_FOR_DELIVERY ou WAITING_FOR_DRIVER, retorna para READY. Não altera outros status automaticamente.
    v_new_order_status := CASE 
        WHEN v_order.status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER') THEN 'READY' 
        ELSE v_order.status 
    END;

    -- Desatribuir do pedido
    UPDATE public.orders
    SET driver_id = NULL,
        status = v_new_order_status,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- Verificar se o motorista ainda possui outros pedidos em rota
    SELECT COUNT(*) INTO v_remaining_orders_count
    FROM public.orders
    WHERE driver_id = v_prev_driver_id
      AND tenant_id = v_order.tenant_id
      AND status = 'OUT_FOR_DELIVERY';

    -- Se não houver outros pedidos em rota, retornar para AVAILABLE (preserva SUSPENDED)
    IF v_remaining_orders_count = 0 AND FOUND THEN
        UPDATE public.drivers
        SET status = 'AVAILABLE',
            updated_at = NOW()
        WHERE id = v_driver.id
          AND status <> 'SUSPENDED';
    END IF;

    -- Histórico com status efetivo
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    ) VALUES (
        p_order_id,
        v_new_order_status,
        'Motorista desatribuído pela gerência da loja',
        'Despacho da Loja',
        NOW()
    );

    PERFORM public.log_audit_event(
        'ORDER_UNASSIGNED_DRIVER',
        'orders',
        'Desatribuição de motorista para o pedido #' || p_order_id::text,
        p_order_id::text,
        v_prev_driver_id::text,
        NULL,
        v_order.tenant_id
    );

    RETURN jsonb_build_object('success', true, 'orderId', p_order_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 4.8 HARDENING DO STATUS OPERACIONAL DO MOTORISTA (UPDATE_DRIVER_ORDER_STATUS)
-- Ordem de locks padronizada: 1º PEDIDO -> 2º MOTORISTA
-- Valida vínculo ativo em tenant_users via auth.uid()
-- Transição estrita: OUT_FOR_DELIVERY -> DELIVERED
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_driver_order_status(
    p_order_id UUID,
    p_status VARCHAR,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_driver_user_id UUID := auth.uid();
    v_driver_record RECORD;
    v_order RECORD;
    v_remaining_orders INT;
    v_clean_status VARCHAR(32) := UPPER(TRIM(p_status));
BEGIN
    -- 1. Validar autenticação do motorista
    IF v_driver_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Validar se o status solicitado faz parte dos status operacionais do motorista
    IF v_clean_status NOT IN ('OUT_FOR_DELIVERY', 'DELIVERED') THEN
        RAISE EXCEPTION 'Status "%" não permitido para operação por motorista.', v_clean_status;
    END IF;

    -- 3. Ordem 1: Bloquear e validar o pedido atribuído (1º PEDIDO)
    SELECT id, tenant_id, status, driver_id INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Validar que o pedido está atribuído ao motorista autenticado (auth.uid)
    IF v_order.driver_id IS NULL OR v_order.driver_id <> v_driver_user_id THEN
        RAISE EXCEPTION 'Acesso negado: o pedido não está atribuído ao motorista autenticado.';
    END IF;

    -- Rejeitar expressamente pedido cancelado
    IF v_order.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Operação negada: pedido cancelado não pode ter seu status alterado pelo motorista.';
    END IF;

    -- 4. Validar vínculo ativo do motorista com o tenant do pedido em tenant_users
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_users
        WHERE tenant_id = v_order.tenant_id 
          AND user_id = v_driver_user_id 
          AND role_id = 'DRIVER' 
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Acesso negado: motorista não possui vínculo ativo com este estabelecimento.';
    END IF;

    -- 5. Ordem 2: Bloquear e validar o motorista (2º MOTORISTA)
    SELECT id, full_name, status INTO v_driver_record
    FROM public.drivers
    WHERE user_id = v_driver_user_id 
      AND tenant_id = v_order.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cadastro operacional de motorista não encontrado para este estabelecimento.';
    END IF;

    IF v_driver_record.status = 'SUSPENDED' THEN
        RAISE EXCEPTION 'Motorista está suspenso de atividades operacionais.';
    END IF;

    -- 6. Validação estrita das transições válidas de status do pedido:
    -- Somente OUT_FOR_DELIVERY -> DELIVERED é permitida para conclusão da entrega
    IF v_clean_status = 'DELIVERED' THEN
        IF v_order.status <> 'OUT_FOR_DELIVERY' THEN
            RAISE EXCEPTION 'Transição inválida: pedido com status "%" não pode ser finalizado como DELIVERED. É obrigatório estar em "OUT_FOR_DELIVERY".', v_order.status;
        END IF;
    ELSIF v_clean_status = 'OUT_FOR_DELIVERY' THEN
        -- Pode ser chamado para confirmar início de rota apenas se o pedido estiver em READY ou já OUT_FOR_DELIVERY
        IF v_order.status NOT IN ('READY', 'OUT_FOR_DELIVERY') THEN
            RAISE EXCEPTION 'Transição inválida: pedido com status "%" não pode avançar para "OUT_FOR_DELIVERY".', v_order.status;
        END IF;
    END IF;

    -- 7. Atualizar status e updated_at do pedido
    UPDATE public.orders
    SET status = v_clean_status,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- 8. Ajustar status operacional da frota em public.drivers
    IF v_clean_status = 'DELIVERED' THEN
        -- Verificar se ainda restam pedidos em rota para este motorista
        SELECT COUNT(*) INTO v_remaining_orders
        FROM public.orders
        WHERE driver_id = v_driver_user_id 
          AND tenant_id = v_order.tenant_id
          AND status = 'OUT_FOR_DELIVERY';

        -- Se não há mais entregas pendentes, retorna automaticamente para AVAILABLE
        IF v_remaining_orders = 0 THEN
            UPDATE public.drivers
            SET status = 'AVAILABLE',
                updated_at = NOW()
            WHERE id = v_driver_record.id;
        END IF;
    ELSIF v_clean_status = 'OUT_FOR_DELIVERY' THEN
        UPDATE public.drivers
        SET status = 'ON_DELIVERY',
            updated_at = NOW()
        WHERE id = v_driver_record.id;
    END IF;

    -- 9. Inserir histórico de status com identidade garantida do motorista
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    ) VALUES (
        p_order_id,
        v_clean_status,
        COALESCE(p_note, 'Atualização de rota pelo entregador'),
        v_driver_record.full_name,
        NOW()
    );

    -- 10. Gravar log de auditoria forense
    PERFORM public.log_audit_event(
        'ORDER_STATUS_UPDATE_DRIVER',
        'orders',
        'Motorista atualizou status do pedido #' || p_order_id::text || ' de ' || v_order.status || ' para ' || v_clean_status,
        p_order_id::text,
        v_order.status,
        v_clean_status,
        v_order.tenant_id
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4.9 SUSPENDER MOTORISTA (SUSPEND_DRIVER)
-- Ordem de locks padronizada anti-deadlock: 1º PEDIDOS -> 2º MOTORISTA
-- Transição de desatribuição: OUT_FOR_DELIVERY -> READY com histórico
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suspend_driver(
    p_driver_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_driver RECORD;
BEGIN
    -- 1. Validar autenticação
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    -- 2. Identificar motorista e tenant
    SELECT id, tenant_id, user_id, full_name, status
    INTO v_driver
    FROM public.drivers
    WHERE id = p_driver_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Motorista não encontrado.';
    END IF;

    -- 3. Validar administrador
    IF NOT public.has_tenant_role(v_operator_id, v_driver.tenant_id, ARRAY['OWNER', 'MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: somente proprietários e gerentes podem suspender motoristas.';
    END IF;

    -- 4. Ordem 1: Bloquear os pedidos pendentes em rota atribuídos ao motorista (1º PEDIDOS)
    PERFORM 1
    FROM public.orders
    WHERE driver_id = v_driver.user_id 
      AND tenant_id = v_driver.tenant_id 
      AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER')
    FOR UPDATE;

    -- 5. Ordem 2: Bloquear o motorista (2º MOTORISTA)
    SELECT id, tenant_id, user_id, full_name, status
    INTO v_driver
    FROM public.drivers
    WHERE id = p_driver_id
    FOR UPDATE;

    -- 6. Alterar motorista para SUSPENDED
    UPDATE public.drivers
    SET status = 'SUSPENDED',
        updated_at = NOW()
    WHERE id = p_driver_id;

    -- 7. Registrar histórico para os pedidos que serão desatribuídos
    INSERT INTO public.order_status_history (
        order_id,
        status,
        note,
        changed_by,
        created_at
    )
    SELECT 
        id,
        'READY',
        'Motorista foi suspenso; pedido retornado para despacho (READY)',
        'Administração da Loja',
        NOW()
    FROM public.orders
    WHERE driver_id = v_driver.user_id 
      AND tenant_id = v_driver.tenant_id 
      AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER');

    -- 8. Desatribuir pedidos pendentes que ainda não foram entregues voltando para READY
    UPDATE public.orders
    SET driver_id = NULL,
        status = 'READY',
        updated_at = NOW()
    WHERE driver_id = v_driver.user_id 
      AND tenant_id = v_driver.tenant_id 
      AND status IN ('OUT_FOR_DELIVERY', 'WAITING_FOR_DRIVER');

    -- 9. Trilha de auditoria
    PERFORM public.log_audit_event(
        'DRIVER_SUSPENDED',
        'drivers',
        'Motorista ' || v_driver.full_name || ' foi suspenso pelo administrador ' || v_operator_id::text,
        p_driver_id::text,
        v_driver.status,
        'SUSPENDED',
        v_driver.tenant_id
    );

    RETURN jsonb_build_object('success', true, 'driverId', p_driver_id);
END;
$$;

-- ==============================================================================
-- 5. PERMISSÕES DE EXECUÇÃO (REVOKE / GRANT)
-- ==============================================================================

REVOKE ALL ON FUNCTION public.create_team_invite(UUID, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_team_invite(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_team_invite(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_team_member(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_driver_profile(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_order_to_driver(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unassign_order_driver(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_driver_order_status(UUID, VARCHAR, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suspend_driver(UUID) FROM PUBLIC, anon, authenticated;

-- Conceder estritamente para authenticated (a verificação interna de papel e tenant protege a execução)
GRANT EXECUTE ON FUNCTION public.create_team_invite(UUID, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_team_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_team_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_team_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_driver_profile(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_order_to_driver(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unassign_order_driver(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_driver_order_status(UUID, VARCHAR, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suspend_driver(UUID) TO authenticated;

-- Fim da Migration 005
