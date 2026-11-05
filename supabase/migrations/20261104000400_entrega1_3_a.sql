-- Entrega 1.3 / A: cada rodada chama o salão e exige liberação do balcão.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.waiter_mark_delivered(uuid)') IS NULL THEN RAISE EXCEPTION 'PRECHECK: Entrega 1.1 B ausente.'; END IF;
END $$;

CREATE TABLE public._entrega1_3_a_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega1_3_a_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_3_a_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega1_3_a_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid IN('public.waiter_mark_delivered(uuid)'::regprocedure,'public.update_order_status(uuid,text,text)'::regprocedure);

-- O vínculo é da rodada, nunca apenas da primeira chamada da mesa.
-- Herda o RLS, roteamento e permissões já restritos de waiter_calls.
ALTER TABLE public.waiter_calls ADD COLUMN order_id uuid;
ALTER TABLE public.waiter_calls ADD CONSTRAINT waiter_calls_order_tenant_fk
 FOREIGN KEY(tenant_id,order_id) REFERENCES public.orders(tenant_id,id) ON DELETE CASCADE;
CREATE UNIQUE INDEX waiter_calls_one_open_order ON public.waiter_calls(order_id) WHERE order_id IS NOT NULL AND status='OPEN';

CREATE FUNCTION public._salon_order_pickup_call() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.fulfillment_type<>'DINE_IN' OR NEW.tab_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW; END IF;
 IF NEW.status IN ('READY','OUT_FOR_DELIVERY') THEN
  INSERT INTO public.waiter_calls(tenant_id,tab_id,type,order_id)
  VALUES(NEW.tenant_id,NEW.tab_id,'CALL',NEW.id)
  ON CONFLICT(order_id) WHERE order_id IS NOT NULL AND status='OPEN' DO NOTHING;
 ELSIF NEW.status IN ('DELIVERED','CANCELLED','PREPARING') THEN
  UPDATE public.waiter_calls SET status=CASE WHEN NEW.status='DELIVERED' THEN 'HANDLED' ELSE 'CANCELLED' END,
   handled_by=auth.uid(),handled_at=now()
  WHERE tenant_id=NEW.tenant_id AND tab_id=NEW.tab_id AND order_id=NEW.id AND status='OPEN';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._salon_order_pickup_call() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER salon_order_pickup_call AFTER INSERT OR UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._salon_order_pickup_call();

DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.waiter_mark_delivered(uuid)'::regprocedure);
 v_new:=replace(v_def,$old$IF v_order.status NOT IN ('READY','OUT_FOR_DELIVERY') THEN RAISE EXCEPTION 'INVALID_STATE: o pedido ainda não está pronto para entrega.'; END IF;$old$,
 $new$IF v_order.status<>'OUT_FOR_DELIVERY' THEN RAISE EXCEPTION 'INVALID_STATE: Aguardando balcão. O pedido precisa ser servido antes da entrega.'; END IF;$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: waiter_mark_delivered/served'; END IF;
 EXECUTE v_new;
 -- A RPC geral não pode contornar a mesma regra nem deixar o garçom liberar
 -- seu próprio pedido sem o balcão. Preserva as demais permissões existentes.
 v_def:=pg_catalog.pg_get_functiondef('public.update_order_status(uuid,text,text)'::regprocedure);
 v_new:=replace(v_def,$old$IF v_order.status = 'CANCELLED' THEN$old$,$new$IF v_order.fulfillment_type='DINE_IN' AND v_new='DELIVERED' AND v_order.status<>'OUT_FOR_DELIVERY' THEN
        RAISE EXCEPTION 'INVALID_STATE: Aguardando balcão. O pedido precisa ser servido antes da entrega.';
    END IF;
    IF v_order.fulfillment_type='DINE_IN' AND v_new='OUT_FOR_DELIVERY' AND v_role='WAITER' THEN
        RAISE EXCEPTION 'TRANSITION_FORBIDDEN: somente o balcão pode servir o pedido.' USING ERRCODE='42501';
    END IF;
    IF v_order.fulfillment_type='DINE_IN' AND v_new='OUT_FOR_DELIVERY' AND v_order.status<>'READY' THEN
        RAISE EXCEPTION 'INVALID_STATE: somente um pedido pronto pode ser servido pelo balcão.';
    END IF;
    IF v_order.status = 'CANCELLED' THEN$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: update_order_status/served'; END IF;
 EXECUTE v_new;
END $$;
COMMIT;

