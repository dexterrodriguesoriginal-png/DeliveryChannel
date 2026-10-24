-- Prepared only. Do not apply automatically. Acceptance is append-only and time-stamped by the server.
BEGIN;
CREATE TABLE public.legal_acceptances (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 audience text NOT NULL CHECK (audience IN ('owner','customer')),
 version text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id, audience, version)
);
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_acceptances FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public._legal_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT '2026-10-24.1'::text $$;
REVOKE ALL ON FUNCTION public._legal_version() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_my_legal_status(p_audience text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_audience IS NULL OR p_audience NOT IN ('owner','customer') THEN
 RAISE EXCEPTION 'Acesso inválido.' USING ERRCODE = '42501'; END IF;
 RETURN jsonb_build_object('version', public._legal_version(), 'accepted', EXISTS(
 SELECT 1 FROM public.legal_acceptances a WHERE a.user_id = auth.uid()
 AND a.audience = p_audience AND a.version = public._legal_version()));
END; $$;
REVOKE ALL ON FUNCTION public.get_my_legal_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_legal_status(text) TO authenticated;
CREATE FUNCTION public.accept_current_legal(p_audience text, p_version text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501'; END IF;
 IF p_audience IS NULL OR p_audience NOT IN ('owner','customer') OR p_version IS DISTINCT FROM public._legal_version()
 THEN RAISE EXCEPTION 'Versão dos termos desatualizada.' USING ERRCODE = '22023'; END IF;
 INSERT INTO public.legal_acceptances(user_id, audience, version) VALUES(auth.uid(), p_audience, public._legal_version()) ON CONFLICT DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.accept_current_legal(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_current_legal(text,text) TO authenticated;

CREATE FUNCTION public._require_current_legal(p_audience text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.legal_acceptances a
 WHERE a.user_id = auth.uid() AND a.audience = p_audience AND a.version = public._legal_version())
 THEN RAISE EXCEPTION 'Aceite os termos e a política de privacidade atuais para continuar.' USING ERRCODE = '42501'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public._require_current_legal(text) FROM PUBLIC, anon, authenticated;

-- Password signup requires an explicit checkbox, including before email confirmation.
-- OAuth identities complete acceptance after the provider callback, before business registration.
CREATE FUNCTION public._legal_signup_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.raw_app_meta_data->>'provider' = 'email' THEN
   IF NEW.raw_user_meta_data->>'legal_accepted' IS DISTINCT FROM 'true'
    OR NEW.raw_user_meta_data->>'legal_version' IS DISTINCT FROM public._legal_version()
    OR COALESCE(NEW.raw_user_meta_data->>'legal_audience','') NOT IN ('owner','customer')
   THEN RAISE EXCEPTION 'Aceite obrigatório dos termos atuais.' USING ERRCODE = '22023'; END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._legal_signup_check() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER legal_signup_check BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public._legal_signup_check();
CREATE FUNCTION public._legal_signup_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.raw_app_meta_data->>'provider' = 'email' THEN
 INSERT INTO public.legal_acceptances(user_id,audience,version)
 VALUES(NEW.id,NEW.raw_user_meta_data->>'legal_audience',public._legal_version()) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._legal_signup_record() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER legal_signup_record AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public._legal_signup_record();

CREATE FUNCTION public._legal_business_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NOT NULL THEN
   IF TG_TABLE_NAME = 'tenants' THEN
     PERFORM public._require_current_legal('owner');
   ELSIF TG_TABLE_NAME = 'customers' THEN
     IF NEW.user_id = auth.uid() THEN PERFORM public._require_current_legal('customer'); END IF;
   ELSIF TG_TABLE_NAME = 'orders' THEN
     IF EXISTS(SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id AND c.user_id = auth.uid())
     THEN PERFORM public._require_current_legal('customer'); END IF;
   END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._legal_business_gate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER legal_tenant_registration BEFORE INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._legal_business_gate();
CREATE TRIGGER legal_customer_registration BEFORE INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public._legal_business_gate();
CREATE TRIGGER legal_customer_checkout BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public._legal_business_gate();

CREATE FUNCTION public.export_my_customer_data() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Faça login para baixar seus dados.' USING ERRCODE = '42501'; END IF;
 RETURN jsonb_build_object(
 'exported_at', now(), 'profile', (SELECT jsonb_build_object('name',u.name,'email',u.email,'phone',u.phone) FROM public.users u WHERE u.id=v_uid),
 'customers', COALESCE((SELECT jsonb_agg(jsonb_build_object('store_id',c.tenant_id,'name',c.name,'phone',c.phone,'email',c.email,'cpf',c.cpf,'created_at',c.created_at)) FROM public.customers c WHERE c.user_id=v_uid),'[]'::jsonb),
 'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'store_id',o.tenant_id,'number',o.order_number,'name',o.customer_name,'phone',o.customer_phone,'email',o.customer_email,'delivery_address',o.delivery_address,'address_details',o.address_details,'subtotal',o.subtotal,'delivery_fee',o.delivery_fee,'discount',o.discount,
 'total',o.total_amount,'payment_method',o.payment_method,'payment_status',o.payment_status,
 'fulfillment_type',o.fulfillment_type,'notes',o.notes,'status',o.status,'created_at',o.created_at,
 'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('product',i.product_name,'quantity',i.quantity,'unit_price',i.unit_price,'total',i.total_price)) FROM public.order_items i WHERE i.order_id=o.id),'[]'::jsonb))) FROM public.orders o JOIN public.customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id WHERE c.user_id=v_uid),'[]'::jsonb),
 'legal_acceptances', COALESCE((SELECT jsonb_agg(jsonb_build_object('audience',a.audience,'version',a.version,'accepted_at',a.accepted_at)) FROM public.legal_acceptances a WHERE a.user_id=v_uid),'[]'::jsonb),
 'marketing_consents', COALESCE((SELECT jsonb_agg(jsonb_build_object('store_id',cp.tenant_id,'accepted',cp.contact_consent,'recorded_at',cp.contact_consent_at)) FROM public.customer_crm_profiles cp JOIN public.customers c ON c.id=cp.customer_id AND c.tenant_id=cp.tenant_id WHERE c.user_id=v_uid),'[]'::jsonb),
 'consents', COALESCE((SELECT jsonb_agg(jsonb_build_object('type',cc.consent_type,'accepted',cc.accepted,'accepted_at',cc.accepted_at)) FROM public.customer_consents cc JOIN public.customers c ON c.id=cc.customer_id WHERE c.user_id=v_uid),'[]'::jsonb),
 'deletion_requests',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',r.status,'requested_at',r.requested_at,'processed_at',r.processed_at,'reason',r.reason)) FROM public.customer_account_deletion_requests r WHERE r.user_id=v_uid),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.export_my_customer_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_customer_data() TO authenticated;
COMMIT;
