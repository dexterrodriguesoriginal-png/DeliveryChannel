-- staging_0900_tests.sql — 9 cenários de isolamento/permissão das RPCs da 0900.
-- SOMENTE LEITURA: begin read only … rollback. Saída em NOTICEs "Sn|descrição|OK|FALHA|N/A (…)".
-- Usuários: seeds sintéticas stg.<papel>.<loja>@example.com (owner.a, owner.b, manager.a, cashier.a, operator.a, driver.a).
-- Não mostra e-mails nem dados pessoais; só contagens e códigos de erro.
\set ON_ERROR_STOP 1
begin read only;
DO $t$
DECLARE
  u record; v_ta uuid; v_tb uuid; v_n bigint; v_exp bigint; v_err text; v_cols text; r text;
  uid_owner_a uuid; uid_owner_b uuid; v_inact uuid; v_inact_t uuid;
BEGIN
  SELECT au.id INTO uid_owner_a FROM auth.users au WHERE lower(au.email)='stg.owner.a@example.com';
  SELECT au.id INTO uid_owner_b FROM auth.users au WHERE lower(au.email)='stg.owner.b@example.com';
  SELECT tenant_id INTO v_ta FROM public.tenant_users WHERE user_id=uid_owner_a AND role_id='OWNER' AND status='ACTIVE' LIMIT 1;
  SELECT tenant_id INTO v_tb FROM public.tenant_users WHERE user_id=uid_owner_b AND role_id='OWNER' AND status='ACTIVE' LIMIT 1;
  IF v_ta IS NULL OR v_tb IS NULL OR v_ta = v_tb THEN RAISE EXCEPTION 'seeds owner.a/owner.b ausentes ou na mesma loja'; END IF;
  SELECT count(*) INTO v_exp FROM public.team_invites WHERE tenant_id=v_ta AND status='PENDING' AND expires_at > now();

  -- helper inline: executa como authenticated com o uid dado
  -- S1 OWNER A na loja A
  PERFORM set_config('request.jwt.claim.sub', uid_owner_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid_owner_a,'role','authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  SELECT count(*) INTO v_n FROM public.list_team_invites(v_ta);
  RAISE NOTICE 'S1|OWNER A lista convites da loja A (=% esperado)|%', v_exp, CASE WHEN v_n=v_exp THEN 'OK ('||v_n||')' ELSE 'FALHA ('||v_n||')' END;
  SELECT count(*) INTO v_n FROM public.list_team_invites(v_ta) x WHERE x.tenant_id <> v_ta OR x.status <> 'PENDING' OR x.expires_at <= now();
  RAISE NOTICE 'S1b|só linhas da loja A, PENDING e válidas|%', CASE WHEN v_n=0 THEN 'OK' ELSE 'FALHA ('||v_n||')' END;
  -- S2 OWNER A na loja B; OWNER B na loja A
  BEGIN PERFORM public.list_team_invites(v_tb); v_err := 'sem erro'; EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  RAISE NOTICE 'S2a|OWNER A na loja B negado|%', CASE WHEN v_err='42501' THEN 'OK' ELSE 'FALHA ('||v_err||')' END;
  EXECUTE 'reset role';
  PERFORM set_config('request.jwt.claim.sub', uid_owner_b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid_owner_b,'role','authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  BEGIN PERFORM public.list_team_invites(v_ta); v_err := 'sem erro'; EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  RAISE NOTICE 'S2b|OWNER B na loja A negado|%', CASE WHEN v_err='42501' THEN 'OK' ELSE 'FALHA ('||v_err||')' END;
  EXECUTE 'reset role';
  -- S3 papéis não-OWNER da loja A
  FOR u IN SELECT k, (SELECT au.id FROM auth.users au WHERE lower(au.email)='stg.'||k||'@example.com') AS id
           FROM unnest(array['manager.a','cashier.a','operator.a','driver.a']) k LOOP
    IF u.id IS NULL THEN RAISE NOTICE 'S3|% negado|N/A (seed ausente)', u.k; CONTINUE; END IF;
    PERFORM set_config('request.jwt.claim.sub', u.id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub',u.id,'role','authenticated')::text, true);
    EXECUTE 'set local role authenticated';
    BEGIN PERFORM public.list_team_invites(v_ta); v_err := 'sem erro'; EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
    EXECUTE 'reset role';
    RAISE NOTICE 'S3|% na loja A negado|%', u.k, CASE WHEN v_err='42501' THEN 'OK' ELSE 'FALHA ('||v_err||')' END;
  END LOOP;
  -- S4 OWNER com vínculo não ACTIVE ou loja não ACTIVE
  SELECT tu.user_id, tu.tenant_id INTO v_inact, v_inact_t FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
   WHERE tu.role_id='OWNER' AND (tu.status<>'ACTIVE' OR t.status<>'ACTIVE')
     AND NOT EXISTS (SELECT 1 FROM public.tenant_users x WHERE x.user_id=tu.user_id AND x.role_id IN ('CEO','SUPER_ADMIN') AND x.status='ACTIVE') LIMIT 1;
  IF v_inact IS NULL THEN RAISE NOTICE 'S4|OWNER inativo/loja inativa negado|N/A (sem dados)';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_inact::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_inact,'role','authenticated')::text, true);
    EXECUTE 'set local role authenticated';
    BEGIN PERFORM public.list_team_invites(v_inact_t); v_err := 'sem erro'; EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
    EXECUTE 'reset role';
    RAISE NOTICE 'S4|OWNER inativo/loja inativa negado|%', CASE WHEN v_err='42501' THEN 'OK' ELSE 'FALHA ('||v_err||')' END;
  END IF;
  -- S5 anon: sem EXECUTE nas duas; tabela fechada
  RAISE NOTICE 'S5|anon sem EXECUTE e team_invites sem SELECT|%', CASE WHEN NOT has_function_privilege('anon','public.list_team_invites(uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.list_my_team_invites()','EXECUTE')
    AND NOT has_table_privilege('anon','public.team_invites','SELECT') AND NOT has_table_privilege('authenticated','public.team_invites','SELECT') THEN 'OK' ELSE 'FALHA' END;
  -- S6 parâmetros inválidos
  PERFORM set_config('request.jwt.claim.sub', uid_owner_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',uid_owner_a,'role','authenticated')::text, true);
  EXECUTE 'set local role authenticated';
  BEGIN PERFORM public.list_team_invites(NULL); v_err := 'sem erro'; EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  RAISE NOTICE 'S6a|p_tenant_id nulo → 22023|%', CASE WHEN v_err='22023' THEN 'OK' ELSE 'FALHA ('||v_err||')' END;
  BEGIN PERFORM public.list_team_invites('00000000-0000-0000-0000-00000000dead'); v_err := 'sem erro'; EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  RAISE NOTICE 'S6b|loja inexistente → 42501|%', CASE WHEN v_err='42501' THEN 'OK' ELSE 'FALHA ('||v_err||')' END;
  -- S7 list_my_team_invites: só convites do próprio e-mail
  EXECUTE 'reset role';
  FOR u IN SELECT k, au.id, lower(au.email) AS em FROM unnest(array['owner.a','owner.b','manager.a','cashier.a','operator.a','driver.a']) k
           JOIN auth.users au ON lower(au.email)='stg.'||k||'@example.com' LOOP
    SELECT count(*) INTO v_exp FROM public.team_invites WHERE lower(email)=u.em AND status='PENDING' AND expires_at>now();
    PERFORM set_config('request.jwt.claim.sub', u.id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub',u.id,'role','authenticated')::text, true);
    EXECUTE 'set local role authenticated';
    SELECT count(*) INTO v_n FROM public.list_my_team_invites();
    EXECUTE 'reset role';
    RAISE NOTICE 'S7|% list_my_team_invites = próprios (%)|%', u.k, v_exp, CASE WHEN v_n=v_exp THEN 'OK ('||v_n||')' ELSE 'FALHA ('||v_n||')' END;
  END LOOP;
  -- S8 colunas retornadas
  SELECT string_agg(a, ',' ORDER BY n) INTO v_cols FROM (SELECT unnest(proargnames) a, generate_subscripts(proargnames,1) n, unnest(proargmodes) m
    FROM pg_proc WHERE oid='public.list_team_invites(uuid)'::regprocedure) s WHERE m='t';
  RAISE NOTICE 'S8a|colunas list_team_invites|%', CASE WHEN v_cols='id,tenant_id,email,role_id,invited_by,invited_by_name,status,expires_at,created_at' THEN 'OK' ELSE 'FALHA ('||v_cols||')' END;
  SELECT string_agg(a, ',' ORDER BY n) INTO v_cols FROM (SELECT unnest(proargnames) a, generate_subscripts(proargnames,1) n, unnest(proargmodes) m
    FROM pg_proc WHERE oid='public.list_my_team_invites()'::regprocedure) s WHERE m='t';
  RAISE NOTICE 'S8b|colunas list_my_team_invites (sem e-mail)|%', CASE WHEN v_cols='id,tenant_id,tenant_name,role_id,invited_by_name,status,expires_at,created_at' THEN 'OK' ELSE 'FALHA ('||v_cols||')' END;
  -- S9 segurança das funções
  RAISE NOTICE 'S9|STABLE, SECURITY DEFINER, search_path vazio, sem PUBLIC|%', CASE WHEN (SELECT bool_and(provolatile='s' AND prosecdef AND 'search_path=""' = ANY(proconfig)
      AND NOT EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0)) FROM pg_proc WHERE oid IN ('public.list_team_invites(uuid)'::regprocedure,'public.list_my_team_invites()'::regprocedure)) THEN 'OK' ELSE 'FALHA' END;
END
$t$;
select 'RO|'||current_setting('transaction_read_only');
rollback;
