import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261020003000_store_customer_crm.sql', 'utf8');
const rollback = readFileSync('supabase/rollback/20261020003000_store_customer_crm_down.sql', 'utf8');

describe('store CRM migration security contract', () => {
  it('uses RLS and tenant membership checks without recursive table policies', () => {
    expect(migration).toContain('ALTER TABLE public.customer_crm_profiles ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.customer_crm_audit ENABLE ROW LEVEL SECURITY');
    expect(migration).toMatch(/customer_crm_profiles_tenant_read[\s\S]*?tu\.tenant_id = customer_crm_profiles\.tenant_id/);
    expect(migration).toMatch(/customer_crm_audit_tenant_read[\s\S]*?tu\.tenant_id = customer_crm_audit\.tenant_id/);
    const policyBodies = [...migration.matchAll(/CREATE POLICY [\s\S]*?USING \(([\s\S]*?)\);/g)].map(match => match[1]);
    expect(policyBodies).toHaveLength(2);
    expect(policyBodies.join('\n')).not.toContain('FROM public.customer_crm_profiles');
    expect(policyBodies.join('\n')).not.toContain('FROM public.customer_crm_audit');
  });

  it('sets an empty search path and restricts every internal helper', () => {
    const functions = migration.split('CREATE OR REPLACE FUNCTION public.').slice(1);
    for (const definition of functions) {
      const header = definition.slice(0, definition.indexOf('AS $$'));
      if (header.includes('SECURITY DEFINER')) expect(header).toContain("SET search_path TO ''");
    }
    for (const functionName of ['_customer_crm_can_manage_tenant', '_customer_crm_seed_profile', '_customer_crm_hide_deleted_account', '_customer_crm_protect_app_customer_fields', '_customer_crm_audit']) {
      const declaration = migration.slice(migration.indexOf(`FUNCTION public.${functionName}`));
      expect(declaration.slice(0, declaration.indexOf('$$'))).toContain("SET search_path TO ''");
      if (functionName === '_customer_crm_can_manage_tenant') {
        expect(migration).toContain('REVOKE ALL ON FUNCTION public._customer_crm_can_manage_tenant(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated');
      } else {
        expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}.*FROM PUBLIC, anon, authenticated`));
      }
      expect(migration).not.toContain('public.has_tenant_role');
      expect(migration).toContain('tu.tenant_id = p_tenant_id');
    }
  });

  it('prevents store staff editing linked account data and honors deletion requests', () => {
    expect(migration).toContain('AND cp.is_manual');
    expect(migration).toContain('AND c.user_id IS NULL');
    expect(migration).toContain('CREATE TRIGGER customer_crm_protect_app_customer_fields');
    expect(migration).toContain('NEW.cpf IS DISTINCT FROM OLD.cpf');
    expect(migration).toContain('crm_register_my_store_customer');
    expect(migration).toContain("'CRM_STORE_REGISTRATION'");
    expect(migration).toContain("dr.status IN ('PENDING', 'PROCESSED')");
    expect(migration).toContain('AND cp.contact_consent');
    expect(migration).toContain('CREATE TRIGGER customer_crm_hide_deleted_account');
    expect(migration).toContain("SET hidden_at = pg_catalog.now()");
  });

  it('ships a rollback for the additive tables, triggers, and RPCs', () => {
    expect(rollback).toContain('DROP TABLE IF EXISTS public.customer_crm_audit');
    expect(rollback).toContain('DROP TABLE IF EXISTS public.customer_crm_profiles');
    expect(rollback).toContain('DROP TRIGGER IF EXISTS customer_crm_hide_deleted_account');
    expect(rollback).toContain('DROP TRIGGER IF EXISTS customer_crm_protect_app_customer_fields');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.crm_register_my_store_customer(uuid, text, text, boolean, boolean)');
  });
});
