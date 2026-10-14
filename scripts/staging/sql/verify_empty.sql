-- Verificação do ESTADO REAL antes de aplicar 001–020 no staging. Somente leitura.
-- Aborta (ERROR) se o projeto não parecer um Supabase novo e vazio.
DO $$
DECLARE n int; v text;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN RAISE EXCEPTION 'VERIFY: auth.users ausente — não parece um projeto Supabase.'; END IF;
  IF to_regclass('storage.buckets') IS NULL THEN RAISE EXCEPTION 'VERIFY: storage.buckets ausente — não parece um projeto Supabase.'; END IF;
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname = 'public';
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY: schema public já tem % tabela(s); staging não está vazio.', n; END IF;
  SELECT count(*) INTO n FROM pg_proc WHERE pronamespace = 'public'::regnamespace;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY: schema public já tem % função(ões).', n; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations' INTO n;
    IF n > 0 THEN RAISE EXCEPTION 'VERIFY: % migration(s) já registrada(s).', n; END IF;
  END IF;
  SELECT count(*) INTO n FROM auth.users;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY: auth.users tem % usuário(s); esperado projeto novo.', n; END IF;
  SELECT count(*) INTO n FROM storage.buckets;
  IF n > 0 THEN RAISE EXCEPTION 'VERIFY: já existem % bucket(s).', n; END IF;
  FOREACH v IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v) THEN RAISE EXCEPTION 'VERIFY: role % ausente.', v; END IF;
  END LOOP;
  RAISE NOTICE 'VERIFY OK: projeto Supabase vazio (public sem tabelas/funções, sem migrations, sem usuários, sem buckets).';
END $$;
