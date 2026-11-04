import express, { type NextFunction, type Request, type Response } from 'express';
import { resolveServerPublicConfig } from '../config/publicConfig';
import { RateLimiter } from '../payments/security';
import { ReceiptService } from './service';
import { createReceiptStore } from './store';
import { ReceiptError } from './types';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function createReceiptsRouter(env = process.env, suppliedService?: ReceiptService) {
  const router = express.Router();
  const store = suppliedService?.store || createReceiptStore(env);
  const service = suppliedService || (store ? ReceiptService.configured(store, env) : null);
  const ingress = new RateLimiter(60);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!ingress.allow(req.socket.remoteAddress || 'unknown')) return res.status(429).json({ error: 'Muitas solicitações. Tente novamente em instantes.', code: 'RATE_LIMITED' });
    if (req.headers.origin) {
      try {
        if (new URL(resolveServerPublicConfig(env).PAYMENTS_PUBLIC_URL).origin !== req.headers.origin) throw new Error('origin');
      } catch { return next(new ReceiptError('INVALID_ORIGIN', 403, 'Solicitação não autorizada.')); }
    }
    next();
  });
  router.use(express.json({ limit: '1kb' }));
  router.post('/tabs/:id', (req, res, next) => {
    void (async () => {
      const token = req.headers.authorization?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];
      if (!token) throw new ReceiptError('AUTH_REQUIRED', 401, 'Entre na sua conta para continuar.');
      if (!service || !store) throw new ReceiptError('RECEIPTS_UNAVAILABLE', 503, 'O serviço de comprovantes está indisponível.');
      const user = await store.user(token);
      if (!UUID.test(req.params.id)) throw new ReceiptError('INVALID_TAB', 400, 'Comanda inválida.');
      // No address, tenant, amount or payment state supplied by the browser is ever trusted.
      res.json(await service.send(user.id, req.params.id));
    })().catch(next);
  });
  router.use((_req, res) => res.status(404).json({ error: 'Recurso não encontrado.' }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const safe = error instanceof ReceiptError ? error : new ReceiptError('RECEIPT_FAILED', 500, 'Não foi possível enviar o comprovante. Tente novamente.');
    res.status(safe.status).json({ error: safe.message, code: safe.code });
  });
  return router;
}
