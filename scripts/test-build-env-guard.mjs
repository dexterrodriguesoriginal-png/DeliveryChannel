// Exercita o vite.config.mts real em processos isolados, sem ler o .env local
// e sem gerar/esvaziar artefatos do aplicativo.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const configFile = fileURLToPath(new URL('../vite.config.mts', import.meta.url));
const viteModule = import.meta.resolve('vite');
const root = mkdtempSync(path.join(tmpdir(), 'dc-build-env-guard-'));
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_')));
const valid = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_do_not_log',
};

function check(name, { env = {}, mode = 'production', command = 'build', missing = [], envFile } = {}) {
  const cwd = mkdtempSync(path.join(root, 'case-'));
  if (envFile) writeFileSync(path.join(cwd, '.env.production'), envFile);
  const code = `
    import { loadConfigFromFile } from ${JSON.stringify(viteModule)};
    await loadConfigFromFile(${JSON.stringify({ command, mode })}, ${JSON.stringify(configFile)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd, env: { ...baseEnv, ...env }, encoding: 'utf8',
  });
  const output = result.stdout + result.stderr;
  assert.ifError(result.error);
  if (missing.length) {
    assert.notEqual(result.status, 0, name);
    assert.ok(output.includes('Build de produção recusado'), name);
    for (const key of missing) assert.ok(output.includes(key), `${name}: ${key}`);
  } else {
    assert.equal(result.status, 0, `${name}: a configuração deveria ser aceita`);
  }
  assert.ok(!output.includes(valid.VITE_SUPABASE_PUBLISHABLE_KEY), `${name}: não deve imprimir a chave`);
  console.log(`OK: ${name}`);
}

check('ambas ausentes', { missing: Object.keys(valid) });
check('URL ausente', { env: { VITE_SUPABASE_PUBLISHABLE_KEY: valid.VITE_SUPABASE_PUBLISHABLE_KEY }, missing: ['VITE_SUPABASE_URL'] });
check('publishable key ausente mesmo com anon key', { env: { VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'anon-test' }, missing: ['VITE_SUPABASE_PUBLISHABLE_KEY'] });
check('valores vazios ou espaços', { env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '   ' }, missing: Object.keys(valid) });
check('variáveis do processo válidas', { env: valid });
check('loadEnv carrega .env.production', { envFile: Object.entries(valid).map(([key, value]) => `${key}=${value}`).join('\n') });
check('processo vazio prevalece sobre arquivo', { env: { VITE_SUPABASE_PUBLISHABLE_KEY: '' }, envFile: Object.entries(valid).map(([key, value]) => `${key}=${value}`).join('\n'), missing: ['VITE_SUPABASE_PUBLISHABLE_KEY'] });
check('vite dev sem configuração', { mode: 'development', command: 'serve' });
check('vite dev --mode production sem configuração', { command: 'serve' });
check('modo de testes sem configuração', { mode: 'test', command: 'serve' });
