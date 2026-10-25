import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_VERSION } from '../../lib/legal/documents';
import { canAccessEstTab } from '../../lib/navPermissions';
import { isTabModuleEnabled } from '../../lib/modules';
const migrations = [
  '20261024003600_store_feedback',
  '20261024003700_legal_and_data_rights',
];
const feedback = readFileSync(
  `supabase/migrations/${migrations[0]}.sql`,
  'utf8',
);
const legal = readFileSync(`supabase/migrations/${migrations[1]}.sql`, 'utf8');
function body(sql: string, name: string) {
  return sql.split(`CREATE FUNCTION public.${name}(`)[1].split('$$;')[0];
}
describe('feedback and legal security contracts (offline; no migrations are applied)', () => {
  it('gives every SECURITY DEFINER an empty search path and every new function a rollback', () => {
    for (const name of migrations) {
      const sql = readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
      const rollback = readFileSync(`supabase/rollback/${name}.sql`, 'utf8');
      for (const match of sql.matchAll(
        /CREATE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$/g,
      )) {
        if (match[0].includes('SECURITY DEFINER'))
          expect(match[0]).toContain("SET search_path = ''");
        expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${match[1]}(`);
        expect(rollback).toContain(
          `DROP FUNCTION IF EXISTS public.${match[1]}(`,
        );
      }
    }
  });
  it('stores no direct customer identifiers and grants no browser table access', () => {
    const table = feedback
      .split('CREATE TABLE public.store_feedback (')[1]
      .split('\n);')[0];
    for (const identifier of [
      'customer_id',
      'user_id',
      'name',
      'phone',
      'email',
      'order_id',
      'ip_address',
    ])
      expect(table).not.toMatch(new RegExp(`\\b${identifier}\\b`));
    expect(feedback).toContain(
      'ALTER TABLE public.store_feedback ENABLE ROW LEVEL SECURITY',
    );
    expect(feedback).toContain(
      'REVOKE ALL ON public.store_feedback, public.store_feedback_limits FROM PUBLIC, anon, authenticated',
    );
    expect(feedback).not.toContain('CREATE POLICY');
    expect(feedback).toContain(
      'GRANT EXECUTE ON FUNCTION public.submit_store_feedback(text,text,text,text,integer,text,text,date) TO service_role',
    );
    expect(feedback).not.toMatch(
      /GRANT .*submit_store_feedback[^;]*TO (anon|authenticated)/,
    );
  });
  it('scopes reading and changes by active owner/manager memberships of auth.uid()', () => {
    const scope = body(feedback, '_feedback_my_store');
    expect(scope).toContain('tu.user_id = auth.uid()');
    expect(scope).toContain("tu.status = 'ACTIVE'");
    expect(scope).toContain("tu.role_id IN ('OWNER','MANAGER')");
    const list = body(feedback, 'list_store_feedback');
    expect(list).toContain('public._feedback_my_store(p_store_slug)');
    expect(list).toContain('f.tenant_id = v_tenant');
    expect(list).toContain("(f.created_at AT TIME ZONE 'UTC')::date AS day");
    expect(list).not.toContain('sender_hash');
    expect(list).toContain('LIMIT 50 OFFSET p_offset');
    expect(body(feedback, 'set_store_feedback_state')).toContain(
      'id = p_id AND tenant_id = v_tenant',
    );
  });
  it('enforces both quotas atomically with row conflicts and no count-then-insert race', () => {
    const submit = body(feedback, 'submit_store_feedback');
    expect(submit).toContain('ARRAY[p_sender_hash, p_ip_hash]');
    expect(submit).toContain(
      'ON CONFLICT (tenant_id, day, sender_hash) DO UPDATE',
    );
    expect(submit).toContain('WHERE l.submissions < 5');
    expect(submit).toContain("ERRCODE = 'P0001'");
  });
  it('exposes only counts to the CEO', () => {
    const ceo = body(feedback, 'ceo_store_feedback_counts');
    expect(ceo).toContain('tu.user_id = auth.uid()');
    expect(ceo).toContain('count(f.id)');
    for (const sensitive of ['message', 'sender_hash', 'created_at', 'rating'])
      expect(ceo).not.toContain(sensitive);
  });
  it('uses server time and append-only acceptance, checks signup and rejects outdated versions', () => {
    expect(readFileSync('supabase/migrations/20261024004000_payment_privacy_retention.sql','utf8')).toContain(`SELECT '${LEGAL_VERSION}'::text`);
    expect(legal).toContain('accepted_at timestamptz NOT NULL DEFAULT now()');
    expect(legal).toContain(
      'REVOKE ALL ON public.legal_acceptances FROM PUBLIC, anon, authenticated',
    );
    expect(body(legal, 'accept_current_legal')).toContain(
      'p_version IS DISTINCT FROM public._legal_version()',
    );
    expect(body(legal, 'accept_current_legal')).toContain(
      'VALUES(auth.uid(), p_audience, public._legal_version()) ON CONFLICT DO NOTHING',
    );
    expect(legal).toContain('legal_signup_check BEFORE INSERT ON auth.users');
    expect(body(legal, '_legal_business_gate')).toContain(
      "public._require_current_legal('owner')",
    );
    expect(body(legal, '_legal_business_gate')).toContain(
      "public._require_current_legal('customer')",
    );
  });
  it('exports own data with no CRM private notes and reuses the existing deletion flow', () => {
    const exporter = body(legal, 'export_my_customer_data');
    expect(exporter).toContain('v_uid uuid := auth.uid()');
    expect(exporter).toContain('c.user_id=v_uid');
    expect(exporter).not.toContain('private_notes');
    expect(exporter).not.toContain('store_feedback');
    expect(legal).not.toMatch(/CREATE TABLE.*deletion/);
    const profile = readFileSync('src/components/legal/MyDataPage.tsx', 'utf8');
    expect(profile).toContain('<DeleteAccountSheet');
    expect(profile).toContain('onConfirm={onRequestDeletion}');
  });
  it('allows owners and managers on every plan independently of modules', () => {
    for (const role of ['OWNER', 'MANAGER'] as const)
      expect(canAccessEstTab(role, 'est-feedback')).toBe(true);
    for (const role of [
      'CEO',
      'SUPER_ADMIN',
      'CASHIER',
      'OPERATOR',
      'WAITER',
      'KITCHEN',
      'CUSTOMER',
      'DRIVER',
      'DELIVERY_MANAGER',
    ] as const)
      expect(canAccessEstTab(role, 'est-feedback')).toBe(false);
    expect(isTabModuleEnabled(new Set(), 'est-feedback')).toBe(true);
  });
});
