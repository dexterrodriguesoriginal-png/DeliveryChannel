-- staging_0800_tests.sql — R1–R6 pós-0800. SOMENTE LEITURA: begin read only … rollback.
-- Saída: linhas "Rn|descrição|OK|FALHA". Nenhuma escrita; nenhum dado pessoal é exibido (só contagens).
-- Usuários escolhidos dinamicamente (primeiro OWNER ACTIVE e um vínculo ACTIVE qualquer).
\set ON_ERROR_STOP 1
begin read only;

-- R0: matriz de privilégios (esperado: tudo n, exceto tenant_users/authenticated SELECT=S)
select 'R0|matriz '||t.n||'/'||r.x||'|'||
  case when bool_and(has_table_privilege(r.x,t.n,p.y) = (t.n='public.tenant_users' and r.x='authenticated' and p.y='SELECT'))
       then 'OK' else 'FALHA '||string_agg(p.y||'='||has_table_privilege(r.x,t.n,p.y),',') end
from (values ('public.drivers'),('public.team_invites'),('public.tenant_users')) t(n),
     (values ('anon'),('authenticated')) r(x),
     (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(y)
group by t.n, r.x order by 1;

-- R1: authenticated lê os próprios vínculos (AuthContext.tsx:392/408)
select 'ctx' from (select set_config('t.r1', (select user_id::text from public.tenant_users where status='ACTIVE' order by created_at, id limit 1), true)) s;
select 'ctx' from (select set_config('request.jwt.claim.sub', current_setting('t.r1'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub',current_setting('t.r1'),'role','authenticated')::text, true)) s;
set local role authenticated;
select 'R1|authenticated lê próprios vínculos|'||case when count(*)>0 then 'OK ('||count(*)||')' else 'FALHA (0)' end
from public.tenant_users where user_id = auth.uid();
reset role;

-- R2: OWNER lê a equipe da loja com join em users (teamRepository.ts:57)
select 'ctx' from (select set_config('t.r2', (select user_id::text||'|'||tenant_id::text from public.tenant_users where role_id='OWNER' and status='ACTIVE' order by created_at, id limit 1), true)) s;
select 'ctx' from (select set_config('request.jwt.claim.sub', split_part(current_setting('t.r2'),'|',1), true),
       set_config('request.jwt.claims', json_build_object('sub',split_part(current_setting('t.r2'),'|',1),'role','authenticated')::text, true)) s;
set local role authenticated;
select 'R2|OWNER lê equipe da loja|'||case when count(*)>0 then 'OK ('||count(*)||')' else 'FALHA (0)' end
from public.tenant_users tu left join public.users u on u.id = tu.user_id
where tu.tenant_id = split_part(current_setting('t.r2'),'|',2)::uuid;
reset role;

-- R3: RPCs da 0700 continuam executáveis por authenticated (privilégio EXECUTE; chamadas completas
--     em proposals/ro/staging_0700_v_tests_14out.sql — P01 passa a OK, P08 vira false,false,false,false,true)
select 'R3|EXECUTE '||p.oid::regprocedure::text||' para authenticated|'||case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'OK' else 'FALHA' end
from pg_proc p where p.pronamespace='public'::regnamespace
  and p.proname in ('get_my_driver_approval','list_tenant_drivers','list_assignable_drivers') order by 1;
select 'R3|RPCs 0700 presentes|'||case when count(*)=3 then 'OK' else 'FALHA ('||count(*)||')' end
from unnest(array['get_my_driver_approval','list_tenant_drivers','list_assignable_drivers']) n
where exists (select 1 from pg_proc where proname=n and pronamespace='public'::regnamespace);

-- R4: negativos (em read only o TRUNCATE/LOCK seria barrado por read-only antes da permissão;
--     por isso a prova é pelo privilégio efetivo, que é o que o executor checa)
select 'R4|sem TRUNCATE/MAINTAIN/REFERENCES/TRIGGER p/ anon,authenticated|'||
  case when count(*) filter (where has_table_privilege(r,t,p))=0 then 'OK' else 'FALHA' end
from unnest(array['public.drivers','public.team_invites','public.tenant_users']) t,
     unnest(array['anon','authenticated']) r, unnest(array['TRUNCATE','MAINTAIN','REFERENCES','TRIGGER']) p;
select 'R4|service_role inalterado (TRUNCATE/MAINTAIN)|'||
  case when bool_and(has_table_privilege('service_role',t,'TRUNCATE') and has_table_privilege('service_role',t,'MAINTAIN')) then 'OK' else 'FALHA' end
from unnest(array['public.drivers','public.team_invites','public.tenant_users']) t;

-- R5: anon não lê nenhuma das 3 tabelas (PostgREST anon → 401/42501)
select 'R5|anon sem SELECT nas 3|'||case when not bool_or(has_table_privilege('anon',t,'SELECT')) then 'OK' else 'FALHA' end
from unnest(array['public.drivers','public.team_invites','public.tenant_users']) t;
-- R5 HTTP (login real + GET tenant_users?select=id = 200) e R6 (front: login, troca de loja, Equipe,
-- Entregadores, Pedidos) são MANUAIS, fora deste SQL, e exigem autorização própria.

-- R6: RLS e policies de SELECT preservadas
select 'R6|RLS ligada nas 3|'||case when bool_and(relrowsecurity) then 'OK' else 'FALHA' end
from pg_class where oid in ('public.drivers'::regclass,'public.team_invites'::regclass,'public.tenant_users'::regclass);
select 'R6|policy tenant_users_select_scope|'||case when count(*)=1 then 'OK' else 'FALHA' end
from pg_policies where schemaname='public' and tablename='tenant_users' and policyname='tenant_users_select_scope';

rollback;
