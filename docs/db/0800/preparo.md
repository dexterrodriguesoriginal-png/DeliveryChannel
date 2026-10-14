# Migration 0800 — preparo (14/10/2026, BRT)
**Status: implementado e validado só em PostgreSQL 17.11 local descartável. NÃO aplicado em staging nem produção.**

Arquivos:
- `supabase/migrations/20261014000800_revoke_excess_table_privileges.sql` — sha256 75d21a8f562bdd193d6f1667d28a2d4debe9e0d404be66f831dae5b60d3e2d65
- `docs/db/0800/rollback_0800.sql` — sha256 b0e5628807821006d7671b33950e7ac07aae8e7a0c65f83b2c289b5c2ab51b0c
- `docs/db/0800/staging_0800_tests.sql` (R0–R6, begin read only/rollback) — sha256 a7a798a8a709975a943b4b0a87230f0874644841149691703ae184c7db19deb8

Conteúdo: PRE (PG17+, tabelas existem, RLS ligada, SELECT/INSERT/UPDATE/DELETE exatamente como auditado, alvos = auditado ou já revogado, TRUNCATE em drivers ausente, sem ACL de coluna) → REVOKE TRUNCATE, MAINTAIN, REFERENCES, TRIGGER nas 3 tabelas de anon, authenticated → POST (matriz final exata; authenticated mantém SELECT em tenant_users; ACL de service_role/dono idêntica antes/depois). BEGIN/COMMIT próprios, igual à 0700 (aplicada com `psql -X -1 -v ON_ERROR_STOP=1 -f`; o -1 gera só WARNINGs inofensivos de transação aninhada, e qualquer erro antes do COMMIT desfaz tudo).

Base lógica do teste (reproduzível a partir de origin/main 48b576e): migrations 001–020 + N1 + N1.V (supabase/manual/n1v_validate_constraints.sql) + N2–N6 + 0700 v3.4 (sha256 29842f77eb7606e575143ff6d0b5f0f3250c2e195a393e7bad0fdc91fd27cf2d), cada uma com `psql -X -1 -v ON_ERROR_STOP=1` e registro em supabase_migrations.schema_migrations, sobre stubs mínimos de Supabase (papéis anon/authenticated/service_role, auth.uid/jwt, vault com salt sintético, pgcrypto em extensions) e default ACL do schema public replicando o auditado no staging (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN para anon/authenticated/service_role). relacl pré-0800 idêntico ao da auditoria (exceto o nome do dono). Dados: 1 loja e 2 usuários sintéticos.

Resultados (PostgreSQL 17.11):
- 0800 run1/run2 com -1 e run3 sem -1: rc=0, POST OK nas 3 (idempotente).
- relacl pós: drivers/team_invites só dono+service_role; tenant_users `authenticated=r`.
- R0–R6: 17/17 OK (pré-0800: R0 6 FALHA e R4 FALHA, como esperado).
- Negativos reais: TRUNCATE como anon/authenticated nas 3 → permission denied (6/6); LOCK ACCESS EXCLUSIVE drivers → permission denied; VACUUM → WARNING skipping.
- Rollback run1/run2: rc=0; conjunto de privilégios = estado auditado (só a ordem dos itens no relacl muda); 0800 reaplicada após rollback: OK.
- Precheck negativo: INSERT extra em drivers, TRUNCATE em drivers regranted, falta de SELECT em tenant_users → aborta; ACL intacta.

Registro seguro em schema_migrations (staging/produção):
1. Aplicar a migration com `psql -X -1 -v ON_ERROR_STOP=1 -f`; rc≠0 → nada aplicado, parar sem retry.
2. Verificar read-only a matriz R0/relacl no pós-estado.
3. Só então, em comando separado: `insert into supabase_migrations.schema_migrations(version,name) values ('20261014000800','revoke_excess_table_privileges') on conflict (version) do nothing;`
4. Se o registro falhar: NÃO reaplicar nem editar o SQL; reverificar a matriz; se pós-estado, repetir só o INSERT; se pré-estado ou misto, parar e reportar.

Ressalvas:
- Stubs locais imitam Supabase (auth, vault, storage); não reproduzem PostgREST/pg_graphql. R5 HTTP e R6 front ficam manuais.
- Precheck é estrito: se produção divergir do staging auditado, a 0800 aborta lá (desejado); refazer a auditoria read-only em produção antes.
- Se aplicada pelo Supabase CLI (que já envolve em transação), o BEGIN/COMMIT interno se comporta como na 0700.
- Não cobre as outras 31 tabelas de public nem default privileges (fases 2/3), nem SELECT de team_invites.
