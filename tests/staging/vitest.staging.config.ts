import { defineConfig } from 'vitest/config';
// E2E REAL contra o projeto Supabase de STAGING (rede + login real). Nunca produção.
// Uso: ver docs/staging/RUNBOOK_STAGING.md §6.
export default defineConfig({
  test: {
    include: ['tests/staging/staging.e2e.ts', 'tests/staging/orderflow.e2e.ts', 'tests/staging/arrival.e2e.ts'],
    environment: 'node',
    testTimeout: 60000,
    fileParallelism: false,
    sequence: { concurrent: false },
    env: { VITE_BACKEND_SCHEMA: 'n1n6' },
  },
});
