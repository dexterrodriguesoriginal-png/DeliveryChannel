/**
 * Servidor do app (convenção full-stack do Google AI Studio: Express em server.ts,
 * `npm run dev` => tsx server.ts; build => dist/server.cjs; `npm start` => node dist/server.cjs).
 * Escuta process.env.PORT (Cloud Run) em 0.0.0.0.
 * Serve o SPA (dist) com fallback para index.html e as rotas PWA por loja.
 */
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createPwaRouter } from './server/pwa/routes';
import { demoResolver, StoreResolver, supabaseEnvFrom, supabaseResolver } from './server/pwa/storeSource';

const isProd = process.env.NODE_ENV === 'production';

function pickResolver(): { resolver: StoreResolver; mode: string } {
  const sb = supabaseEnvFrom(process.env);
  if (sb) return { resolver: supabaseResolver(sb), mode: 'supabase (get_public_store, chave publicável)' };
  if (!isProd || process.env.PWA_DEMO_STORES === 'true') return { resolver: demoResolver(), mode: 'lojas demonstrativas locais' };
  return { resolver: async () => ({ status: 'error', message: 'Supabase não configurado' }), mode: 'sem fonte de lojas (503)' };
}

async function start() {
  const app = express();
  app.disable('x-powered-by');
  const port = Number(process.env.PORT) || 3000;
  const distDir = path.resolve(process.cwd(), 'dist');
  const { resolver, mode } = pickResolver();

  app.use(createPwaRouter({ resolveStore: resolver, publicDir: isProd ? distDir : path.resolve(process.cwd(), 'public') }));

  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Nunca servir o bundle do servidor como arquivo estático.
    app.use((req, res, next) => (/^\/server\.cjs(\.map)?$/i.test(req.path) ? res.status(404).end() : next()));
    app.use(express.static(distDir, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (file.endsWith('.html') || file.endsWith('manifest.json')) res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' || path.extname(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[server] ouvindo em 0.0.0.0:${port} (${isProd ? 'produção' : 'desenvolvimento'}; lojas PWA: ${mode})`);
  });
}

start().catch((e) => { console.error(e); process.exit(1); });
