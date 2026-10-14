import { describe, expect, it } from 'vitest';
import { checkBuildEnv, PRODUCTION_PROJECT_REF } from '../deployGuard';

const STG = 'abcdefghijklmnopqrst'; // ref sintético de teste (não é projeto real)
const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const jwt = (payload: object) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const okStaging = {
  VITE_DEPLOY_TARGET: 'staging',
  VITE_BACKEND_SCHEMA: 'n1n6',
  VITE_STAGING_PROJECT_REF: STG,
  VITE_SUPABASE_URL: `https://${STG}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste',
};

describe('deployGuard', () => {
  it('build padrão de produção (legacy-020, sem target) passa', () => {
    expect(checkBuildEnv({ VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toEqual([]);
    expect(checkBuildEnv({})).toEqual([]);
  });
  it('n1n6 + URL de produção é recusado', () => {
    expect(checkBuildEnv({ VITE_BACKEND_SCHEMA: 'n1n6', VITE_SUPABASE_URL: PROD_URL }).join()).toMatch(/PRODUÇÃO/);
    expect(checkBuildEnv({ VITE_BACKEND_SCHEMA: ' N1N6 ', VITE_SUPABASE_URL: PROD_URL }).length).toBeGreaterThan(0);
  });
  it('n1n6 + produção só com aprovação explícita', () => {
    expect(checkBuildEnv({ VITE_BACKEND_SCHEMA: 'n1n6', VITE_SUPABASE_URL: PROD_URL, VITE_N1N6_PRODUCTION_APPROVED: 'yes' })).toEqual([]);
    expect(checkBuildEnv({ VITE_BACKEND_SCHEMA: 'n1n6', VITE_SUPABASE_URL: PROD_URL, VITE_N1N6_PRODUCTION_APPROVED: 'true' }).length).toBe(1);
  });
  it('staging válido passa', () => {
    expect(checkBuildEnv(okStaging)).toEqual([]);
    expect(checkBuildEnv({ ...okStaging, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ ref: STG, role: 'anon' }) })).toEqual([]);
  });
  it('staging apontando para produção é recusado', () => {
    expect(checkBuildEnv({ ...okStaging, VITE_SUPABASE_URL: PROD_URL }).join()).toMatch(/PRODUÇÃO/);
    expect(checkBuildEnv({ ...okStaging, VITE_STAGING_PROJECT_REF: PRODUCTION_PROJECT_REF, VITE_SUPABASE_URL: PROD_URL }).length).toBeGreaterThan(1);
    expect(checkBuildEnv({ ...okStaging, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ ref: PRODUCTION_PROJECT_REF, role: 'anon' }) }).join()).toMatch(/outro projeto/);
    expect(checkBuildEnv({ ...okStaging, VITE_GOOGLE_MAPS_API_KEY: `x${PRODUCTION_PROJECT_REF}` }).join()).toMatch(/VITE_GOOGLE_MAPS_API_KEY/);
  });
  it('staging com configuração incompleta/errada é recusado', () => {
    expect(checkBuildEnv({ ...okStaging, VITE_STAGING_PROJECT_REF: '' }).length).toBeGreaterThan(0);
    expect(checkBuildEnv({ ...okStaging, VITE_SUPABASE_URL: `https://outro${STG}.supabase.co` }).length).toBe(1);
    expect(checkBuildEnv({ ...okStaging, VITE_SUPABASE_URL: `http://${STG}.supabase.co` }).length).toBe(1);
    expect(checkBuildEnv({ ...okStaging, VITE_BACKEND_SCHEMA: 'legacy-020' }).join()).toMatch(/n1n6/);
    expect(checkBuildEnv({ ...okStaging, VITE_SUPABASE_PUBLISHABLE_KEY: '' }).length).toBe(1);
    expect(checkBuildEnv({ ...okStaging, VITE_DEPLOY_TARGET: 'stagin' }).join()).toMatch(/inválido/);
  });
  it('service_role/secret no frontend é recusado', () => {
    expect(checkBuildEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }).length).toBe(1);
    expect(checkBuildEnv({ ...okStaging, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ ref: STG, role: 'service_role' }) }).length).toBe(1);
  });
});
