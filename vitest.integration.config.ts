import { defineConfig } from 'vitest/config';

// Integração REAL com PostgreSQL + PostgREST LOCAIS (ver tests/integration/setup_local_backend.sh).
// FE_IT_MODE=n1n6 (porta 54322, banco 001–020+N1–N6) ou legacy-020 (porta 54321, banco 001–020).
const mode = process.env.FE_IT_MODE === 'legacy-020' ? 'legacy-020' : 'n1n6';
export default defineConfig({
  test: {
    environment: 'node',
    include: [mode === 'n1n6' ? 'tests/integration/n1n6.integration.ts' : 'tests/integration/legacy.integration.ts'],
    fileParallelism: false,
    env: {
      FE_IT_MODE: mode,
      VITE_BACKEND_SCHEMA: mode,
      FE_IT_URL: mode === 'n1n6' ? 'http://127.0.0.1:54322' : 'http://127.0.0.1:54321',
    },
  },
});
