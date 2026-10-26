#!/bin/sh
set -eu
# Refuse remote databases; create and remove only this run's synthetic database.
export PGHOST="${PGHOST:-/var/run/postgresql}"
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo "Local PostgreSQL only" >&2; exit 2 ;; esac
cd "$(dirname "$0")/../../.."
export PGDATABASE="payments_regression_$$"
createdb "$PGDATABASE"
trap 'dropdb --if-exists "$PGDATABASE"' EXIT
psql -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/harness/00_supabase_stubs.sql
psql -v ON_ERROR_STOP=1 -c "INSERT INTO vault.secrets_stub(name,decrypted_secret) VALUES ('n1n6_ip_hash_salt','local-regression-fixture-salt-0123456789abcdef')"
# Supabase services represented locally, without external accounts or secrets.
psql -v ON_ERROR_STOP=1 -c "CREATE PUBLICATION supabase_realtime"
for file in supabase/migrations/*.sql; do
  version=${file##*/}
  case "$version" in
    202609*) psql -v ON_ERROR_STOP=1 -1 -f "$file"
      migration_version=${version%%_*}
      psql -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$migration_version')" ;;
  esac
done
psql -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/sql/01_legacy_data.sql
for file in supabase/migrations/*.sql; do
  version=${file##*/}
  case "$version" in
    202609*) ;;
    20261026004100_*) ;;
    *)
      if [ "$version" = "20261014000800_revoke_excess_table_privileges.sql" ]; then
        # Make implicit owner ACLs explicit for the historical 0800 snapshot check.
        psql -v ON_ERROR_STOP=1 -c "GRANT ALL ON public.drivers,public.team_invites,public.tenant_users TO postgres"
      fi
      psql -v ON_ERROR_STOP=1 -1 -f "$file"
      migration_version=${version%%_*}
      psql -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$migration_version')" ;;
  esac
done
psql -v ON_ERROR_STOP=1 -f supabase/tests/n1n6/sql/00_framework.sql

psql -v ON_ERROR_STOP=1 -c "INSERT INTO public.legal_acceptances(user_id,audience,version) SELECT u.id,a.audience,public._legal_version() FROM auth.users u CROSS JOIN (VALUES ('owner'),('customer')) a(audience) ON CONFLICT DO NOTHING"

functions_hash() {
 psql -X -At -c "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY proname)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('configure_store_payment','complete_store_payment_connection')"
}
before=$(functions_hash)
psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO public.store_payment_accounts(tenant_id,provider,status,is_primary) VALUES ('10000000-0000-0000-0000-00000000000a','manual_pix','connected',false),('10000000-0000-0000-0000-00000000000b','manual_pix','connected',true)"
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261026004100_payment_primary_accounts.sql
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 ASSERT (SELECT count(*)=2 FROM public.store_payment_accounts WHERE is_primary), 'backfill missing choice or changed existing primary';
END $$;
SQL
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/payments/primary_and_free_delivery.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/rollback/20261026004100_payment_primary_accounts_down.sql
[ "$before" = "$(functions_hash)" ] || { echo 'Rollback changed function definitions or grants' >&2; exit 1; }
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261026004100_payment_primary_accounts.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/payments/primary_and_free_delivery.sql
echo 'PASS: migration, backfill, primary selection, delivery checkout, rollback definitions/grants, reapplication'
