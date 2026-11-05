-- Entrega 1.1 / C: equipe por função e movimento do salão.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public._entrega1_1_b_restore') IS NULL THEN RAISE EXCEPTION 'PRECHECK: Entrega 1.1 B ausente.'; END IF;
END $$;

-- Preserva definição e ACL efetivas, inclusive instalações com grants padrão antigos.
CREATE TABLE public._entrega1_1_c_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega1_1_c_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_1_c_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega1_1_c_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid='public.list_team_invites(uuid)'::regprocedure;

-- O endereço usado para aceitar/renovar continua privado na tabela. A listagem só
-- retorna máscara; não exige nem concede SELECT direto em team_invites.
DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.list_team_invites(uuid)'::regprocedure);
 v_new:=replace(v_def,'ti.email::text','COALESCE(public._receipt_mask_email(ti.email::text),''***'')');
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_1_PATCH_MISMATCH: list_team_invites/email_mask'; END IF;
 EXECUTE v_new;
END $$;

-- O fluxo existente não envia e-mail. Reenviar renova a validade para o gestor
-- compartilhar o mesmo link de loja/papel; a identidade é conferida no aceite.
CREATE FUNCTION public.resend_team_invite(p_invite uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_invite public.team_invites; v_subject text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: entre na sua conta.' USING ERRCODE='42501'; END IF;
 -- A permissão inclui vínculo ACTIVE e loja ACTIVE; não trava convites alheios.
 SELECT i.* INTO v_invite FROM public.team_invites i
 WHERE i.id=p_invite AND public.has_store_permission(i.tenant_id,'manage_team') FOR UPDATE;
 IF NOT FOUND OR v_invite.status<>'PENDING' OR v_invite.expires_at<=now() THEN
  RAISE EXCEPTION 'INVITE_UNAVAILABLE: convite indisponível.' USING ERRCODE='42501';
 END IF;
 IF v_invite.role_id IN('WAITER','KITCHEN') THEN
  -- Mesma ordem de locks do aceite: convite, depois ferramenta.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_invite.tenant_id::text||'|tool|'||CASE WHEN v_invite.role_id='WAITER' THEN 'waiter' ELSE 'kitchen' END,0));
  IF NOT public._store_tool_enabled(v_invite.tenant_id,CASE WHEN v_invite.role_id='WAITER' THEN 'waiter' ELSE 'kitchen' END) THEN
   RAISE EXCEPTION 'TOOL_DISABLED: ative a ferramenta antes de renovar o convite.' USING ERRCODE='42501';
  END IF;
 END IF;
 v_subject:=v_invite.tenant_id::text||':'||v_invite.id::text;
 IF NOT public._rate_limit_hit('team_invite_resend',v_subject,v_invite.tenant_id,3,600)
  OR NOT public._rate_limit_hit('team_invite_resend_cooldown',v_subject,v_invite.tenant_id,1,60) THEN
  RAISE EXCEPTION 'RATE_LIMITED: aguarde antes de renovar este convite novamente.' USING ERRCODE='P0429';
 END IF;
 UPDATE public.team_invites SET expires_at=now()+interval '7 days' WHERE id=v_invite.id RETURNING * INTO v_invite;
 PERFORM public.log_audit_event('TEAM_INVITE_RENEWED','team_invites','Convite renovado para compartilhar o acesso.',
  v_invite.id::text,NULL,jsonb_build_object('role',v_invite.role_id,'expiresAt',v_invite.expires_at)::text,v_invite.tenant_id);
 RETURN jsonb_build_object('id',v_invite.id,'status',v_invite.status,'expires_at',v_invite.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.resend_team_invite(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resend_team_invite(uuid) TO authenticated;

-- C2: a abertura é um evento observado a partir de agora, sem inferir histórico.
ALTER TABLE public.tenant_settings ADD COLUMN salon_opened_at timestamptz;
COMMENT ON COLUMN public.tenant_settings.salon_opened_at IS 'Última abertura observada pelo banco; NULL para histórico anterior à Entrega 1.1.';

CREATE FUNCTION public._salon_track_opening() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.salon_opened_at := CASE WHEN NEW.is_open THEN pg_catalog.now() ELSE NULL END;
 ELSIF NEW.is_open AND NOT OLD.is_open THEN
  NEW.salon_opened_at := pg_catalog.now();
 ELSE
  NEW.salon_opened_at := OLD.salon_opened_at;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._salon_track_opening() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER salon_track_opening BEFORE INSERT OR UPDATE ON public.tenant_settings
 FOR EACH ROW EXECUTE FUNCTION public._salon_track_opening();

CREATE FUNCTION public.salon_night_stats(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_end timestamptz:=pg_catalog.now();
 v_start timestamptz;
 v_opened timestamptz;
 v_source text:='LAST_12_HOURS';
 v_timezone constant text:='America/Sao_Paulo';
 v_orders bigint;
 v_tables bigint;
 v_revenue numeric;
 v_paid_visits bigint;
 v_stay numeric;
 v_calls bigint;
 v_response numeric;
 v_open_tabs bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public._tab_pix_staff(auth.uid(),p_tenant) THEN
  RAISE EXCEPTION 'FORBIDDEN: salão indisponível.' USING ERRCODE='42501';
 END IF;
 IF public._dine_in_config(p_tenant) IS NULL THEN
  RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.' USING ERRCODE='42501';
 END IF;
 SELECT s.salon_opened_at INTO v_opened FROM public.tenant_settings s WHERE s.tenant_id=p_tenant;
 IF v_opened IS NOT NULL AND v_opened<=v_end
  AND (v_opened AT TIME ZONE v_timezone)::date=(v_end AT TIME ZONE v_timezone)::date THEN
  v_start:=v_opened; v_source:='OPENED_TODAY';
 ELSE
  v_start:=v_end-interval '12 hours';
 END IF;

 SELECT count(*) INTO v_orders FROM public.orders o
 WHERE o.tenant_id=p_tenant AND o.fulfillment_type='DINE_IN' AND o.status<>'CANCELLED'
  AND o.created_at>=v_start AND o.created_at<=v_end;
 -- Uma visita encerrada é uma comanda; a mesma mesa física pode servir vários grupos.
 SELECT count(*),pg_catalog.round(avg(greatest(0,extract(epoch FROM (tb.closed_at-tb.opened_at)))))
 INTO v_tables,v_stay FROM public.dining_tabs tb
 WHERE tb.tenant_id=p_tenant AND tb.status='CLOSED' AND tb.closed_at>=v_start AND tb.closed_at<=v_end;
 -- tab_payments já é o livro de pagamentos confirmados. amount_cents é líquido do troco.
 SELECT coalesce(sum(p.amount_cents),0),count(DISTINCT p.tab_id)
 INTO v_revenue,v_paid_visits FROM public.tab_payments p
 JOIN public.dining_tabs tb ON tb.id=p.tab_id AND tb.tenant_id=p.tenant_id AND tb.status='CLOSED'
 WHERE p.tenant_id=p_tenant AND p.created_at>=v_start AND p.created_at<=v_end;
 SELECT count(*),pg_catalog.round(avg(greatest(0,extract(epoch FROM (coalesce(c.accepted_at,c.handled_at)-c.created_at)))))
 INTO v_calls,v_response FROM public.waiter_calls c
 WHERE c.tenant_id=p_tenant AND c.status='HANDLED' AND c.handled_at>=v_start AND c.handled_at<=v_end;
 SELECT count(*) INTO v_open_tabs FROM public.dining_tabs tb WHERE tb.tenant_id=p_tenant
  AND tb.status IN('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT');

 RETURN pg_catalog.jsonb_build_object(
  'window_start',v_start,'window_end',v_end,'window_source',v_source,'timezone',v_timezone,
  'orders_count',v_orders,'tables_served',v_tables,'revenue_cents',v_revenue,'paid_visits',v_paid_visits,
  'average_ticket_cents',CASE WHEN v_paid_visits>0 THEN pg_catalog.round(v_revenue/v_paid_visits) ELSE NULL END,
  'average_stay_seconds',v_stay,'calls_handled',v_calls,'average_response_seconds',v_response,'open_tabs',v_open_tabs
 );
END; $$;
REVOKE ALL ON FUNCTION public.salon_night_stats(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.salon_night_stats(uuid) TO authenticated;

COMMIT;

