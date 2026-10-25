import express, { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { PaymentService } from './service';
import { createPaymentStore } from './store';
import { PaymentError, PROVIDERS, providerName } from './types';
import { RateLimiter } from './security';

const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function createPaymentsRouter(env = process.env, service?: PaymentService) {
  const router = express.Router();
  const store = service?.store || createPaymentStore(env);
  const payments = service || (store ? new PaymentService(store, env) : null);
  const ingress = new RateLimiter(180); const mutations = new RateLimiter(20);
  const asyncRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
  const requirePayments = () => { if (!payments) throw new PaymentError('PAYMENTS_UNAVAILABLE', 503, 'Pagamentos online em breve.'); return payments; };
  const authenticate = async (req: Request) => {
    const bearer = req.headers.authorization?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];
    if (!bearer) throw new PaymentError('AUTH_REQUIRED', 401, 'Entre na sua conta para continuar.');
    return requirePayments().store.user(bearer);
  };
  const membershipId = (req: Request) => {
    const id = req.headers['x-membership-id'];
    if (!uuid(id)) throw new PaymentError('MEMBERSHIP_REQUIRED', 403);
    return id as string;
  };
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (!ingress.allow(req.socket.remoteAddress || 'unknown')) return res.status(429).json({ error: 'Muitas solicitações. Tente novamente em instantes.' });
    if (req.method !== 'GET' && req.headers.origin && payments) {
      try { if (req.headers.origin !== payments.origin) throw new PaymentError('INVALID_ORIGIN', 403); } catch(e) { return next(e); }
    }
    next();
  });
  // Raw body must be captured before any JSON middleware: PagBank authenticates the original bytes.
  router.post('/webhooks/:provider/:id', express.raw({ type: 'application/json', limit: '64kb' }), asyncRoute(async (req, res) => {
    if (!uuid(req.params.id) || !Buffer.isBuffer(req.body)) throw new PaymentError('INVALID_WEBHOOK', 401);
    await requirePayments().webhook(providerName(req.params.provider), req.params.id, { rawBody: req.body, query: req.query,
      headers: { 'x-signature': req.get('x-signature'), 'x-request-id': req.get('x-request-id'), 'x-authenticity-token': req.get('x-authenticity-token') } });
    res.json({ ok: true });
  }));
  router.use(express.json({ limit: '8kb' }));
  router.get('/options/:slug', asyncRoute(async (req, res) => {
    if (!payments) return res.json({ accounts: [] });
    const accounts = await payments.store.publicAccounts(req.params.slug);
    res.json({ accounts: accounts.filter(a => payments.available(a.provider as any)).map(({ provider, account_label, is_primary, accepts_pix, accepts_card }) => ({ provider, account_label, is_primary, accepts_pix, accepts_card })) });
  }));
  router.get('/accounts', asyncRoute(async (req, res) => {
    const user = await authenticate(req);
    const p = requirePayments(); const member = await p.store.membership(user.id, membershipId(req));
    res.json({ accounts: await p.store.accounts(member.tenant_id), availability: Object.fromEntries(PROVIDERS.map(provider => [provider, p.available(provider)])) });
  }));
  router.post('/accounts/:provider/connect', asyncRoute(async (req, res) => {
    const user = await authenticate(req);
    if (!mutations.allow(user.id)) throw new PaymentError('RATE_LIMITED', 429);
    const provider = providerName(req.params.provider); const p = requirePayments(); const membership = membershipId(req);
    if (provider === 'mercadopago' || provider === 'pagbank') {
      const cookie = randomBytes(32).toString('hex');
      const url = await p.startConnect(user.id, membership, provider, cookie);
      res.cookie('payment_oauth', cookie, { httpOnly: true, secure: p.origin.startsWith('https:'), sameSite: 'lax', maxAge: 600_000, path: '/api/payments' });
      return res.json({ url });
    }
    await p.configure(user.id, membership, provider, { ...req.body, action: 'connect' }); res.json({ ok: true });
  }));
  router.post('/accounts/:provider', asyncRoute(async (req, res) => {
    const user = await authenticate(req);
    if (!mutations.allow(user.id)) throw new PaymentError('RATE_LIMITED', 429);
    // No arbitrary tenant_id, credentials, status or connected_at accepted from the client.
    await requirePayments().configure(user.id, membershipId(req), providerName(req.params.provider), req.body || {});
    res.json({ ok: true });
  }));
  router.get('/oauth/:provider/callback', asyncRoute(async (req, res) => {
    const provider = providerName(req.params.provider);
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('payment_oauth='))?.slice(14) || '';
    if (typeof req.query.state !== 'string' || typeof req.query.code !== 'string') throw new PaymentError('INVALID_CALLBACK', 403, 'A conexão não foi autorizada. Volte às configurações e tente novamente.');
    await requirePayments().finishConnect(provider, req.query.state, req.query.code, cookie);
    res.clearCookie('payment_oauth', { path: '/api/payments' });
    // Fixed destination only. Never return tokens/codes or reflect any query parameter in HTML.
    res.type('html').send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conta conectada</title><body><h1>Conta conectada</h1><p>Volte ao painel e abra Configurações → Pagamentos online.</p><a href="/">Voltar ao painel</a></body></html>');
  }));
  router.post('/orders/:id', asyncRoute(async (req, res) => {
    const user = await authenticate(req);
    if (!mutations.allow(user.id)) throw new PaymentError('RATE_LIMITED', 429);
    if (!uuid(req.params.id) || !['pix','card'].includes(req.body?.method)) throw new PaymentError('INVALID_PAYMENT');
    const payment = await requirePayments().create(user.id, user.email || '', req.params.id, providerName(req.body.provider), req.body.method,
      typeof req.body.taxId === 'string' ? req.body.taxId.replace(/\D/g,'') : undefined);
    res.json({ payment });
  }));
  router.get('/orders/:id', asyncRoute(async (req, res) => {
    const user = await authenticate(req);
    if (!uuid(req.params.id)) throw new PaymentError('INVALID_ORDER');
    res.json({ payment: await requirePayments().status(user.id, user.email || '', req.params.id) });
  }));
  router.post('/orders/:id/confirm', asyncRoute(async (req, res) => {
    const user = await authenticate(req);
    if (!mutations.allow(user.id)) throw new PaymentError('RATE_LIMITED', 429);
    if (!uuid(req.params.id)) throw new PaymentError('INVALID_ORDER');
    await requirePayments().manualConfirm(user.id, req.params.id); res.json({ ok: true });
  }));
  router.use((_req, res) => res.status(404).json({ error: 'Recurso não encontrado.' }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Provider response bodies, authorization codes, credentials and raw exceptions are never logged/reflected.
    const safe = error instanceof PaymentError ? error : new PaymentError('PAYMENT_FAILED', 500);
    res.status(safe.status).json({ error: safe.message, code: safe.code });
  });
  return router;
}
