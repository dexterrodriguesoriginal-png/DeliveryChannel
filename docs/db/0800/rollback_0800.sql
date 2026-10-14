-- rollback_0800.sql — restaura EXATAMENTE o estado auditado em 14/10 (pós-0700, pré-0800).
-- NÃO regranta TRUNCATE em drivers (revogado pela 0700). Requer PG17+. Idempotente.
-- Uso somente com autorização explícita do David, ambiente a ambiente.
BEGIN;
GRANT REFERENCES, TRIGGER, MAINTAIN ON TABLE public.drivers TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.team_invites TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.tenant_users TO anon, authenticated;

DO $chk$
DECLARE t text; r text; p text; v_expected boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.drivers','public.team_invites','public.tenant_users'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        v_expected := CASE
          WHEN p IN ('REFERENCES','TRIGGER','MAINTAIN') THEN true
          WHEN p = 'TRUNCATE' THEN t <> 'public.drivers'
          WHEN p = 'SELECT' THEN (t = 'public.tenant_users' AND r = 'authenticated')
          ELSE false END;
        IF has_table_privilege(r, t, p) IS DISTINCT FROM v_expected THEN
          RAISE EXCEPTION 'ROLLBACK CHECK: % em % para % diferente do auditado (%)', p, t, r, v_expected;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'rollback_0800 OK: estado de 14/10 restaurado';
END
$chk$;
COMMIT;
