import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const pub = (f: string) => path.resolve(__dirname, '../../../public', f);
const read = (f: string) => JSON.parse(fs.readFileSync(pub(f), 'utf8'));
const pngSize = (f: string) => { const b = fs.readFileSync(pub(f)); return [b.readUInt32BE(16), b.readUInt32BE(20), b.subarray(0, 8).toString('hex')]; };

describe('PWA manifests (pacote C)', () => {
  it.each([['manifest.json', '/', '/'], ['manifest-entregador.json', '/entregador', '/entregador']])('%s tem id/start_url/scope/display e ícones PNG', (f, id, start) => {
    const m = read(f);
    expect(m.id).toBe(id);
    expect(m.start_url).toBe(start);
    expect(m.scope).toBe('/');
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(m.display).toBe('standalone');
    const png = m.icons.filter((i: any) => i.type === 'image/png').map((i: any) => i.sizes);
    expect(png).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const i of m.icons) expect(fs.existsSync(pub(i.src.replace(/^\//, '')))).toBe(true);
  });
  it('PNGs têm as dimensões declaradas', () => {
    expect(pngSize('icon-192.png')).toEqual([192, 192, '89504e470d0a1a0a']);
    expect(pngSize('icon-512.png')).toEqual([512, 512, '89504e470d0a1a0a']);
  });
  it('sem service worker registrado no código', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');
    expect(html).not.toMatch(/serviceWorker\.register/);
    expect(html).toContain('/driver.webmanifest');
  });
});
