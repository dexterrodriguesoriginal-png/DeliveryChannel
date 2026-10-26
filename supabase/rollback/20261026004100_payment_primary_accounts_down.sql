-- Restores the 040 functions. Existing primary choices are preserved.
BEGIN;
CREATE OR REPLACE FUNCTION public.configure_store_payment(p_user uuid, p_membership uuid, p_provider text, p_changes jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT tu.tenant_id INTO v_tenant FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
  WHERE tu.id=p_membership AND tu.user_id=p_user AND tu.status='ACTIVE' AND tu.role_id IN ('OWNER','MANAGER') AND t.status='ACTIVE';
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=v_tenant FOR UPDATE;
 IF (p_changes->>'is_primary')::boolean THEN
  UPDATE public.store_payment_accounts SET is_primary=false WHERE tenant_id=v_tenant;
 END IF;
 INSERT INTO public.store_payment_accounts(tenant_id,provider,status,account_label,is_primary,accepts_pix,accepts_card,connected_at)
  VALUES(v_tenant,p_provider,coalesce(p_changes->>'status','disconnected'),coalesce(p_changes->>'account_label',''),
   coalesce((p_changes->>'is_primary')::boolean,false),coalesce((p_changes->>'accepts_pix')::boolean,true),
   coalesce((p_changes->>'accepts_card')::boolean,false),CASE WHEN p_changes->>'status'='connected' THEN now() END)
 ON CONFLICT(tenant_id,provider) DO UPDATE SET
  status=coalesce(p_changes->>'status',store_payment_accounts.status),
  account_label=coalesce(p_changes->>'account_label',store_payment_accounts.account_label),
  is_primary=CASE WHEN p_changes->>'status'='disconnected' THEN false ELSE coalesce((p_changes->>'is_primary')::boolean,store_payment_accounts.is_primary) END,
  accepts_pix=coalesce((p_changes->>'accepts_pix')::boolean,store_payment_accounts.accepts_pix),
  accepts_card=coalesce((p_changes->>'accepts_card')::boolean,store_payment_accounts.accepts_card),
  connected_at=CASE WHEN p_changes->>'status'='connected' THEN now() ELSE store_payment_accounts.connected_at END;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_store_payment_connection(p_user uuid,p_membership uuid,p_provider text,p_ciphertext text,p_version bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT tu.tenant_id INTO v_tenant FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
 WHERE tu.id=p_membership AND tu.user_id=p_user AND tu.status='ACTIVE' AND tu.role_id IN ('OWNER','MANAGER') AND t.status='ACTIVE';
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Acesso negado.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=v_tenant FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.store_payment_accounts a WHERE a.tenant_id=v_tenant AND a.provider=p_provider AND a.connection_version=p_version)
  THEN RAISE EXCEPTION 'Conexão expirada; inicie novamente.'; END IF;
 IF p_provider<>'manual_pix' AND nullif(p_ciphertext,'') IS NULL THEN RAISE EXCEPTION 'Credenciais ausentes.'; END IF;
 UPDATE public.store_payment_accounts SET status='connected',connected_at=now(),accepts_pix=true,accepts_card=(p_provider<>'manual_pix'),
  account_label=CASE p_provider WHEN 'mercadopago' THEN 'Conta Mercado Pago' WHEN 'pagbank' THEN 'Conta PagBank' WHEN 'infinitepay' THEN 'Conta InfinitePay' ELSE 'Chave PIX (manual)' END
 WHERE tenant_id=v_tenant AND provider=p_provider;
 IF p_provider<>'manual_pix' THEN
  INSERT INTO private.store_payment_credentials(tenant_id,provider,ciphertext) VALUES(v_tenant,p_provider,p_ciphertext)
   ON CONFLICT(tenant_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,refresh_until=NULL;
 END IF;
END; $$;
COMMIT;
