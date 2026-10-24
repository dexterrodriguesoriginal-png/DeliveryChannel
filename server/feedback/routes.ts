import { Router, json, type ErrorRequestHandler } from 'express';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validFeedback } from '../../src/lib/feedback/model';

export function feedbackHash(
  secret: string,
  day: string,
  slug: string,
  kind: string,
  identity: string,
): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify([day, slug, kind, identity]))
    .digest('hex');
}
// Do not trust X-Forwarded-For by default. Configure Express trust proxy only for known proxy CIDRs.
export function createFeedbackRouter(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = env.FEEDBACK_HASH_SECRET;
  let client: SupabaseClient | null = null;
  if (url && key && secret && secret.length >= 32) {
    try {
      client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch {
      /* Invalid configuration disables this feature without breaking the storefront. */
    }
  }
  router.post(
    '/api/store-feedback/:slug',
    json({ limit: '8kb' }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const slug = req.params.slug as string;
      if (
        !/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug) ||
        !validFeedback(req.body)
      ) {
        res.status(400).json({
          message:
            'Informe tipo, mensagem de 10–1000 caracteres, área e nota válidos.',
        });
        return;
      }
      if (!client || !secret || secret.length < 32) {
        res
          .status(503)
          .json({ message: 'Envio temporariamente indisponível.' });
        return;
      }
      try {
        let uid: string | null = null;
        const authorization = req.get('authorization');
        if (authorization) {
          if (!authorization.startsWith('Bearer ')) {
            res.status(401).json({ message: 'Sessão inválida.' });
            return;
          }
          const { data, error } = await client.auth.getUser(
            authorization.slice(7),
          );
          if (error || !data.user || data.user.is_anonymous) {
            res
              .status(401)
              .json({ message: 'Sessão inválida. Entre novamente.' });
            return;
          }
          uid = data.user.id;
        }
        const ip = req.ip || req.socket.remoteAddress;
        if (!ip) {
          res
            .status(503)
            .json({ message: 'Envio temporariamente indisponível.' });
          return;
        }
        const day = new Date().toISOString().slice(0, 10);
        const ipHash = feedbackHash(secret, day, slug, 'ip', ip);
        const senderHash = uid
          ? feedbackHash(secret, day, slug, 'user', uid)
          : ipHash;
        const { error } = await client.rpc('submit_store_feedback', {
          p_store_slug: slug,
          p_type: req.body.type,
          p_message: req.body.message.trim(),
          p_area: req.body.area ?? null,
          p_rating: req.body.rating ?? null,
          p_sender_hash: senderHash,
          p_ip_hash: ipHash,
          p_day: day,
        });
        if (error) {
          const limited = error.code === 'P0001';
          res.status(limited ? 429 : error.code === '22023' ? 400 : 503).json({
            message: limited
              ? 'Limite diário de 5 envios por loja atingido.'
              : 'Não foi possível enviar. Tente novamente mais tarde.',
          });
          return;
        }
        // Never return IDs, hashes, timestamps or log payloads/identity.
        res.status(201).json({ ok: true });
      } catch {
        res
          .status(503)
          .json({ message: 'Envio temporariamente indisponível.' });
      }
    },
  );
  // Body parser errors must not echo or log any part of the submitted text.
  const handleBodyError: ErrorRequestHandler = (error, _req, res, _next) => {
    res.setHeader('Cache-Control', 'no-store');
    res
      .status(error?.type === 'entity.too.large' ? 413 : 400)
      .json({ message: 'Requisição inválida.' });
  };
  router.use(handleBodyError);
  return router;
}
