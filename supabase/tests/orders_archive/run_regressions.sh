#!/usr/bin/env bash
set -euo pipefail
# Somente PostgreSQL LOCAL descartável, com dados sintéticos. Requer psql/createdb/dropdb.
# Ex.: bash supabase/tests/orders_archive/run_regressions.sh
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo 'Somente PostgreSQL local' >&2; exit 2 ;; esac
cd "$(dirname "$0")/../../.."
archive_migration=supabase/migrations/20261026004300_orders_archive.sql
archive_rollback=supabase/rollback/20261026004300_orders_archive_down.sql
for mode in strict legacy; do
  export PGDATABASE="orders_archive_${mode}_$$"
  createdb "$PGDATABASE"
  trap 'dropdb --if-exists "$PGDATABASE"' EXIT
  psql -X -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/harness/00_supabase_stubs.sql
  # Stubs do Supabase e ACL explícita exigidos pelos prechecks históricos (como em pr_b/run_regressions.sh).
  psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO vault.secrets_stub(name,decrypted_secret) VALUES ('n1n6_ip_hash_salt','local-archive-fixture-salt-0123456789abcdef'); CREATE PUBLICATION supabase_realtime"
  for file in supabase/migrations/*.sql; do
    [ "$file" = "$archive_migration" ] && continue
    case "$file" in *20261026004301_online_payment_gate.sql) continue ;; esac
    name=${file##*/}; version=${name%%_*}
    if [ "$version" = 20261006000100 ]; then
      psql -X -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/sql/01_legacy_data.sql
    fi
    if [ "$version" = 20261014000800 ]; then
      psql -X -v ON_ERROR_STOP=1 -c 'GRANT ALL ON public.drivers,public.team_invites,public.tenant_users TO postgres'
    fi
    psql -X -v ON_ERROR_STOP=1 -1 -f "$file"
    psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version')"
  done
  psql -X -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/sql/00_framework.sql
  # A fixture N1–N6 antecede approval_status; seu motorista sintético deve ser aprovado.
  psql -X -v ON_ERROR_STOP=1 -c "ALTER TABLE public.drivers ALTER COLUMN approval_status SET DEFAULT 'APPROVED'"
  psql -X -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/sql/03_fixtures.sql
  psql -X -v ON_ERROR_STOP=1 -c "ALTER TABLE public.drivers ALTER COLUMN approval_status SET DEFAULT 'PENDING'"
  # Simula grants padrão do Supabase nas novas funções, sem mudar prechecks de migrations antigas.
  if [ "$mode" = legacy ]; then
    psql -X -v ON_ERROR_STOP=1 -c 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role'
  fi
  protect_before=$(psql -X -At -c "SELECT md5(pg_get_functiondef('public._orders_protect_columns()'::regprocedure))")
  for round in first reapply; do
    psql -X -v ON_ERROR_STOP=1 -f "$archive_migration"
    psql -X -v ON_ERROR_STOP=1 -c "SET t.suite='orders_archive_$round'" -f supabase/tests/n1n6/sql/86_orders_archive.sql
    psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM t.results WHERE NOT ok), 'falha nos testes de arquivamento';
END $$;
SQL
    if [ "$round" = first ]; then
      psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE t.archive_rollback_snapshot AS
SELECT o.id, to_jsonb(o) - ARRAY['archived_at','archived_by'] AS row FROM public.orders o;
CREATE TABLE t.archive_items_snapshot AS SELECT * FROM public.order_items;
CREATE TABLE t.archive_audit_snapshot AS SELECT * FROM public.audit_logs;
SQL
      psql -X -v ON_ERROR_STOP=1 -f "$archive_rollback"
      [ "$protect_before" = "$(psql -X -At -c "SELECT md5(pg_get_functiondef('public._orders_protect_columns()'::regprocedure))")" ]
      psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  ASSERT to_regprocedure('public.archive_orders(uuid[],boolean)') IS NULL, 'RPC removida no rollback';
  ASSERT NOT EXISTS(SELECT 1 FROM t.archive_rollback_snapshot s FULL JOIN public.orders o ON o.id=s.id
    WHERE s.row IS DISTINCT FROM to_jsonb(o)), 'rollback alterou pedidos';
  ASSERT NOT EXISTS(SELECT * FROM t.archive_items_snapshot EXCEPT SELECT * FROM public.order_items), 'rollback perdeu itens';
  ASSERT NOT EXISTS(SELECT * FROM t.archive_audit_snapshot EXCEPT SELECT * FROM public.audit_logs), 'rollback perdeu auditoria';
  ASSERT NOT has_table_privilege('authenticated','public.orders','DELETE'), 'rollback reabriu exclusão';
END $$;
SQL
    fi
  done
  psql -X -At -c "SELECT 'PASS $mode: '||count(*)||' verificações de arquivamento; migration, rollback e reaplicação' FROM t.results"
  dropdb "$PGDATABASE"
  trap - EXIT
done
