-- Revert the application commit too to restore the Express route/environment template.
-- Keep messages and counters intact; remove only the v2 entry point and its secret.
BEGIN;
DROP FUNCTION IF EXISTS public.submit_store_feedback_v2(text,text,text,integer,text);
DROP TABLE IF EXISTS private.store_feedback_secret;
-- Leave private in place: it may predate this migration or contain unrelated objects.
CREATE FUNCTION public.submit_store_feedback(p_store_slug text, p_type text, p_message text,
  p_area text, p_rating integer, p_sender_hash text, p_ip_hash text, p_day date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_hash text; v_count integer; v_day date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.slug = p_store_slug AND t.status = 'ACTIVE';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Loja indisponível.' USING ERRCODE = '22023'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('sugestao','elogio','reclamacao')
    OR p_message IS NULL OR char_length(btrim(p_message)) NOT BETWEEN 10 AND 1000
    OR (p_area IS NOT NULL AND p_area NOT IN ('atendimento','produto','entrega','preco','app','outro'))
    OR (p_rating IS NOT NULL AND p_rating NOT BETWEEN 1 AND 5)
    OR p_sender_hash IS NULL OR p_sender_hash !~ '^[0-9a-f]{64}$'
    OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$'
    OR p_day IS DISTINCT FROM v_day
  THEN RAISE EXCEPTION 'Feedback inválido.' USING ERRCODE = '22023'; END IF;
  -- Deterministic order avoids deadlocks. Concurrent submissions serialize in the unique counter.
  FOR v_hash IN SELECT DISTINCT h FROM unnest(ARRAY[p_sender_hash, p_ip_hash]) h ORDER BY h LOOP
    INSERT INTO public.store_feedback_limits AS l (tenant_id, day, sender_hash, submissions)
    VALUES (v_tenant, v_day, v_hash, 1)
    ON CONFLICT (tenant_id, day, sender_hash) DO UPDATE SET submissions = l.submissions + 1
      WHERE l.submissions < 5 RETURNING submissions INTO v_count;
    IF v_count IS NULL THEN RAISE EXCEPTION 'Limite diário de 5 envios por loja atingido.' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  INSERT INTO public.store_feedback(tenant_id, type, area, rating, message, sender_hash)
    VALUES(v_tenant, p_type, p_area, p_rating, btrim(p_message), p_sender_hash);
  DELETE FROM public.store_feedback_limits WHERE day < v_day - 1;
END; $$;
REVOKE ALL ON FUNCTION public.submit_store_feedback(text,text,text,text,integer,text,text,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_store_feedback(text,text,text,text,integer,text,text,date) TO service_role;
COMMIT;
