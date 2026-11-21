import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const name = '20261118000100_store_presentation_screen';
const sql = readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const down = readFileSync(`supabase/rollback/${name}_down.sql`, 'utf8');

describe('migration da tela inicial personalizada', () => {
  it('contratos: transação, PRE, RPCs SECURITY DEFINER com search_path vazio, sem escrita direta', () => {
    expect(sql.trimStart().split('\n').find(l => !l.startsWith('--'))).toBe('BEGIN;');
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).toContain('PRESENTATION PRE');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.tenant_presentation_screens');
    expect(sql).toContain("'store_presentation'");
    expect(sql).toContain("module_key = 'store_presentation' AND tm.enabled");
    expect(sql).toContain("public.assert_tenant_module_enabled(p_tenant_id, 'store_presentation')");
    expect(sql).toContain('p_asset_id AND tenant_id = p_tenant_id');
    expect(sql).toContain('a.duration_seconds > 10.05');
    expect(sql.match(/SECURITY DEFINER SET search_path = ''/g)?.length).toBe(3);
    expect(sql).toContain('REVOKE ALL ON public.tenant_presentation_screens FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT SELECT ON public.tenant_presentation_screens TO authenticated');
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*tenant_presentation_screens/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.(set|clear)_presentation_screen[^;]*anon/);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public._presentation_store_base(text) FROM PUBLIC, anon, authenticated');
    expect(down).toContain('PRESENTATION DOWN');
    expect(down).not.toMatch(/CASCADE/);
  });
  it('PGlite: aplica, isola tenants, não vaza campos e o rollback restaura a função exata', () => {
    const out = execFileSync(process.execPath, ['supabase/tests/presentation_screen/run_pglite.mjs'], { encoding: 'utf8', timeout: 120000 });
    expect(out).toContain('presentation_screen PGlite: OK');
  }, 150000);
});
