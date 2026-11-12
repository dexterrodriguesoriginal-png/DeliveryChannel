import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { checkBuildEnv } from './src/lib/deployGuard';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveViteBuildVersion(env: Record<string, string | undefined>): string {
  const fromEnv = (
    env.PWA_BUILD_VERSION ||
    env.VITE_PWA_BUILD_VERSION ||
    env.K_REVISION ||
    env.COMMIT_SHA ||
    env.GITHUB_SHA ||
    env.VERCEL_GIT_COMMIT_SHA ||
    ''
  ).trim();
  if (fromEnv) return fromEnv;
  return `build-${Date.now().toString(36)}`;
}

function pwaVersionAssetPlugin(version: string): Plugin {
  return {
    name: 'dc-pwa-version-asset',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'pwa-version.json',
        source: JSON.stringify({ version }),
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...pickVite(process.env) };
  if (command === 'build' && mode === 'production') {
    const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
      .filter((name) => !env[name]?.trim());
    if (missing.length) {
      throw new Error(`Build de produção recusado: variáveis obrigatórias ausentes ou vazias: ${missing.join(', ')}. Configure-as antes de gerar o build.`);
    }
  }
  // Guarda staging × produção (src/lib/deployGuard.ts): falha o build/dev se a configuração for perigosa.
  const guardErrors = checkBuildEnv(env);
  if (guardErrors.length) {
    throw new Error('Configuração de build recusada:\n - ' + guardErrors.join('\n - '));
  }
  const buildVersion = resolveViteBuildVersion(process.env);
  return {
    define: {
      __PWA_BUILD_VERSION__: JSON.stringify(buildVersion),
    },
    plugins: [react(), tailwindcss(), pwaVersionAssetPlugin(buildVersion)],
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

