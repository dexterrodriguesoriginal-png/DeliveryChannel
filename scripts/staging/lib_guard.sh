#!/usr/bin/env bash
# Guardas anti-produção para scripts de STAGING. Fazer `source` deste arquivo.
# Variáveis:
#   STAGING_PROJECT_REF   ref do projeto de staging (20 letras minúsculas), obrigatório
#   STAGING_DB_URL        connection string do banco de STAGING (deve conter o ref)
#   STAGING_SUPABASE_URL  opcional; se definida, deve ser https://<ref>.supabase.co
#   STAGING_CONFIRM       deve ser igual a STAGING_PROJECT_REF para executar (além de --execute)
#   STAGING_ALLOW_LOCAL_REHEARSAL=1  somente ensaio em PostgreSQL LOCAL (socket/localhost); ref = "local-rehearsal"
SG_PROD_REF="qjmhlbipmwobnuctzpft"

sg_die() { echo "RECUSADO: $*" >&2; exit 3; }

sg_is_local_url() {
  case "$1" in
    postgresql:///*|postgres:///*) return 0;;
    postgresql://localhost[:/]*|postgresql://127.0.0.1[:/]*|postgres://localhost[:/]*|postgres://127.0.0.1[:/]*) return 0;;
    *@localhost[:/]*|*@127.0.0.1[:/]*) return 0;;
  esac
  return 1
}

# Valida ambiente. Não conecta em nada.
sg_validate_env() {
  local ref="${STAGING_PROJECT_REF:-}" url="${STAGING_DB_URL:-}" api="${STAGING_SUPABASE_URL:-}"
  local all="$ref $url $api ${STAGING_CONFIRM:-}"
  case "$(printf '%s' "$all" | tr 'A-Z' 'a-z')" in *"$SG_PROD_REF"*) sg_die "configuração contém o ref de PRODUÇÃO ($SG_PROD_REF).";; esac
  [ -n "$ref" ] || sg_die "defina STAGING_PROJECT_REF explicitamente."
  [ -n "$url" ] || sg_die "defina STAGING_DB_URL (banco de STAGING)."
  case "$url" in *PGPASS*|*'[YOUR-PASSWORD]'*|*'[PASSWORD]'*) sg_die "STAGING_DB_URL ainda tem o marcador de senha.";; esac
  if [ "${STAGING_ALLOW_LOCAL_REHEARSAL:-}" = 1 ]; then
    [ "$ref" = "local-rehearsal" ] || sg_die "ensaio local exige STAGING_PROJECT_REF=local-rehearsal."
    sg_is_local_url "$url" || sg_die "ensaio local só aceita PostgreSQL local (socket/localhost)."
    return 0
  fi
  printf '%s' "$ref" | grep -Eq '^[a-z]{20}$' || sg_die "STAGING_PROJECT_REF inválido (esperado 20 letras minúsculas)."
  sg_is_local_url "$url" && sg_die "URL local sem STAGING_ALLOW_LOCAL_REHEARSAL=1."
  printf '%s' "$url" | grep -Eq '(supabase\.co|supabase\.com)' || sg_die "STAGING_DB_URL não é um host Supabase."
  printf '%s' "$url" | grep -q "$ref" || sg_die "STAGING_DB_URL não contém STAGING_PROJECT_REF ($ref)."
  if [ -n "$api" ] && [ "$api" != "https://$ref.supabase.co" ]; then sg_die "STAGING_SUPABASE_URL deve ser https://$ref.supabase.co."; fi
  return 0
}

# Exige confirmação para modo --execute.
sg_require_confirm() {
  [ "${STAGING_CONFIRM:-}" = "${STAGING_PROJECT_REF:-}" ] && [ -n "${STAGING_CONFIRM:-}" ] \
    || sg_die "para executar, defina STAGING_CONFIRM=<mesmo valor de STAGING_PROJECT_REF>."
}
