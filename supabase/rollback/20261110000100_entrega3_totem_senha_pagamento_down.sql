-- Desfaz apenas os objetos da Entrega 3; não remove dados comerciais.
BEGIN;
DROP TRIGGER IF EXISTS trg_totem_arrival_payment_approved ON public.orders;
DROP TRIGGER IF EXISTS zz_totem_payment_transition_guard ON public.orders;
DROP FUNCTION IF EXISTS public._totem_payment_transition_guard();
DROP FUNCTION IF EXISTS public.confirm_manual_totem_payment(uuid,text);
DROP FUNCTION IF EXISTS public.get_totem_payment_status(text,uuid);
DROP FUNCTION IF EXISTS public.cancel_totem_payment(text,uuid);
DROP FUNCTION IF EXISTS public.get_totem_payment_settings(uuid);
DROP FUNCTION IF EXISTS public.set_totem_payment_settings(uuid,text,integer,boolean,boolean);
DROP FUNCTION IF EXISTS public._totem_approve_payment(uuid,uuid);
DROP FUNCTION IF EXISTS public._totem_payment_response(uuid,uuid,uuid);
-- Restaura o contrato da sincronização anterior da retirada.
CREATE OR REPLACE FUNCTION public._orders_pickup_arrival_sync() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NEW.fulfillment_type = 'PICKUP' AND NEW.status NOT IN ('DELIVERED','CANCELLED') THEN
   INSERT INTO public.pickup_arrivals (order_id, tenant_id, pickup_code)
   VALUES (NEW.id, NEW.tenant_id, public._new_pickup_code(NEW.tenant_id))
   ON CONFLICT (order_id) DO NOTHING;
  END IF;
 ELSIF NEW.status IN ('DELIVERED','CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE public.pickup_arrivals SET closed_at=COALESCE(closed_at,now()) WHERE order_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._orders_pickup_arrival_sync() FROM PUBLIC,anon,authenticated,service_role;
-- Não apagamos tentativas/configurações existentes: rollback não destrutivo.
-- A remoção física das tabelas só pode acontecer após política de retenção e conferência de dados.
-- A restauração do create_totem_order original depende da migration 20261109000300,
-- e deve ser feita antes de tornar esta reversão operacional.
NOTIFY pgrst,'reload schema';
COMMIT;
