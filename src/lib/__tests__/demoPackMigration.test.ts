import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import packs from '../demoPacks/packs.json';

const migration = readFileSync(new URL('../../../supabase/migrations/20261024003500_demo_pack_by_segment.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../../supabase/rollback/20261024003500_demo_pack_by_segment_rollback.sql', import.meta.url), 'utf8');
const body = (name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = migration.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${escaped}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`));
  expect(match, `Função ${name} deve existir`).not.toBeNull();
  return match![1];
};

describe('contrato da migration de pacotes demo (sem executar SQL)', () => {
  it('mantém o catálogo servido pelo banco idêntico aos 18 pacotes do onboarding', () => {
    const payload = migration.match(/\$demo_packs\$\n([\s\S]*?)\n\$demo_packs\$::jsonb/);
    expect(payload).not.toBeNull();
    expect(JSON.parse(payload![1])).toEqual(packs);
    expect(migration).toContain('CHECK (public._demo_pack_is_valid(segment, payload))');
  });

  it('protege tabelas novas com RLS e impede escrita do catálogo e da elegibilidade pelo cliente', () => {
    for (const table of ['demo_pack_items', 'demo_pack_onboardings']) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
      expect(migration).not.toMatch(new RegExp(`GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*ON (?:TABLE )?public\\.${table}`));
    }
    expect(migration).toContain('GRANT SELECT ON TABLE public.demo_pack_items TO authenticated');
  });

  it('usa search_path vazio em todas as funções SECURITY DEFINER novas e restauradas', () => {
    for (const sql of [migration, rollback]) {
      const declarations = [...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.\w+\([\s\S]*?AS \$\$/g)];
      expect(declarations.length).toBeGreaterThan(0);
      for (const [declaration] of declarations) {
        if (declaration.includes('SECURITY DEFINER')) expect(declaration).toContain("SET search_path = ''");
      }
    }
  });

  it('deriva o tenant pelo proprietário ativo e rejeita contexto ambíguo', () => {
    const owner = body('_demo_pack_owner_tenant');
    expect(owner).toContain('auth.uid()');
    expect(owner).toContain("tu.role_id = 'OWNER' AND tu.status = 'ACTIVE'");
    expect(owner).toContain('pg_catalog.cardinality(v_tenants)');
    expect(owner).not.toContain('LIMIT 1');
    for (const rpc of ['seed_demo_pack', 'get_demo_pack_review', 'keep_demo_items', 'remove_demo_items']) {
      expect(body(rpc)).toContain('public._demo_pack_owner_tenant()');
      const header = migration.match(new RegExp(`CREATE FUNCTION public\\.${rpc}\\(([^)]*)\\)`))![1];
      expect(header).not.toContain('tenant');
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\([^;]*FROM PUBLIC, anon;`));
    }
  });

  it('faz o seed atômico após criar o OWNER e preserva as validações de cadastro', () => {
    const create = body('create_tenant_for_current_user');
    expect(create.indexOf('INSERT INTO public.tenant_users')).toBeLessThan(create.indexOf('INSERT INTO public.demo_pack_onboardings'));
    expect(create.indexOf('INSERT INTO public.demo_pack_onboardings')).toBeLessThan(create.indexOf('PERFORM public.seed_demo_pack(p_demo_segment)'));
    expect(create).toContain('WHERE user_id = v_user_id');
    expect(create).toContain('IF v_has_existing_membership THEN');
    expect(create).toContain('public.tenant_email_confirmations');
    expect(create).toContain('public.log_audit_event');
    expect(migration).toContain("p_demo_segment pg_catalog.text DEFAULT 'generico'");
    expect(migration).toContain('DROP TRIGGER IF EXISTS trg_auto_seed_demo_catalog ON public.tenants');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.seed_tenant_demo_catalog(uuid) FROM PUBLIC, anon, authenticated');
  });

  it('registra idempotência fora dos itens e bloqueia concorrência antes de inserir', () => {
    const seed = body('seed_demo_pack');
    expect(seed.indexOf('pg_catalog.pg_advisory_xact_lock')).toBeLessThan(seed.indexOf('IF v_onboarding.seeded_at IS NOT NULL'));
    expect(seed.indexOf('IF v_onboarding.seeded_at IS NOT NULL')).toBeLessThan(seed.indexOf('INSERT INTO public.categories'));
    expect(seed).toContain('WHERE d.tenant_id = v_tenant_id FOR UPDATE');
    expect(seed).toContain('IF NOT FOUND THEN');
    expect(seed).toContain('p_segment IS DISTINCT FROM v_onboarding.segment');
    expect(seed).toContain('UPDATE public.demo_pack_onboardings SET seeded_at');
    expect(seed).not.toContain('DELETE FROM');
  });

  it('remove somente demos do próprio tenant e preserva qualquer referência real, inclusive cascatas', () => {
    const remove = body('remove_demo_items');
    for (const table of ['offers', 'products', 'categories']) {
      expect(remove).toContain(`DELETE FROM public.${table} WHERE id = v_item.id AND tenant_id = v_tenant_id AND is_demo = true`);
      expect(remove).toContain(`public._demo_item_is_referenced('public.${table}'::regclass, v_item.id)`);
    }
    expect(remove.match(/FOR UPDATE OF /g)).toHaveLength(3);
    expect(remove).toContain('p_ids IS NULL OR');
    expect(remove).not.toContain('DELETE FROM public.demo_pack_onboardings');
    const references = body('_demo_item_is_referenced');
    expect(references).toContain('pg_catalog.pg_constraint');
    expect(references).toContain("c.contype = 'f'");
    expect(references).not.toContain('confdeltype');
    expect(references).toContain('v_constraint.conkey[k.ordinality]');
    expect(references).toContain('v_constraint.confkey[k.ordinality]');
  });

  it('dispensa lojas antigas da revisão e grava a escolha nos dois caminhos finais', () => {
    expect(migration).toContain('ADD COLUMN demo_pack_reviewed boolean NOT NULL DEFAULT true');
    for (const rpc of ['keep_demo_items', 'remove_demo_items']) {
      expect(body(rpc)).toContain('UPDATE public.tenant_settings SET demo_pack_reviewed = true WHERE tenant_id = v_tenant_id');
    }
    expect(body('create_tenant_for_current_user')).toContain('SET demo_pack_reviewed = false');
  });

  it('não executa seed, update ou remoção de dados de lojas existentes ao aplicar o arquivo', () => {
    const topLevel = migration.replace(/AS \$\$[\s\S]*?\$\$;/g, '');
    expect(topLevel).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO) public\.(?:tenants|tenant_settings|categories|products|offers|demo_pack_onboardings)\b/);
    expect(topLevel).not.toMatch(/(?:SELECT|PERFORM) public\.seed_demo_pack\(/);
  });

  it('não cria estoque fictício para demos e restaura o trigger original no rollback', () => {
    const openingBalance = body('_demo_pack_product_opening_balance');
    expect(openingBalance).toContain('IF NEW.is_demo AND NEW.stock_quantity = 0 AND EXISTS');
    expect(openingBalance).toContain('FROM public.demo_pack_onboardings d');
    expect(openingBalance).toContain('WHERE d.tenant_id = NEW.tenant_id AND d.seeded_at IS NULL');
    expect(openingBalance.indexOf('END IF;')).toBeLessThan(openingBalance.indexOf('INSERT INTO public.inventory_movements'));
    expect(migration).toContain('REVOKE ALL ON FUNCTION public._demo_pack_product_opening_balance() FROM PUBLIC, anon, authenticated');
    expect(rollback.indexOf('DROP TRIGGER stock_product_opening_balance')).toBeLessThan(rollback.indexOf('DROP FUNCTION public._demo_pack_product_opening_balance()'));
    expect(rollback).toContain('CREATE TRIGGER stock_product_opening_balance AFTER INSERT ON public.products\n    FOR EACH ROW EXECUTE FUNCTION public._stock_open_product_balance()');
    expect(rollback).not.toContain('DROP COLUMN is_demo');
    expect(rollback).toContain("current_setting('app.allow_demo_pack_rollback', true)");
  });
});
