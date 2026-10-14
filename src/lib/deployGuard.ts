/**
 * Guarda de build (staging × produção). Usada por vite.config.ts: o build FALHA se algum erro for retornado.
 *
 * Regras:
 *  R1. VITE_BACKEND_SCHEMA=n1n6 com VITE_SUPABASE_URL de PRODUÇÃO é recusado (produção está em 001–020),
 *      salvo VITE_N1N6_PRODUCTION_APPROVED=yes — usar SOMENTE após N1–N6 aplicadas em produção com
 *      aprovação escrita do fundador.
 *  R2. VITE_DEPLOY_TARGET=staging exige:
 *      - VITE_STAGING_PROJECT_REF válido (20 letras minúsculas) e diferente do ref de produção;
 *      - VITE_SUPABASE_URL exatamente https://<VITE_STAGING_PROJECT_REF>.supabase.co;
 *      - VITE_BACKEND_SCHEMA=n1n6;
 *      - chave pública (se for JWT com claim `ref`) do mesmo projeto de staging;
 *      - nenhum valor contendo o ref de produção.
 *  R3. VITE_DEPLOY_TARGET com valor desconhecido é recusado (evita erro de digitação silencioso).
 * Nunca use service_role/secret no frontend: chaves `sb_secret_` ou JWT com role=service_role são recusadas.
 */
export const PRODUCTION_PROJECT_REF = 'qjmhlbipmwobnuctzpft';
const REF_RE = /^[a-z]{20}$/;

type Env = Record<string, string | undefined>;

function jwtClaims(key: string): Record<string, unknown> | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof atob === 'function'
        ? atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
        : Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function checkBuildEnv(env: Env): string[] {
  const errors: string[] = [];
  const v = (k: string) => (env[k] ?? '').trim();
  const url = v('VITE_SUPABASE_URL');
  const key = v('VITE_SUPABASE_PUBLISHABLE_KEY') || v('VITE_SUPABASE_ANON_KEY');
  const schema = v('VITE_BACKEND_SCHEMA').toLowerCase();
  const target = v('VITE_DEPLOY_TARGET').toLowerCase();
  const urlIsProd = url.toLowerCase().includes(PRODUCTION_PROJECT_REF);
  const claims = key ? jwtClaims(key) : null;

  if (key.startsWith('sb_secret_') || claims?.role === 'service_role') {
    errors.push('Chave secreta/service_role no frontend é proibida (use a publishable/anon key).');
  }
  if (schema === 'n1n6' && urlIsProd && v('VITE_N1N6_PRODUCTION_APPROVED') !== 'yes') {
    errors.push(
      'VITE_BACKEND_SCHEMA=n1n6 apontando para o Supabase de PRODUÇÃO (ainda em 001–020). Recusado. ' +
        'Só após ativação aprovada por escrito: VITE_N1N6_PRODUCTION_APPROVED=yes.'
    );
  }
  if (target && target !== 'staging' && target !== 'production') {
    errors.push(`VITE_DEPLOY_TARGET inválido: "${target}" (use staging ou production).`);
  }
  if (target === 'staging') {
    const ref = v('VITE_STAGING_PROJECT_REF');
    if (!REF_RE.test(ref)) errors.push('Staging: VITE_STAGING_PROJECT_REF ausente ou inválido (20 letras minúsculas).');
    if (ref === PRODUCTION_PROJECT_REF) errors.push('Staging: VITE_STAGING_PROJECT_REF é o ref de PRODUÇÃO.');
    if (urlIsProd) errors.push('Staging: VITE_SUPABASE_URL aponta para PRODUÇÃO.');
    if (REF_RE.test(ref) && url !== `https://${ref}.supabase.co`) {
      errors.push(`Staging: VITE_SUPABASE_URL deve ser exatamente https://${ref}.supabase.co.`);
    }
    if (schema !== 'n1n6') errors.push('Staging: VITE_BACKEND_SCHEMA deve ser n1n6.');
    if (!key) errors.push('Staging: chave pública (VITE_SUPABASE_PUBLISHABLE_KEY) ausente.');
    if (claims && typeof claims.ref === 'string' && claims.ref !== ref) {
      errors.push('Staging: a chave anon pertence a outro projeto (claim ref diferente do staging).');
    }
    for (const [k, val] of Object.entries(env)) {
      if (k.startsWith('VITE_') && (val ?? '').toLowerCase().includes(PRODUCTION_PROJECT_REF)) {
        errors.push(`Staging: ${k} contém o ref de PRODUÇÃO.`);
      }
    }
  }
  return [...new Set(errors)];
}
