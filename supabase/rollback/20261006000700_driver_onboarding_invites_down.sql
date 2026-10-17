-- EFEITOS DESTRUTIVOS (IRREVERSÍVEIS sem backup): DROP TABLE driver_profiles e driver_invite_links (todos os dados),
--   DROP COLUMN drivers.approval_status; remove 17 RPCs/auxiliares de entregador; restaura 3 RPCs antigas.
-- Rollback 0700 (onboarding de entregadores/convites).
-- PERDA DE DADOS IRREVERSÍVEL: apaga driver_profiles e driver_invite_links inteiros e a coluna drivers.approval_status.
-- Linhas criadas pelos fluxos novos em drivers/tenant_users (role DRIVER) NÃO são apagadas (ficam como registros legados).
-- ABORTA se houver tenant_users com status PENDING/INACTIVE (não cabem no CHECK antigo): decisão manual antes.
-- Restaura as versões de produção de accept_team_invite, create_team_invite e assign_order_to_driver.
-- O REVOKE TRUNCATE em drivers do 0700 não é desfeito de propósito (privilégio perigoso).
BEGIN;
DO $pre$ DECLARE v_n int; BEGIN
  IF to_regprocedure('public.list_team_invites(uuid)') IS NOT NULL OR to_regprocedure('public.set_my_availability(uuid,text)') IS NOT NULL
     OR to_regclass('public.driver_locations') IS NOT NULL THEN
    RAISE EXCEPTION 'PRE: reverter 0900–1300 antes do 0700';
  END IF;
  SELECT count(*) INTO v_n FROM public.tenant_users WHERE status NOT IN ('ACTIVE','SUSPENDED','INVITED');
  IF v_n > 0 THEN RAISE EXCEPTION 'PRE: % tenant_users com status PENDING/INACTIVE — decidir manualmente antes do rollback', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.driver_profiles;  RAISE NOTICE '0700 down: % driver_profiles serão apagados', v_n;
  SELECT count(*) INTO v_n FROM public.driver_invite_links; RAISE NOTICE '0700 down: % driver_invite_links serão apagados', v_n;
END $pre$;

DROP TRIGGER IF EXISTS trg_drivers_guard ON public.drivers;
DROP TRIGGER IF EXISTS trg_tenant_users_no_driver_staff ON public.tenant_users;
DROP FUNCTION IF EXISTS public.trg_drivers_guard();
DROP FUNCTION IF EXISTS public.trg_tenant_users_no_driver_staff();
DROP FUNCTION IF EXISTS public.create_driver_invite_link(uuid, text, int, int);
DROP FUNCTION IF EXISTS public.revoke_driver_invite_link(uuid);
DROP FUNCTION IF EXISTS public.renew_driver_invite_link(uuid);
DROP FUNCTION IF EXISTS public.list_driver_invite_links(uuid);
DROP FUNCTION IF EXISTS public.preview_driver_invite(text);
DROP FUNCTION IF EXISTS public.redeem_driver_invite(text);
DROP FUNCTION IF EXISTS public.review_driver_application(uuid, text, text);
DROP FUNCTION IF EXISTS public.set_driver_link_status(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_my_driver_approval(uuid);
DROP FUNCTION IF EXISTS public.list_tenant_drivers(uuid);
DROP FUNCTION IF EXISTS public.list_assignable_drivers(uuid);

-- versões de produção (pré-0700)
CREATE OR REPLACE FUNCTION public.accept_team_invite(p_invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.assign_order_to_driver(p_order_id uuid, p_driver_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_team_invite(p_tenant_id uuid, p_email character varying, p_role_id character varying)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

REVOKE ALL ON FUNCTION public.accept_team_invite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_team_invite(uuid, varchar, varchar) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_order_to_driver(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_team_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_invite(uuid, varchar, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_order_to_driver(uuid, uuid) TO authenticated;

-- auxiliares usados só pelas funções removidas
DROP FUNCTION IF EXISTS public._is_staff_role(text);
DROP FUNCTION IF EXISTS public._is_active_driver(text, text);
DROP FUNCTION IF EXISTS public._lock_user_tenant(uuid, uuid);
DROP FUNCTION IF EXISTS public._new_invite_token();

DROP TABLE public.driver_invite_links;
DROP TABLE public.driver_profiles;
ALTER TABLE public.drivers DROP CONSTRAINT chk_drivers_approval_status;
ALTER TABLE public.drivers DROP COLUMN approval_status;

ALTER TABLE public.tenant_users DROP CONSTRAINT tenant_users_status_check;
ALTER TABLE public.tenant_users ADD CONSTRAINT tenant_users_status_check
  CHECK (((status)::text = ANY (ARRAY[('ACTIVE'::character varying)::text, ('SUSPENDED'::character varying)::text, ('INVITED'::character varying)::text])));
ALTER TABLE public.team_invites DROP CONSTRAINT chk_team_invites_role;
ALTER TABLE public.team_invites ADD CONSTRAINT chk_team_invites_role
  CHECK (((role_id)::text = ANY (ARRAY[('MANAGER'::character varying)::text, ('CASHIER'::character varying)::text, ('OPERATOR'::character varying)::text, ('DELIVERY_MANAGER'::character varying)::text, ('DRIVER'::character varying)::text, ('WAITER'::character varying)::text])));

DO $post$ BEGIN
  IF to_regclass('public.driver_profiles') IS NOT NULL OR to_regclass('public.driver_invite_links') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='drivers' AND column_name='approval_status')
     OR to_regprocedure('public.get_my_driver_approval(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'POST: objetos do 0700 ainda existem';
  END IF;
END $post$;
COMMIT;
