import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const name = '20261024003800_submit_store_feedback_v2';
const sql = readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const rollback = readFileSync(`supabase/rollback/${name}.sql`, 'utf8');
const old = readFileSync('supabase/migrations/20261024003600_store_feedback.sql', 'utf8');
const signature = 'public.submit_store_feedback_v2(text,text,text,integer,text)';
const body = sql.split('CREATE FUNCTION public.submit_store_feedback_v2(')[1];

describe('feedback v2 migration contracts (offline, no database)', () => {
  it('offers only five content/destination arguments and grants only the intended roles', () => {
    const header = body.split('AS $$')[0];
    expect(header).toContain("SECURITY DEFINER SET search_path = ''");
    expect([...header.matchAll(/\bp_\w+\s+(text|integer)/g)].map(m => m[0])).toEqual([
      'p_tenant_slug_or_id text', 'p_type text', 'p_area text', 'p_rating integer', 'p_message text',
    ]);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO anon, authenticated`);
    expect(sql).toContain('DROP FUNCTION public.submit_store_feedback(text,text,text,text,integer,text,text,date)');
    expect(sql).not.toMatch(/GRANT .*TO PUBLIC/);
  });

  it('generates a private 32-byte secret with no table access, return value or policy', () => {
    expect(sql).toContain('extensions.gen_random_bytes(32)');
    expect(sql).toContain('octet_length(secret) = 32');
    expect(sql).toContain('singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton)');
    expect(sql).toContain('REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('ALTER TABLE private.store_feedback_secret ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON private.store_feedback_secret FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).not.toMatch(/CREATE POLICY|GRANT .*private\./);
    expect(body).toContain(') RETURNS void');
    expect(body).not.toMatch(/RAISE (LOG|NOTICE|DEBUG)|RETURN\s+v_/);
  });

  it('validates all values and resolves only active public stores on the server', () => {
    for (const part of [
      "p_type NOT IN ('sugestao','elogio','reclamacao')",
      'char_length(btrim(p_message)) NOT BETWEEN 10 AND 1000',
      "p_area NOT IN ('atendimento','produto','entrega','preco','app','outro')",
      'p_rating NOT BETWEEN 1 AND 5', 'p_type IS NULL', 'p_message IS NULL',
      "t.status = 'ACTIVE'", "nullif(btrim(t.slug), '') IS NOT NULL",
      't.id = v_destination_id', 't.slug = p_tenant_slug_or_id', 'IF v_tenant IS NULL',
    ]) expect(body).toContain(part);
    expect(body.indexOf('IF v_tenant IS NULL')).toBeLessThan(body.indexOf('INSERT INTO public.store_feedback_limits'));
  });

  it('uses verified UID or gateway IP, canonical tenant and UTC day with HMAC(data, secret)', () => {
    expect(body).toContain('v_identity := auth.uid()::text');
    expect(body).toContain("IF v_identity IS NULL THEN");
    expect(body).toContain("current_setting('request.headers', true)");
    expect(body).toContain("::json->>'x-forwarded-for', ',', 1");
    expect(body).toContain("(statement_timestamp() AT TIME ZONE 'UTC')::date");
    expect(body).toContain("convert_to(v_identity || v_tenant::text || to_char(v_day, 'YYYY-MM-DD'), 'UTF8'),\n    v_secret, 'sha256'");
    const insert = body.split('INSERT INTO public.store_feedback(')[1].split('DELETE FROM')[0];
    expect(insert).toContain("v_day::timestamp AT TIME ZONE 'UTC'");
    expect(insert).not.toMatch(/auth\.uid|v_identity|v_secret|request.headers/);
    expect(body).not.toMatch(/p_sender|p_ip|p_day|p_user/);
  });

  it('enforces quota by atomic UPSERT and raises before inserting content on the sixth call', () => {
    expect(body).toContain('VALUES (v_tenant, v_day, v_hash, 1)');
    expect(body).toContain('ON CONFLICT (tenant_id, day, sender_hash) DO UPDATE SET submissions = l.submissions + 1');
    expect(body).toContain('WHERE l.submissions < 5 RETURNING submissions INTO v_count');
    expect(body).toContain("IF v_count IS NULL THEN\n    RAISE EXCEPTION 'Limite diário de 5 envios por loja atingido.' USING ERRCODE = 'P0001'");
    expect(body.indexOf("ERRCODE = 'P0001'")).toBeLessThan(body.indexOf('INSERT INTO public.store_feedback('));
    expect(body).not.toMatch(/count\(\*\)|EXCEPTION WHEN OTHERS/);
  });

  it('restores the exact previous RPC and its grants, preserving feedback and counters', () => {
    const previous = old.slice(old.indexOf('CREATE FUNCTION public.submit_store_feedback('), old.indexOf('\n\n-- Store scope'));
    expect(rollback).toContain(previous);
    expect(rollback).toContain(`DROP FUNCTION IF EXISTS ${signature}`);
    expect(rollback).toContain('DROP TABLE IF EXISTS private.store_feedback_secret');
    expect(rollback).not.toMatch(/DROP TABLE.*public\.|TRUNCATE|CASCADE/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(rollback.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('removes the Express route and all feedback-only runtime configuration', () => {
    expect(existsSync('server/feedback/routes.ts')).toBe(false);
    const server = readFileSync('server.ts', 'utf8');
    const env = readFileSync('.env.example', 'utf8');
    expect(server).not.toContain('createFeedbackRouter');
    for (const key of ['FEEDBACK_HASH_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'TRUSTED_PROXY_CIDRS']) {
      expect(server).not.toContain(key);
      expect(env).not.toContain(key);
    }
  });
});
