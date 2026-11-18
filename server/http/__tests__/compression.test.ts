// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { pickEncoding, precompressedStatic, sendCompressedHtml } from '../compression';

let dir = ''; let server: http.Server; let port = 0;
const bigJs = 'export const x = ' + JSON.stringify('a'.repeat(50_000)) + ';\n';

function get(p: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-comp-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'index-AbCd1234.js'), bigJs);
  fs.writeFileSync(path.join(dir, 'assets', 'tiny.css'), 'a{b:c}');
  fs.writeFileSync(path.join(dir, 'icon.png'), Buffer.alloc(5000, 7));
  fs.writeFileSync(path.join(os.tmpdir(), 'dc-secret.js'), bigJs);
  const app = express();
  const mw = precompressedStatic(dir, { cacheControl: (f) => (f.endsWith('.js') ? 'public, max-age=31536000, immutable' : null) });
  await mw.warmup('assets');
  app.use(mw);
  app.use(express.static(dir));
  app.get('/html', (req, res) => { void sendCompressedHtml(req, res, '<html>' + 'x'.repeat(5000) + '</html>'); });
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); r(); })));

describe('compressão (brotli/gzip) sem dependência nova', () => {
  it('pickEncoding prefere br, cai para gzip e respeita q=0', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip;q=0.8')).toBe('gzip');
    expect(pickEncoding('identity')).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding('*')).toBe('br');
  });

  it('JS do build sai em brotli com Vary, tipo, cache imutável e conteúdo idêntico', async () => {
    const r = await get('/assets/index-AbCd1234.js', { 'Accept-Encoding': 'gzip, br' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('br');
    expect(r.headers.vary).toMatch(/Accept-Encoding/i);
    expect(r.headers['content-type']).toMatch(/javascript/);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.body.length).toBeLessThan(bigJs.length / 10);
    expect(zlib.brotliDecompressSync(r.body).toString()).toBe(bigJs);
  });

  it('gzip quando o navegador não aceita br; original quando não aceita nenhum', async () => {
    const g = await get('/assets/index-AbCd1234.js', { 'Accept-Encoding': 'gzip' });
    expect(g.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(g.body).toString()).toBe(bigJs);
    const plain = await get('/assets/index-AbCd1234.js', { 'Accept-Encoding': 'identity' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.toString()).toBe(bigJs);
  });

  it('imagens (já comprimidas) e arquivos pequenos passam direto, sem Content-Encoding', async () => {
    const png = await get('/icon.png', { 'Accept-Encoding': 'br' });
    expect(png.status).toBe(200);
    expect(png.headers['content-encoding']).toBeUndefined();
    const tiny = await get('/assets/tiny.css', { 'Accept-Encoding': 'br' });
    expect(tiny.headers['content-encoding']).toBeUndefined();
  });

  it('ETag => 304; HEAD sem corpo', async () => {
    const r = await get('/assets/index-AbCd1234.js', { 'Accept-Encoding': 'br' });
    const again = await get('/assets/index-AbCd1234.js', { 'Accept-Encoding': 'br', 'If-None-Match': String(r.headers.etag) });
    expect(again.status).toBe(304);
    const head = await get('/assets/index-AbCd1234.js', { 'Accept-Encoding': 'br' }, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
  });

  it('nunca lê fora da pasta do build', async () => {
    const r = await get('/..%2fdc-secret.js', { 'Accept-Encoding': 'br' });
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.body.toString()).not.toBe(bigJs);
  });

  it('HTML da vitrine comprimido na hora, com Vary', async () => {
    const r = await get('/html', { 'Accept-Encoding': 'br' });
    expect(r.headers['content-encoding']).toBe('br');
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers.vary).toMatch(/Accept-Encoding/i);
    expect(zlib.brotliDecompressSync(r.body).toString()).toContain('<html>');
    const plain = await get('/html');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.toString()).toContain('<html>');
  });
});
