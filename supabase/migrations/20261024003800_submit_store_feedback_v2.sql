-- Proposal only: do not apply automatically to any database.
BEGIN;

-- N1 requires pgcrypto in extensions. Fail closed instead of moving the extension.
DO $$ BEGIN
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
    OR to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'Feedback v2 requer pgcrypto no schema extensions.';
  END IF;
END; $$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE private.store_feedback_secret (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  secret bytea NOT NULL CHECK (octet_length(secret) = 32)
);
ALTER TABLE private.store_feedback_secret ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.store_feedback_secret FROM PUBLIC, anon, authenticated, service_role;
-- Generated only inside PostgreSQL; never embedded, returned, or written to application logs.
INSERT INTO private.store_feedback_secret(singleton, secret)
  VALUES (true, extensions.gen_random_bytes(32));

-- Remove the old entry point that accepted caller-generated hashes/day.
DROP FUNCTION public.submit_store_feedback(text,text,text,text,integer,text,text,date);

CREATE FUNCTION public.submit_store_feedback_v2(
  p_tenant_slug_or_id text, p_type text, p_area text, p_rating integer, p_message text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid;
  v_destination_id uuid;
  v_day date := (statement_timestamp() AT TIME ZONE 'UTC')::date;
  v_identity text;
  v_secret bytea;
  v_hash text;
  v_count integer;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('sugestao','elogio','reclamacao')
    OR p_message IS NULL OR char_length(btrim(p_message)) NOT BETWEEN 10 AND 1000
    OR (p_area IS NOT NULL AND p_area NOT IN ('atendimento','produto','entrega','preco','app','outro'))
    OR (p_rating IS NOT NULL AND p_rating NOT BETWEEN 1 AND 5)
    OR p_tenant_slug_or_id IS NULL OR char_length(p_tenant_slug_or_id) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'Feedback inválido.' USING ERRCODE = '22023'; END IF;

  IF p_tenant_slug_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_destination_id := p_tenant_slug_or_id::uuid;
  END IF;
  -- Same public-store rule as get_public_store: ACTIVE and addressable by slug.
  -- UUID is only a destination selector, never an authorization or trusted tenant scope.
  SELECT t.id INTO v_tenant FROM public.tenants t
    WHERE t.status = 'ACTIVE' AND nullif(btrim(t.slug), '') IS NOT NULL
      AND ((v_destination_id IS NOT NULL AND t.id = v_destination_id)
        OR (v_destination_id IS NULL AND t.slug = p_tenant_slug_or_id));
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Loja indisponível.' USING ERRCODE = '22023';
  END IF;

  v_identity := auth.uid()::text;
  IF v_identity IS NULL THEN
    -- request.headers is populated by PostgREST; the Supabase ingress must sanitize XFF.
    -- Use the first address, not the varying proxy chain. Never persist this value.
    BEGIN
      v_identity := nullif(btrim(split_part(
        nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ',', 1)), '');
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Origem indisponível.' USING ERRCODE = '22023';
    END;
  END IF;
  IF v_identity IS NULL THEN
    RAISE EXCEPTION 'Origem indisponível.' USING ERRCODE = '22023';
  END IF;
  SELECT s.secret INTO STRICT v_secret FROM private.store_feedback_secret s WHERE s.singleton;
  -- pgcrypto hmac takes (data, key, algorithm). Canonical tenant UUID prevents slug/ID bypass.
  v_hash := encode(extensions.hmac(
    convert_to(v_identity || v_tenant::text || to_char(v_day, 'YYYY-MM-DD'), 'UTF8'),
    v_secret, 'sha256'), 'hex');

  -- The unique key serializes parallel submissions. A sixth call raises and rolls back.
  INSERT INTO public.store_feedback_limits AS l (tenant_id, day, sender_hash, submissions)
    VALUES (v_tenant, v_day, v_hash, 1)
    ON CONFLICT (tenant_id, day, sender_hash) DO UPDATE SET submissions = l.submissions + 1
      WHERE l.submissions < 5 RETURNING submissions INTO v_count;
  IF v_count IS NULL THEN
    RAISE EXCEPTION 'Limite diário de 5 envios por loja atingido.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.store_feedback(tenant_id, type, area, rating, message, sender_hash, created_at)
    VALUES (v_tenant, p_type, p_area, p_rating, btrim(p_message), v_hash,
      v_day::timestamp AT TIME ZONE 'UTC');
  DELETE FROM public.store_feedback_limits WHERE day < v_day - 1;
END; $$;
REVOKE ALL ON FUNCTION public.submit_store_feedback_v2(text,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_store_feedback_v2(text,text,text,integer,text) TO anon, authenticated;
COMMIT;
