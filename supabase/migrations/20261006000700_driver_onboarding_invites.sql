-- =============================================================================
-- PROPOSTA v2: 20261006000700_driver_onboarding_invites.sql  (NÃO APLICADA)
-- Base: main 10f9ecc + N1–N6 (último no staging: 20261006000600, confirmado read-only em 14/10).
-- Spec: /workspace/spec_app_entregador.md v1.1, §2.2, §3.1, §3.2, §4.1(2), §4.2, tabela §7 (0700).
--
-- PARTE A: regra Q8 (DRIVER × staff), convites por e-mail, CHECK de WAITER, TRUNCATE.
-- PARTE B: driver_profiles, drivers.approval_status, driver_invite_links e RPCs de QR,
--          revisão e estado do vínculo, assign exigindo APPROVED.
--
-- Definições:
--   staff            = OWNER, MANAGER, OPERATOR, CASHIER, DELIVERY_MANAGER
--   entregador ativo = drivers.status <> 'SUSPENDED' AND approval_status IN ('PENDING','APPROVED')
--   conflito Q8      = tenant_users com papel staff (qualquer status) + entregador ativo, mesma loja
--
-- ORDEM GLOBAL DE LOCKS (anti-deadlock), para o mesmo par (user, tenant):
--   1. linha do convite (team_invites / driver_invite_links)  [se houver]
--   2. pg_advisory_xact_lock(hashtext(user_id::text || tenant_id::text))
--   3. orders FOR UPDATE                                         [se houver]
--   4. tenant_users / drivers FOR UPDATE
--   Os triggers só pedem o advisory em transições PARA o estado ativo/staff. Toda RPC que faz
--   essa transição já pegou o advisory antes de travar linhas (o lock é reentrante). assign,
--   suspend_driver e remove_team_member nunca fazem transição para ativo, então não pedem o advisory.
--
-- Sem GRANT SELECT em drivers. O vínculo DRIVER sem linha em drivers não é tocado.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A0. PRECHECKS: abortam com diagnóstico (só contagens e ids, sem dados pessoais)
-- -----------------------------------------------------------------------------
DO $pre$
DECLARE v_n integer; v_ids text;
BEGIN
    -- (a) conflito DRIVER + staff
    SELECT count(*) INTO v_n
    FROM public.tenant_users tu
    JOIN public.drivers d ON d.user_id = tu.user_id AND d.tenant_id = tu.tenant_id
    WHERE tu.role_id IN ('OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER')
      AND d.status <> 'SUSPENDED';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'PRECHECK 0700-a: % conflito(s) DRIVER + staff na mesma loja. Decisão manual do David.', v_n;
    END IF;

    -- (b) convites WAITER ainda PENDING precisam de decisão (revogar ou reemitir com outro papel).
    --     WAITER em estado final (ACCEPTED/EXPIRED/REVOKED) é preservado pelo CHECK NOT VALID.
    SELECT count(*), string_agg(id::text, ',') INTO v_n, v_ids
    FROM public.team_invites WHERE role_id = 'WAITER' AND status = 'PENDING';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'PRECHECK 0700-b: % convite(s) WAITER pendente(s): %', v_n, v_ids;
    END IF;

    -- (c) mais de um convite PENDING válido por (loja, e-mail), que viola a nova regra de create
    SELECT count(*), string_agg(ids, ' ; ') INTO v_n, v_ids FROM (
        SELECT string_agg(id::text, ',') AS ids
        FROM public.team_invites
        WHERE status = 'PENDING' AND expires_at > now()
        GROUP BY tenant_id, lower(email) HAVING count(*) > 1) s;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'PRECHECK 0700-c: % grupo(s) de convites pendentes duplicados: %', v_n, v_ids;
    END IF;

    -- (d) objetos da Parte B não podem existir antes
    IF to_regclass('public.driver_invite_links') IS NOT NULL OR to_regclass('public.driver_profiles') IS NOT NULL
       OR EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='drivers' AND column_name='approval_status') THEN
        RAISE EXCEPTION 'PRECHECK 0700-d: objetos da 0700 já existem; estado diferente do auditado.';
    END IF;

    -- (e) dependências da N1 usadas abaixo
    IF to_regprocedure('public._rate_limit_hit(text,text,uuid,integer,integer)') IS NULL
       OR to_regprocedure('public._sha256_hex(text)') IS NULL
       OR to_regprocedure('public._request_ip_hash()') IS NULL
       OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
        RAISE EXCEPTION 'PRECHECK 0700-e: dependência ausente (N1 / pgcrypto).';
    END IF;

    -- (f) salt do HMAC de IP no Vault (usado por _request_ip_hash). Sem ele o rate limit do
    --     preview anônimo não funciona; a migração fica BLOQUEADA. Só checa existência/tamanho,
    --     nunca lê o valor para fora do servidor.
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                   WHERE name = 'n1n6_ip_hash_salt' AND length(decrypted_secret) >= 32) THEN
        RAISE EXCEPTION 'PRECHECK 0700-f: segredo n1n6_ip_hash_salt ausente ou curto no Vault. Ver 0700_README (setup do salt).';
    END IF;
END
$pre$;

-- -----------------------------------------------------------------------------
-- A1. CHECK de papéis do convite: novas linhas sem WAITER, legado preservado (NOT VALID)
--     Atenção: NOT VALID também vale para UPDATE. Só sobram WAITER em estado final, que
--     nenhuma RPC atualiza (garantido pelo precheck b).
-- -----------------------------------------------------------------------------
ALTER TABLE public.team_invites DROP CONSTRAINT chk_team_invites_role;
ALTER TABLE public.team_invites ADD CONSTRAINT chk_team_invites_role
    CHECK (role_id IN ('MANAGER','CASHIER','OPERATOR','DELIVERY_MANAGER','DRIVER')) NOT VALID;

-- -----------------------------------------------------------------------------
-- B1. tenant_users.status: amplia o CHECK com PENDING (spec §3.2 redeem; tabela §7 "senão, ampliar")
--     e INACTIVE (spec §2.2 REMOVED → INACTIVE; remove_team_member da 0005 já grava INACTIVE,
--     mas o CHECK do staging NÃO permite. Ver README, item aberto).
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenant_users DROP CONSTRAINT tenant_users_status_check;
ALTER TABLE public.tenant_users ADD CONSTRAINT tenant_users_status_check
    CHECK (status IN ('ACTIVE','SUSPENDED','INVITED','PENDING','INACTIVE'));

-- -----------------------------------------------------------------------------
-- B2. drivers.approval_status: backfill APPROVED atômico (ADD COLUMN com DEFAULT) e
--     depois DEFAULT PENDING (fail-closed para inserts novos; o accept grava APPROVED explícito)
-- -----------------------------------------------------------------------------
ALTER TABLE public.drivers ADD COLUMN approval_status varchar(16) NOT NULL DEFAULT 'APPROVED';
ALTER TABLE public.drivers ALTER COLUMN approval_status SET DEFAULT 'PENDING';
ALTER TABLE public.drivers ADD CONSTRAINT chk_drivers_approval_status
    CHECK (approval_status IN ('PENDING','APPROVED','REJECTED','SUSPENDED','REMOVED'));
COMMENT ON COLUMN public.drivers.approval_status IS
    'Estado do vínculo entregador–loja (spec §2.2). drivers.status continua sendo só disponibilidade.';

-- -----------------------------------------------------------------------------
-- B3. driver_profiles: perfil global do entregador, separado do vínculo por loja (D2).
--     A spec não lista colunas; ficam só as que o cadastro já pede (nome, telefone).
-- -----------------------------------------------------------------------------
CREATE TABLE public.driver_profiles (
    user_id    uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    full_name  varchar(255) NOT NULL,
    phone      varchar(32)  NOT NULL DEFAULT '',
    created_at timestamptz  NOT NULL DEFAULT now(),
    updated_at timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;   -- sem policies: só via RPC
REVOKE ALL ON public.driver_profiles FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- B4. driver_invite_links (spec §3.1): token só em hash
-- -----------------------------------------------------------------------------
CREATE TABLE public.driver_invite_links (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    token_hash  text NOT NULL UNIQUE,
    label       text CHECK (label IS NULL OR length(label) <= 80),
    max_uses    int  CHECK (max_uses IS NULL OR max_uses BETWEEN 1 AND 200),
    uses        int  NOT NULL DEFAULT 0 CHECK (uses >= 0 AND (max_uses IS NULL OR uses <= max_uses)),
    expires_at  timestamptz NOT NULL,
    status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
    created_by  uuid NOT NULL REFERENCES public.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_by  uuid REFERENCES public.users(id),
    revoked_at  timestamptz,
    CONSTRAINT chk_dil_expiry CHECK (expires_at <= created_at + interval '30 days 1 minute')
);
CREATE INDEX idx_dil_tenant ON public.driver_invite_links (tenant_id, status, expires_at);
ALTER TABLE public.driver_invite_links ENABLE ROW LEVEL SECURITY;  -- sem policies: só via RPC
REVOKE ALL ON public.driver_invite_links FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Helpers internos (sem EXECUTE para clientes)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_staff_role(p_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_role IN ('OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER');
$$;

CREATE OR REPLACE FUNCTION public._is_active_driver(p_status text, p_approval text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT p_status <> 'SUSPENDED' AND p_approval IN ('PENDING','APPROVED');
$$;

CREATE OR REPLACE FUNCTION public._lock_user_tenant(p_user_id uuid, p_tenant_id uuid)
RETURNS void LANGUAGE sql VOLATILE SET search_path = '' AS $$
    SELECT pg_advisory_xact_lock(hashtext(p_user_id::text || p_tenant_id::text));
$$;

CREATE OR REPLACE FUNCTION public._new_invite_token()
RETURNS text LANGUAGE sql VOLATILE SET search_path = '' AS $$
    -- 256 bits, base64url sem padding (encode(...,'base64url') só existe a partir do PG18)
    SELECT translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$$;

REVOKE ALL ON FUNCTION public._is_staff_role(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._is_active_driver(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lock_user_tenant(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._new_invite_token() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- A2. TRIGGERS de defesa
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_tenant_users_no_driver_staff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.tenant_id IS NULL OR NOT public._is_staff_role(NEW.role_id) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.user_id = OLD.user_id
       AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND NEW.role_id = OLD.role_id THEN
        RETURN NEW;
    END IF;
    PERFORM public._lock_user_tenant(NEW.user_id, NEW.tenant_id);
    IF EXISTS (SELECT 1 FROM public.drivers d
               WHERE d.user_id = NEW.user_id AND d.tenant_id = NEW.tenant_id
                 AND public._is_active_driver(d.status, d.approval_status)) THEN
        RAISE EXCEPTION 'Conflito de papel: este usuário é entregador ativo nesta loja e não pode ter papel de equipe.'
            USING ERRCODE = 'P0410';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_drivers_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    -- Spec §2.2: só vínculo APPROVED fica AVAILABLE ou recebe entrega
    IF NEW.status IN ('AVAILABLE','ON_DELIVERY') AND NEW.approval_status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Entregador não aprovado neste estabelecimento.' USING ERRCODE = 'P0414';
    END IF;
    IF NOT public._is_active_driver(NEW.status, NEW.approval_status) THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.user_id = OLD.user_id AND NEW.tenant_id = OLD.tenant_id
       AND public._is_active_driver(OLD.status, OLD.approval_status) THEN
        RETURN NEW;   -- já era ativo (ex.: AVAILABLE -> ON_DELIVERY): sem lock
    END IF;
    PERFORM public._lock_user_tenant(NEW.user_id, NEW.tenant_id);
    IF EXISTS (SELECT 1 FROM public.tenant_users tu
               WHERE tu.user_id = NEW.user_id AND tu.tenant_id = NEW.tenant_id
                 AND public._is_staff_role(tu.role_id)) THEN
        RAISE EXCEPTION 'Conflito de papel: este usuário tem papel de equipe nesta loja e não pode ser entregador.'
            USING ERRCODE = 'P0410';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_tenant_users_no_driver_staff() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_drivers_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_tenant_users_no_driver_staff
    BEFORE INSERT OR UPDATE OF user_id, tenant_id, role_id ON public.tenant_users
    FOR EACH ROW EXECUTE FUNCTION public.trg_tenant_users_no_driver_staff();

CREATE TRIGGER trg_drivers_guard
    BEFORE INSERT OR UPDATE OF user_id, tenant_id, status, approval_status ON public.drivers
    FOR EACH ROW EXECUTE FUNCTION public.trg_drivers_guard();

-- -----------------------------------------------------------------------------
-- A3. accept_team_invite: convite por e-mail continua aprovando direto (Q5/D8)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_team_invite(p_invite_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_user_email VARCHAR(255);
    v_user_name VARCHAR(255);
    v_user_phone VARCHAR(32);
    v_invite RECORD;
    v_member RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;

    SELECT email, name, phone INTO v_user_email, v_user_name, v_user_phone
    FROM public.users WHERE id = v_user_id;
    IF v_user_email IS NULL THEN
        v_user_email := auth.jwt()->>'email';
        v_user_name := COALESCE(auth.jwt()->>'name', 'Colaborador');
    END IF;
    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'Perfil do usuário não possui e-mail cadastrado.';
    END IF;

    -- Lock 1: convite
    SELECT id, tenant_id, email, role_id, status, expires_at INTO v_invite
    FROM public.team_invites WHERE id = p_invite_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Convite não encontrado.';
    END IF;
    IF v_invite.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Este convite não está mais pendente (Status: %).', v_invite.status;
    END IF;
    IF v_invite.expires_at <= NOW() THEN
        RAISE EXCEPTION 'Este convite expirou em %.', v_invite.expires_at;
    END IF;
    IF LOWER(v_user_email) <> LOWER(v_invite.email) THEN
        RAISE EXCEPTION 'Este convite foi emitido para outra conta.';
    END IF;
    IF v_invite.role_id NOT IN ('MANAGER','CASHIER','OPERATOR','DELIVERY_MANAGER','DRIVER') THEN
        RAISE EXCEPTION 'Papel "%" não é mais aceito por convite de equipe.', v_invite.role_id USING ERRCODE = 'P0411';
    END IF;

    -- Lock 2: (usuário, loja)
    PERFORM public._lock_user_tenant(v_user_id, v_invite.tenant_id);

    -- Lock 4: linhas
    SELECT id, role_id, status INTO v_member
    FROM public.tenant_users
    WHERE tenant_id = v_invite.tenant_id AND user_id = v_user_id FOR UPDATE;

    IF FOUND AND v_member.role_id <> v_invite.role_id THEN
        RAISE EXCEPTION 'Conflito de papel: você já possui o papel % nesta loja. Mudança de papel só pelo responsável do estabelecimento.', v_member.role_id
            USING ERRCODE = 'P0410';
    END IF;

    IF public._is_staff_role(v_invite.role_id) AND EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.user_id = v_user_id AND d.tenant_id = v_invite.tenant_id
          AND public._is_active_driver(d.status, d.approval_status)) THEN
        RAISE EXCEPTION 'Conflito de papel: você é entregador ativo nesta loja e não pode aceitar um convite de equipe.'
            USING ERRCODE = 'P0410';
    END IF;

    IF FOUND THEN
        UPDATE public.tenant_users SET status = 'ACTIVE', updated_at = NOW() WHERE id = v_member.id;
    ELSE
        INSERT INTO public.tenant_users (tenant_id, user_id, role_id, status, created_at, updated_at)
        VALUES (v_invite.tenant_id, v_user_id, v_invite.role_id, 'ACTIVE', NOW(), NOW());
    END IF;

    IF v_invite.role_id = 'DRIVER' THEN
        INSERT INTO public.driver_profiles (user_id, full_name, phone)
        VALUES (v_user_id, COALESCE(v_user_name, 'Entregador'), COALESCE(v_user_phone, ''))
        ON CONFLICT (user_id) DO NOTHING;

        INSERT INTO public.drivers (user_id, tenant_id, full_name, phone, status, approval_status, created_at, updated_at)
        VALUES (v_user_id, v_invite.tenant_id, COALESCE(v_user_name, 'Entregador'),
                COALESCE(v_user_phone, ''), 'AVAILABLE', 'APPROVED', NOW(), NOW())
        ON CONFLICT (user_id, tenant_id)
        DO UPDATE SET status = 'AVAILABLE', approval_status = 'APPROVED', updated_at = NOW();

        PERFORM public.log_audit_event('DRIVER_CREATED', 'drivers',
            'Vínculo de entregador aprovado via convite por e-mail',
            v_user_id::text, NULL, 'APPROVED', v_invite.tenant_id);
    END IF;

    UPDATE public.team_invites
    SET status = 'ACCEPTED', accepted_at = NOW(), accepted_by = v_user_id
    WHERE id = p_invite_id;

    PERFORM public.log_audit_event('TEAM_INVITE_ACCEPTED', 'team_invites',
        'Usuário ' || v_user_id::text || ' ingressou no tenant com papel ' || v_invite.role_id,
        p_invite_id::text, 'PENDING', 'ACCEPTED', v_invite.tenant_id);

    RETURN jsonb_build_object('success', true, 'tenantId', v_invite.tenant_id, 'roleId', v_invite.role_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- A4. create_team_invite
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_team_invite(p_tenant_id UUID, p_email VARCHAR, p_role_id VARCHAR)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_operator_id UUID := auth.uid();
    v_clean_email VARCHAR(255) := LOWER(TRIM(p_email));
    v_clean_role VARCHAR(32) := UPPER(TRIM(p_role_id));
    v_invite_id UUID;
    v_expires_at TIMESTAMPTZ := NOW() + INTERVAL '7 days';
    v_target_user UUID;
    v_member RECORD;
BEGIN
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'Acesso não autenticado.';
    END IF;
    IF p_tenant_id IS NULL OR NOT public.has_tenant_role(v_operator_id, p_tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada: somente proprietários e gerentes podem convidar colaboradores.';
    END IF;
    IF v_clean_role IN ('OWNER','CEO','SUPER_ADMIN') THEN
        RAISE EXCEPTION 'Este cargo não pode ser concedido por convite de equipe.';
    END IF;
    IF v_clean_role NOT IN ('MANAGER','CASHIER','OPERATOR','DELIVERY_MANAGER','DRIVER') THEN
        RAISE EXCEPTION 'Papel "%" inválido para convite de equipe.', v_clean_role;
    END IF;
    IF v_clean_email IS NULL OR v_clean_email NOT LIKE '%@%.%' THEN
        RAISE EXCEPTION 'Endereço de e-mail inválido.';
    END IF;

    -- Serializa convites para o mesmo e-mail nesta loja (o usuário pode ainda não existir).
    -- Chave distinta da (user,tenant); create nunca trava linhas de tenant_users/drivers.
    PERFORM pg_advisory_xact_lock(hashtext(v_clean_email || p_tenant_id::text));

    SELECT u.id INTO v_target_user FROM public.users u WHERE LOWER(u.email) = v_clean_email LIMIT 1;

    IF v_target_user IS NOT NULL THEN
        PERFORM public._lock_user_tenant(v_target_user, p_tenant_id);

        SELECT role_id, status INTO v_member
        FROM public.tenant_users WHERE tenant_id = p_tenant_id AND user_id = v_target_user;

        IF FOUND THEN
            IF v_member.status = 'ACTIVE' THEN
                RAISE EXCEPTION 'Este usuário já faz parte da equipe deste estabelecimento.' USING ERRCODE = 'P0412';
            END IF;
            IF v_member.role_id <> v_clean_role THEN
                RAISE EXCEPTION 'Conflito de papel: este usuário já tem vínculo (%) com papel % nesta loja.', v_member.status, v_member.role_id
                    USING ERRCODE = 'P0410';
            END IF;
        END IF;

        IF public._is_staff_role(v_clean_role) AND EXISTS (
            SELECT 1 FROM public.drivers d
            WHERE d.user_id = v_target_user AND d.tenant_id = p_tenant_id
              AND public._is_active_driver(d.status, d.approval_status)) THEN
            RAISE EXCEPTION 'Conflito de papel: este usuário é entregador ativo nesta loja.' USING ERRCODE = 'P0410';
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.team_invites
               WHERE tenant_id = p_tenant_id AND LOWER(email) = v_clean_email
                 AND status = 'PENDING' AND expires_at > NOW()) THEN
        RAISE EXCEPTION 'Já existe um convite pendente ativo para este e-mail.' USING ERRCODE = 'P0413';
    END IF;

    UPDATE public.team_invites SET status = 'EXPIRED'
    WHERE tenant_id = p_tenant_id AND LOWER(email) = v_clean_email
      AND status = 'PENDING' AND expires_at <= NOW();

    INSERT INTO public.team_invites (tenant_id, email, role_id, invited_by, status, expires_at, created_at)
    VALUES (p_tenant_id, v_clean_email, v_clean_role, v_operator_id, 'PENDING', v_expires_at, NOW())
    RETURNING id INTO v_invite_id;

    PERFORM public.log_audit_event('TEAM_INVITE_CREATED', 'team_invites',
        'Convite de equipe emitido com papel ' || v_clean_role, v_invite_id::text, NULL,
        jsonb_build_object('role', v_clean_role, 'expiresAt', v_expires_at)::text, p_tenant_id);

    RETURN jsonb_build_object('success', true, 'inviteId', v_invite_id, 'email', v_clean_email,
                              'roleId', v_clean_role, 'expiresAt', v_expires_at);
END;
$$;

-- -----------------------------------------------------------------------------
-- B5. assign_order_to_driver: corpo da 0005 + exigência de APPROVED (spec §4.2)
-- -----------------------------------------------------------------------------
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
    SELECT id, full_name, status, tenant_id, approval_status
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
    -- 0700: só vínculo APPROVED recebe atribuição (spec 2.2 / 4.2)
    IF v_driver.approval_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Entregador não aprovado neste estabelecimento.' USING ERRCODE = 'P0414';
    END IF;

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

-- -----------------------------------------------------------------------------
-- B6. RPCs de convite por link/QR (spec §3.2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_driver_invite_link(
    p_tenant_id uuid, p_label text DEFAULT NULL, p_expires_days int DEFAULT 7, p_max_uses int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_token text;
    v_id uuid;
    v_exp timestamptz;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.'; END IF;
    IF p_tenant_id IS NULL OR NOT public.has_tenant_role(v_uid, p_tenant_id, ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada.';
    END IF;
    IF p_expires_days IS NULL OR p_expires_days NOT BETWEEN 1 AND 30 THEN
        RAISE EXCEPTION 'Validade deve ser de 1 a 30 dias.';
    END IF;
    IF p_max_uses IS NOT NULL AND p_max_uses NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'Limite de usos deve ser de 1 a 200.';
    END IF;
    IF NOT public._rate_limit_hit('driver_invite_create', v_uid::text, p_tenant_id, 20, 3600) THEN
        RAISE EXCEPTION 'Muitas tentativas. Tente mais tarde.' USING ERRCODE = 'P0429';
    END IF;

    v_token := public._new_invite_token();
    v_exp := now() + make_interval(days => p_expires_days);
    INSERT INTO public.driver_invite_links (tenant_id, token_hash, label, max_uses, expires_at, created_by)
    VALUES (p_tenant_id, public._sha256_hex(v_token), NULLIF(btrim(p_label), ''), p_max_uses, v_exp, v_uid)
    RETURNING id INTO v_id;

    PERFORM public.log_audit_event('DRIVER_INVITE_LINK_CREATED', 'driver_invite_links', 'Convite de entregador por link criado',
        v_id::text, NULL, jsonb_build_object('expiresAt', v_exp, 'maxUses', p_max_uses)::text, p_tenant_id);

    -- Token devolvido uma única vez. url é relativa: o front prefixa a origem (domínio não está no banco).
    RETURN jsonb_build_object('id', v_id, 'token', v_token, 'url', '/entregador/convite/' || v_token, 'expires_at', v_exp);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_driver_invite_link(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_l record;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.'; END IF;
    SELECT id, tenant_id, status INTO v_l FROM public.driver_invite_links WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR NOT public.has_tenant_role(v_uid, v_l.tenant_id, ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Convite não encontrado.';   -- não revela convites de outra loja
    END IF;
    IF v_l.status = 'REVOKED' THEN
        RETURN jsonb_build_object('id', p_id, 'status', 'REVOKED', 'changed', false);
    END IF;
    UPDATE public.driver_invite_links SET status = 'REVOKED', revoked_by = v_uid, revoked_at = now() WHERE id = p_id;
    PERFORM public.log_audit_event('DRIVER_INVITE_LINK_REVOKED', 'driver_invite_links', 'Convite de entregador revogado',
        p_id::text, 'ACTIVE', 'REVOKED', v_l.tenant_id);
    RETURN jsonb_build_object('id', p_id, 'status', 'REVOKED', 'changed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_driver_invite_link(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_l record; v_days int;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.'; END IF;
    SELECT id, tenant_id, label, max_uses, expires_at, created_at INTO v_l
    FROM public.driver_invite_links WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR NOT public.has_tenant_role(v_uid, v_l.tenant_id, ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Convite não encontrado.';
    END IF;
    PERFORM public.revoke_driver_invite_link(p_id);
    v_days := LEAST(30, GREATEST(1, round(extract(epoch FROM (v_l.expires_at - v_l.created_at)) / 86400)::int));
    RETURN public.create_driver_invite_link(v_l.tenant_id, v_l.label, v_days, v_l.max_uses);
END;
$$;

-- Lista para o painel, sem token_hash (spec §3.1: "expor por view ou list_driver_invite_links")
CREATE OR REPLACE FUNCTION public.list_driver_invite_links(p_tenant_id uuid)
RETURNS TABLE (id uuid, label text, max_uses int, uses int, expires_at timestamptz, state text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada.';
    END IF;
    RETURN QUERY
    SELECT l.id, l.label, l.max_uses, l.uses, l.expires_at,
           CASE WHEN l.status = 'REVOKED' THEN 'REVOKED'
                WHEN l.expires_at <= now() OR (l.max_uses IS NOT NULL AND l.uses >= l.max_uses) THEN 'EXPIRED'
                ELSE 'ACTIVE' END,
           l.created_at
    FROM public.driver_invite_links l
    WHERE l.tenant_id = p_tenant_id
    ORDER BY l.created_at DESC;
END;
$$;

-- Público (anon): só nome da loja, validade e valid. Inválido = valid:false, sem motivo.
CREATE OR REPLACE FUNCTION public.preview_driver_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_r record; v_ip text := public._request_ip_hash();
BEGIN
    -- 30/min por hash de IP. FAIL-CLOSED: sem hash de IP (salt ausente ou sem x-forwarded-for)
    -- não há como limitar, então responde valid:false em vez de liberar.
    IF v_ip IS NULL OR v_ip = '' THEN
        RETURN jsonb_build_object('valid', false);
    END IF;
    IF NOT public._rate_limit_hit('driver_invite_preview', COALESCE(v_ip, ''), NULL, 30, 60) THEN
        RETURN jsonb_build_object('valid', false);
    END IF;
    IF p_token IS NULL OR length(p_token) NOT BETWEEN 20 AND 128 THEN
        RETURN jsonb_build_object('valid', false);
    END IF;
    SELECT l.expires_at, t.name AS store_name INTO v_r
    FROM public.driver_invite_links l JOIN public.tenants t ON t.id = l.tenant_id
    WHERE l.token_hash = public._sha256_hex(p_token)
      AND l.status = 'ACTIVE' AND l.expires_at > now()
      AND (l.max_uses IS NULL OR l.uses < l.max_uses)
      AND t.status = 'ACTIVE';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false);
    END IF;
    -- store_logo: a spec pede, mas public.tenants não tem coluna de logo (verificado). Fica NULL.
    RETURN jsonb_build_object('valid', true, 'store_name', v_r.store_name, 'store_logo', NULL, 'expires_at', v_r.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_driver_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_l record;
    v_tu record;
    v_d record;
    v_name varchar(255);
    v_phone varchar(32);
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.'; END IF;
    IF NOT public._rate_limit_hit('driver_invite_redeem', v_uid::text, NULL, 10, 600) THEN
        RAISE EXCEPTION 'Muitas tentativas. Tente mais tarde.' USING ERRCODE = 'P0429';
    END IF;
    -- Token inválido/expirado/esgotado RETORNA (não levanta erro): um RAISE desfaria o
    -- incremento do rate limit na mesma transação e liberaria força bruta de tokens.
    IF p_token IS NULL OR length(p_token) NOT BETWEEN 20 AND 128 THEN
        RETURN jsonb_build_object('status', 'INVALID', 'consumed', false);
    END IF;

    -- Lock 1: convite. O tenant vem SEMPRE daqui.
    SELECT l.id, l.tenant_id, l.status, l.expires_at, l.max_uses, l.uses INTO v_l
    FROM public.driver_invite_links l JOIN public.tenants t ON t.id = l.tenant_id AND t.status = 'ACTIVE'
    WHERE l.token_hash = public._sha256_hex(p_token)
    FOR UPDATE OF l;
    IF NOT FOUND OR v_l.status <> 'ACTIVE' OR v_l.expires_at <= now()
       OR (v_l.max_uses IS NOT NULL AND v_l.uses >= v_l.max_uses) THEN
        RETURN jsonb_build_object('status', 'INVALID', 'consumed', false);
    END IF;

    -- Lock 2: (usuário, loja)
    PERFORM public._lock_user_tenant(v_uid, v_l.tenant_id);

    SELECT id, role_id, status INTO v_tu FROM public.tenant_users
    WHERE user_id = v_uid AND tenant_id = v_l.tenant_id FOR UPDATE;
    IF FOUND AND v_tu.role_id <> 'DRIVER' THEN
        RAISE EXCEPTION 'Não foi possível usar este convite com esta conta.' USING ERRCODE = 'P0410';  -- genérico (spec §4.1)
    END IF;

    SELECT id, approval_status INTO v_d FROM public.drivers
    WHERE user_id = v_uid AND tenant_id = v_l.tenant_id FOR UPDATE;

    IF v_d.id IS NULL AND v_tu.id IS NOT NULL THEN
        -- Vínculo DRIVER sem linha em drivers: inconsistência conhecida, não é corrigida por aqui.
        RAISE EXCEPTION 'Não foi possível usar este convite com esta conta.' USING ERRCODE = 'P0416';
    END IF;

    IF v_d.id IS NOT NULL THEN
        -- Já existe vínculo nesta loja (APPROVED, PENDING, SUSPENDED, REJECTED ou REMOVED):
        -- devolve o estado, NÃO altera nada e NÃO consome uso. Reabrir SUSPENDED/REJECTED/REMOVED
        -- é decisão explícita do OWNER/MANAGER (set_driver_link_status REACTIVATE ou convite por e-mail).
        RETURN jsonb_build_object('status', v_d.approval_status, 'tenantId', v_l.tenant_id, 'consumed', false);
    END IF;

    SELECT name, phone INTO v_name, v_phone FROM public.users WHERE id = v_uid;

    INSERT INTO public.driver_profiles (user_id, full_name, phone)
    VALUES (v_uid, COALESCE(v_name, 'Entregador'), COALESCE(v_phone, ''))
    ON CONFLICT (user_id) DO NOTHING;

    -- Aqui não existe vínculo algum nesta loja (nem tenant_users, nem drivers).
    INSERT INTO public.drivers (user_id, tenant_id, full_name, phone, status, approval_status)
    SELECT v_uid, v_l.tenant_id, p.full_name, p.phone, 'UNAVAILABLE', 'PENDING'
    FROM public.driver_profiles p WHERE p.user_id = v_uid;

    INSERT INTO public.tenant_users (tenant_id, user_id, role_id, status, created_at, updated_at)
    VALUES (v_l.tenant_id, v_uid, 'DRIVER', 'PENDING', now(), now());

    UPDATE public.driver_invite_links SET uses = uses + 1 WHERE id = v_l.id;

    PERFORM public.log_audit_event('DRIVER_INVITE_REDEEMED', 'driver_invite_links', 'Cadastro de entregador via link (PENDING)',
        v_l.id::text, NULL, v_uid::text, v_l.tenant_id);

    RETURN jsonb_build_object('status', 'PENDING', 'tenantId', v_l.tenant_id, 'consumed', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- B7. Revisão e estado do vínculo: SOMENTE OWNER/MANAGER (decisão do CEO 14/10, ponto 1).
--     DELIVERY_MANAGER gerencia links (create/list/renew/revoke), mas não aprova, rejeita nem suspende.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_driver_application(p_driver_id uuid, p_decision text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_k record; v_d record; v_dec text := upper(btrim(p_decision));
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.'; END IF;
    IF v_dec NOT IN ('APPROVE','REJECT') THEN RAISE EXCEPTION 'Decisão inválida.'; END IF;
    SELECT user_id, tenant_id INTO v_k FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND OR NOT public.has_tenant_role(v_uid, v_k.tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'Entregador não encontrado.';
    END IF;
    PERFORM public._lock_user_tenant(v_k.user_id, v_k.tenant_id);           -- lock 2 antes da linha
    SELECT id, user_id, tenant_id, approval_status INTO v_d FROM public.drivers WHERE id = p_driver_id FOR UPDATE;
    IF v_d.approval_status <> 'PENDING' THEN
        RAISE EXCEPTION 'Cadastro não está pendente (estado: %).', v_d.approval_status USING ERRCODE = 'P0417';
    END IF;

    IF v_dec = 'APPROVE' THEN
        UPDATE public.drivers SET approval_status = 'APPROVED', updated_at = now() WHERE id = p_driver_id;
        UPDATE public.tenant_users SET status = 'ACTIVE', updated_at = now()
        WHERE user_id = v_d.user_id AND tenant_id = v_d.tenant_id AND role_id = 'DRIVER';
    ELSE
        UPDATE public.drivers SET approval_status = 'REJECTED', status = 'UNAVAILABLE', updated_at = now() WHERE id = p_driver_id;
        -- Decisão do CEO/GPT 14/10: REJECT também encerra o vínculo de acesso (tela "Cadastro não aprovado").
        UPDATE public.tenant_users SET status = 'INACTIVE', updated_at = now()
        WHERE user_id = v_d.user_id AND tenant_id = v_d.tenant_id AND role_id = 'DRIVER';
    END IF;

    PERFORM public.log_audit_event('DRIVER_APPLICATION_' || v_dec || 'D', 'drivers',
        'Revisão de cadastro de entregador' || CASE WHEN p_reason IS NOT NULL THEN ': ' || left(p_reason, 200) ELSE '' END,
        p_driver_id::text, 'PENDING', CASE v_dec WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END, v_d.tenant_id);

    RETURN jsonb_build_object('driverId', p_driver_id, 'status', CASE v_dec WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_driver_link_status(p_driver_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_k record; v_d record; v_act text := upper(btrim(p_action)); v_new text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.'; END IF;
    IF v_act NOT IN ('SUSPEND','REACTIVATE','REMOVE') THEN RAISE EXCEPTION 'Ação inválida.'; END IF;
    SELECT user_id, tenant_id INTO v_k FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND OR NOT public.has_tenant_role(v_uid, v_k.tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'Entregador não encontrado.';
    END IF;

    PERFORM public._lock_user_tenant(v_k.user_id, v_k.tenant_id);           -- lock 2
    IF EXISTS (SELECT 1 FROM public.orders o                                 -- lock 3
               WHERE o.driver_id = v_k.user_id AND o.tenant_id = v_k.tenant_id
                 AND o.status = 'OUT_FOR_DELIVERY' FOR UPDATE) AND v_act <> 'REACTIVATE' THEN
        RAISE EXCEPTION 'Entregador com pedido em rota. Desatribua ou reporte a falha antes.' USING ERRCODE = 'P0418';
    END IF;
    SELECT id, user_id, tenant_id, approval_status INTO v_d FROM public.drivers WHERE id = p_driver_id FOR UPDATE;  -- lock 4

    IF v_act = 'SUSPEND' THEN
        IF v_d.approval_status <> 'APPROVED' THEN RAISE EXCEPTION 'Só vínculo aprovado pode ser suspenso.' USING ERRCODE = 'P0417'; END IF;
        PERFORM public.suspend_driver(p_driver_id);     -- reaproveita (status SUSPENDED + devolve WAITING_FOR_DRIVER)
        UPDATE public.drivers SET approval_status = 'SUSPENDED', updated_at = now() WHERE id = p_driver_id;
        v_new := 'SUSPENDED';
    ELSIF v_act = 'REACTIVATE' THEN
        IF v_d.approval_status <> 'SUSPENDED' THEN RAISE EXCEPTION 'Só vínculo suspenso pode ser reativado.' USING ERRCODE = 'P0417'; END IF;
        UPDATE public.drivers SET approval_status = 'APPROVED', status = 'UNAVAILABLE', updated_at = now() WHERE id = p_driver_id;
        UPDATE public.tenant_users SET status = 'ACTIVE', updated_at = now()
        WHERE user_id = v_d.user_id AND tenant_id = v_d.tenant_id AND role_id = 'DRIVER';
        v_new := 'APPROVED';
    ELSE
        IF v_d.approval_status NOT IN ('APPROVED','SUSPENDED') THEN RAISE EXCEPTION 'Vínculo não pode ser removido neste estado.' USING ERRCODE = 'P0417'; END IF;
        IF v_d.approval_status = 'APPROVED' THEN PERFORM public.suspend_driver(p_driver_id); END IF;
        UPDATE public.drivers SET approval_status = 'REMOVED', status = 'SUSPENDED', updated_at = now() WHERE id = p_driver_id;
        UPDATE public.tenant_users SET status = 'INACTIVE', updated_at = now()
        WHERE user_id = v_d.user_id AND tenant_id = v_d.tenant_id AND role_id = 'DRIVER';
        v_new := 'REMOVED';
    END IF;

    PERFORM public.log_audit_event('DRIVER_LINK_' || v_act, 'drivers',
        'Estado do vínculo do entregador alterado' || CASE WHEN p_reason IS NOT NULL THEN ': ' || left(p_reason, 200) ELSE '' END,
        p_driver_id::text, v_d.approval_status, v_new, v_d.tenant_id);
    RETURN jsonb_build_object('driverId', p_driver_id, 'status', v_new);
END;
$$;

-- -----------------------------------------------------------------------------
-- B8 (v3.2, 14/10). Leitura do PRÓPRIO approval_status pelo entregador.
--     Substitui a leitura direta de public.drivers pelo front (que não tem GRANT SELECT e não deve ter).
--     Só a linha (auth.uid(), p_tenant_id); nunca recebe user_id; sem dados de outros usuários/lojas.
--     Sem linha → 'NONE'. Sem sessão → erro. Só leitura (STABLE), search_path vazio.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_driver_approval(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_s text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'Loja obrigatória.'; END IF;
    SELECT d.approval_status INTO v_s FROM public.drivers d
    WHERE d.user_id = v_uid AND d.tenant_id = p_tenant_id;
    RETURN jsonb_build_object('approval_status', COALESCE(v_s, 'NONE'));
END;
$$;

-- -----------------------------------------------------------------------------
-- B9 (v3.3, 14/10). Listagem do painel Entregadores SEM GRANT SELECT em drivers.
--     Só OWNER/MANAGER ATIVOS do tenant (has_tenant_role verifica no servidor; o p_tenant_id do
--     navegador só escolhe a loja, a autorização é refeita aqui). Também CEO/SUPER_ADMIN ativos,
--     porque has_tenant_role já os inclui (modo suporte).
--     SECURITY DEFINER é necessário: authenticated não tem SELECT em drivers (e não deve ter).
--     Só colunas que a tela usa; sem document, sem tokens, sem dados de outras tabelas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_tenant_drivers(p_tenant_id uuid)
RETURNS TABLE (id uuid, user_id uuid, full_name text, phone text, vehicle_type text, vehicle_model text,
               vehicle_plate text, status text, approval_status text, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_tenant_id IS NULL OR NOT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT d.id, d.user_id, d.full_name::text, d.phone::text, d.vehicle_type::text, d.vehicle_model::text,
           d.vehicle_plate::text, d.status::text, d.approval_status::text, d.created_at, d.updated_at
    FROM public.drivers d
    WHERE d.tenant_id = p_tenant_id
    ORDER BY d.full_name;
END;
$$;

-- -----------------------------------------------------------------------------
-- B10 (v3.4, 14/10). Seletor de atribuição (Pedidos/Dashboard/Entregadores).
--     Separada de list_tenant_drivers (que continua só OWNER/MANAGER e não foi ampliada).
--     Autoriza os mesmos papéis que assign_order_to_driver: OWNER, MANAGER e DELIVERY_MANAGER
--     ATIVOS da loja (has_tenant_role no servidor). CASHIER, DRIVER, outra loja e anon: negados.
--     Só entregadores elegíveis: approval APPROVED, drivers.status <> SUSPENDED e vínculo
--     tenant_users DRIVER ACTIVE na mesma loja. Só 4 campos: driver_user_id (o id usado por
--     assign_order_to_driver), display_name, availability, approval_status.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_assignable_drivers(p_tenant_id uuid)
RETURNS TABLE (driver_user_id uuid, display_name text, availability text, approval_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso não autenticado.' USING ERRCODE = '42501'; END IF;
    IF p_tenant_id IS NULL OR NOT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER','DELIVERY_MANAGER']) THEN
        RAISE EXCEPTION 'Permissão negada.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT d.user_id, d.full_name::text, d.status::text, d.approval_status::text
    FROM public.drivers d
    WHERE d.tenant_id = p_tenant_id
      AND d.approval_status = 'APPROVED'
      AND d.status <> 'SUSPENDED'
      AND EXISTS (SELECT 1 FROM public.tenant_users tu
                  WHERE tu.user_id = d.user_id AND tu.tenant_id = d.tenant_id
                    AND tu.role_id = 'DRIVER' AND tu.status = 'ACTIVE')
    ORDER BY (d.status = 'AVAILABLE') DESC, d.full_name;
END;
$$;

-- -----------------------------------------------------------------------------
-- Grants das RPCs (EXECUTE só authenticated; preview também anon)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.accept_team_invite(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_team_invite(UUID, VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_order_to_driver(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_driver_invite_link(uuid, text, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_driver_invite_link(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_driver_invite_link(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_driver_invite_links(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_driver_invite(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_driver_invite(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_driver_application(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_driver_link_status(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_driver_approval(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_tenant_drivers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_assignable_drivers(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accept_team_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_invite(UUID, VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_order_to_driver(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_driver_invite_link(uuid, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_driver_invite_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renew_driver_invite_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_driver_invite_links(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_driver_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_driver_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_driver_application(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_driver_link_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_driver_approval(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_drivers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_assignable_drivers(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- A5. REVOKE TRUNCATE em drivers
-- Antes (staging 14/10): anon/authenticated = TRUNCATE, REFERENCES, TRIGGER; sem SELECT.
-- Depois esperado:       anon/authenticated = REFERENCES, TRIGGER.
-- -----------------------------------------------------------------------------
DO $chk$
BEGIN
    IF has_table_privilege('authenticated', 'public.drivers', 'SELECT') OR has_table_privilege('anon', 'public.drivers', 'SELECT') THEN
        RAISE EXCEPTION 'PRECHECK A5: SELECT em drivers já concedido; estado diferente do auditado.';
    END IF;
END
$chk$;

REVOKE TRUNCATE ON public.drivers FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- POSTCHECKS
-- -----------------------------------------------------------------------------
DO $post$
DECLARE r text;
BEGIN
    IF has_table_privilege('authenticated', 'public.drivers', 'TRUNCATE') OR has_table_privilege('anon', 'public.drivers', 'TRUNCATE') THEN
        RAISE EXCEPTION 'POSTCHECK: TRUNCATE ainda presente em drivers.';
    END IF;
    IF has_table_privilege('authenticated', 'public.drivers', 'SELECT') OR has_table_privilege('anon', 'public.drivers', 'SELECT') THEN
        RAISE EXCEPTION 'POSTCHECK: SELECT não deveria existir em drivers.';
    END IF;
    FOREACH r IN ARRAY ARRAY['public.driver_invite_links','public.driver_profiles'] LOOP
        IF has_table_privilege('authenticated', r, 'SELECT') OR has_table_privilege('anon', r, 'SELECT')
           OR has_table_privilege('authenticated', r, 'INSERT') OR has_table_privilege('authenticated', r, 'TRUNCATE') THEN
            RAISE EXCEPTION 'POSTCHECK: privilégio de tabela indevido em %.', r;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.drivers WHERE approval_status <> 'APPROVED') THEN
        RAISE EXCEPTION 'POSTCHECK: backfill de approval_status incompleto.';
    END IF;
    IF has_function_privilege('anon', 'public.redeem_driver_invite(text)', 'EXECUTE')
       OR NOT has_function_privilege('anon', 'public.preview_driver_invite(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'POSTCHECK: grants de função inesperados.';
    END IF;
END
$post$;

COMMIT;
