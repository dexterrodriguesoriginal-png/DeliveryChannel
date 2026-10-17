-- Rollback do 0750 — MERGE SEGURO (não substitui ACLs; só faz GRANT do que o snapshot tinha e hoje falta).
-- EFEITOS: reconcede a anon/authenticated os privilégios NÃO perigosos que o 0750 retirou
--   (ex.: escrita de authenticated em roles/app_events/audit_logs/tenant_email_confirmations; SELECT de anon e
--   arwd de authenticated em drivers/team_invites/tenant_users; SELECT de anon em sequences).
-- NUNCA reconcede (exclusão explícita): TRUNCATE, REFERENCES, TRIGGER, MAINTAIN; INSERT/UPDATE/DELETE de anon;
--   USAGE/UPDATE de anon em sequences; UPDATE (setval) em sequences; default privileges perigosos.
-- Grants adicionados depois do 0750 são preservados (não há REVOKE). Não toca em outros papéis.
-- Destrutivo: apaga public.priv_backup_0750 (só metadados de ACL). Ordem: reverter 0800 (no-op) antes.
-- RISCO residual: devolve a authenticated escrita direta em drivers/team_invites/tenant_users (protegida só por RLS).
BEGIN;
DO $rb$
DECLARE b record; x record; v_kw text; v_skip boolean; v_n int := 0; v_s int := 0;
BEGIN
  IF to_regclass('public.priv_backup_0750') IS NULL THEN RAISE EXCEPTION 'PRE: priv_backup_0750 ausente'; END IF;
  FOR b IN SELECT * FROM public.priv_backup_0750 WHERE kind='rel' AND acl IS NOT NULL AND to_regclass(obj) IS NOT NULL LOOP
    v_kw := CASE WHEN b.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END;
    FOR x IN SELECT a.privilege_type p, pg_get_userbyid(a.grantee) g FROM aclexplode(b.acl::aclitem[]) a
             WHERE a.grantee IN ('anon'::regrole,'authenticated'::regrole) LOOP
      v_skip := x.p IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
             OR (x.g='anon' AND x.p IN ('INSERT','UPDATE','DELETE','USAGE'))
             OR (v_kw='SEQUENCE' AND x.p='UPDATE');
      IF v_skip THEN v_s := v_s+1; CONTINUE; END IF;
      IF v_kw='SEQUENCE' AND NOT has_sequence_privilege(x.g, b.obj, x.p)
         OR v_kw='TABLE' AND NOT has_table_privilege(x.g, b.obj, x.p) THEN
        EXECUTE format('GRANT %s ON %s %s TO %I', x.p, v_kw, b.obj, x.g); v_n := v_n+1;
      END IF;
    END LOOP;
  END LOOP;
  -- POST: nenhum privilégio perigoso reapareceu
  IF EXISTS (SELECT 1 FROM pg_class c, unnest(array['anon','authenticated']) g(r), unnest(array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(v)
             WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND has_table_privilege(g.r, c.oid, p.v)) THEN
    RAISE EXCEPTION 'POST: privilégio perigoso presente após rollback';
  END IF;
  RAISE NOTICE '0750 down: % grants restaurados, % excluídos por segurança', v_n, v_s;
END $rb$;
DROP TABLE public.priv_backup_0750;
COMMIT;
