import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import { checkBuildEnv } from './src/lib/deployGuard';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // Guarda staging × produção (src/lib/deployGuard.ts): falha o build/dev se a configuração for perigosa.
  const guardErrors = checkBuildEnv({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...pickVite(process.env) });
  if (guardErrors.length) {
    throw new Error('Configuração de build recusada:\n - ' + guardErrors.join('\n - '));
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

function pickVite(e: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(e).filter(([k]) => k.startsWith('VITE_')));
}
