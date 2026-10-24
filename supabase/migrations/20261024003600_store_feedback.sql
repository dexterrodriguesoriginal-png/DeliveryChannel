-- Prepared only. Do not apply automatically.
BEGIN;
CREATE TABLE public.store_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('sugestao','elogio','reclamacao')),
  area text CHECK (area IN ('atendimento','produto','entrega','preco','app','outro')),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 1000),
  -- Anonymity: only the UTC day is stored, so feedback cannot be joined to orders/logs by time.
  created_at timestamptz NOT NULL DEFAULT (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    CHECK (created_at = date_trunc('day', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
  sender_hash text NOT NULL CHECK (sender_hash ~ '^[0-9a-f]{64}$'),
  is_read boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false
);
CREATE INDEX store_feedback_store_day ON public.store_feedback(tenant_id, created_at);
-- Separate counters never expose or link an IP to message content. Hashes rotate daily.
CREATE TABLE public.store_feedback_limits (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  sender_hash text NOT NULL,
  submissions integer NOT NULL CHECK (submissions BETWEEN 1 AND 5),
  PRIMARY KEY (tenant_id, day, sender_hash)
);
CREATE INDEX store_feedback_limits_day ON public.store_feedback_limits(day);
ALTER TABLE public.store_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_feedback_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_feedback, public.store_feedback_limits FROM PUBLIC, anon, authenticated;

-- Public slug is a destination, never an authorization scope. No client tenant UUID is accepted.
-- Only the server can supply keyed identity/IP hashes; browsers cannot call this RPC.
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

-- Store scope derives from active memberships of auth.uid(), optionally selected by public slug.
CREATE FUNCTION public._feedback_my_store(p_store_slug text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid;
BEGIN
 SELECT tu.tenant_id INTO v_tenant FROM public.tenant_users tu
 JOIN public.tenants t ON t.id = tu.tenant_id
 WHERE tu.user_id = auth.uid() AND tu.status = 'ACTIVE' AND tu.role_id IN ('OWNER','MANAGER')
   AND t.slug = p_store_slug;
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Acesso restrito ao dono e gerente da loja.' USING ERRCODE = '42501'; END IF;
 RETURN v_tenant;
END; $$;
REVOKE ALL ON FUNCTION public._feedback_my_store(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.list_store_feedback(p_store_slug text, p_type text DEFAULT NULL,
 p_area text DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
 p_state text DEFAULT 'all', p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid := public._feedback_my_store(p_store_slug); v_result jsonb;
BEGIN
 IF p_offset IS NULL OR p_offset < 0 OR p_state IS NULL OR p_state NOT IN ('all','active','unread','archived')
 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to)
 THEN RAISE EXCEPTION 'Filtros inválidos.' USING ERRCODE = '22023'; END IF;
 WITH filtered AS (
   SELECT f.id, f.type, f.area, f.rating, f.message,
     (f.created_at AT TIME ZONE 'UTC')::date AS day, f.is_read, f.archived
   FROM public.store_feedback f WHERE f.tenant_id = v_tenant
   AND (p_type IS NULL OR f.type = p_type) AND (p_area IS NULL OR f.area = p_area)
   AND (p_from IS NULL OR f.created_at >= p_from::timestamp AT TIME ZONE 'UTC')
   AND (p_to IS NULL OR f.created_at < (p_to + 1)::timestamp AT TIME ZONE 'UTC')
   AND (p_state = 'all' OR (p_state = 'active' AND NOT f.archived)
     OR (p_state = 'unread' AND NOT f.is_read AND NOT f.archived) OR (p_state = 'archived' AND f.archived))
 ), weekly AS (
   SELECT date_trunc('week', f.day::timestamp)::date AS week, count(*) AS total, avg(f.rating) AS average
   FROM filtered f GROUP BY 1
 )
 SELECT jsonb_build_object(
   -- No ordering within the day: precise submission times must not be inferable.
   'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY page.day DESC, page.id)
     FROM (SELECT * FROM filtered ORDER BY day DESC, id LIMIT 50 OFFSET p_offset) page), '[]'::jsonb),
   'stats', jsonb_build_object('total', (SELECT count(*) FROM filtered),
     'unread', (SELECT count(*) FROM filtered WHERE NOT is_read), 'average', (SELECT avg(rating) FROM filtered),
     'types', jsonb_build_object('sugestao',(SELECT count(*) FROM filtered WHERE type='sugestao'),
       'elogio',(SELECT count(*) FROM filtered WHERE type='elogio'), 'reclamacao',(SELECT count(*) FROM filtered WHERE type='reclamacao')),
     'weeks', COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.week) FROM weekly w),'[]'::jsonb))) INTO v_result;
 RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.list_store_feedback(text,text,text,date,date,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_store_feedback(text,text,text,date,date,text,integer) TO authenticated;

CREATE FUNCTION public.set_store_feedback_state(p_store_slug text, p_id uuid, p_read boolean, p_archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tenant uuid := public._feedback_my_store(p_store_slug);
BEGIN
 UPDATE public.store_feedback SET is_read = p_read, archived = p_archived WHERE id = p_id AND tenant_id = v_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Feedback indisponível.' USING ERRCODE = '42501'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_store_feedback_state(text,uuid,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_feedback_state(text,uuid,boolean,boolean) TO authenticated;

CREATE FUNCTION public.ceo_store_feedback_counts() RETURNS TABLE(store_id uuid, store_name text, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.user_id = auth.uid()
 AND tu.status = 'ACTIVE' AND tu.role_id IN ('CEO','SUPER_ADMIN')) THEN
 RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE = '42501'; END IF;
 RETURN QUERY SELECT t.id, t.name::text, count(f.id) FROM public.tenants t
 LEFT JOIN public.store_feedback f ON f.tenant_id = t.id GROUP BY t.id, t.name ORDER BY t.name;
END; $$;
REVOKE ALL ON FUNCTION public.ceo_store_feedback_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ceo_store_feedback_counts() TO authenticated;
COMMIT;
