// Proxy HTTPS LOCAL de teste: /rest/v1 -> PostgREST local; /auth/v1/user -> usuário do JWT de teste. Nada remoto.
import https from 'node:https'; import http from 'node:http'; import fs from 'node:fs';
const target = Number(process.argv[2] || 54322), port = Number(process.argv[3] || 8443);
https.createServer({ key: fs.readFileSync('' + (process.env.E2E_TLS_DIR || '/tmp/e2e') + '/key.pem'), cert: fs.readFileSync('' + (process.env.E2E_TLS_DIR || '/tmp/e2e') + '/cert.pem') }, (req, res) => {
  const cors = { 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', 'access-control-allow-credentials': 'true' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url.startsWith('/auth/v1/user')) {
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    try { const c = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
      if (!c.sub) throw 0;
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: c.sub, aud: 'authenticated', role: 'authenticated', email: c.email || '', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
    } catch { res.writeHead(401, { ...cors, 'content-type': 'application/json' }); return res.end('{"message":"no user"}'); }
  }
  if (!req.url.startsWith('/rest/v1')) { res.writeHead(404, { ...cors, 'content-type': 'application/json' }); return res.end('{}'); }
  const p = http.request({ host: '127.0.0.1', port: target, path: req.url.replace('/rest/v1', '') || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, r => {
    res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res);
  });
  p.on('error', e => { res.writeHead(502, cors); res.end(String(e)); });
  req.pipe(p);
}).listen(port, '127.0.0.1', () => console.log('proxy', port, '->', target));
