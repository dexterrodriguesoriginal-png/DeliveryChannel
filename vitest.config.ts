import { defineConfig } from 'vitest/config';

// Testes unitários puros (sem DOM, sem Supabase). Ver src/**/__tests__.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
