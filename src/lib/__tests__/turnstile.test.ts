// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captchaToken, protectedFetch, ANTIBOT_LIMIT_MESSAGE, friendlyAuthProtectionError } from '../turnstile';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });
describe('proteção opcional contra robôs', () => {
  it('sem chave mantém a requisição e não cria widget nem script', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    expect(await captchaToken('login')).toBeUndefined();
    const options = { method: 'POST', body: '{}' };
    await protectedFetch('https://example.test/rest/v1/rpc/process_checkout_atomic_v2', options);
    expect(fetch).toHaveBeenCalledWith('https://example.test/rest/v1/rpc/process_checkout_atomic_v2', options);
    expect(document.querySelector('[aria-label="Verificação de segurança"]')).toBeNull();
    expect(document.querySelector('script[src*="turnstile"]')).toBeNull();
  });
  it('carrega o script só com chave e trata erro de rede em português', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key');
    vi.stubGlobal('turnstile', undefined);
    let script: HTMLScriptElement | undefined;
    vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => { script = node as unknown as HTMLScriptElement; return node; });
    const pending = captchaToken('login');
    expect(script?.src).toContain('challenges.cloudflare.com/turnstile');
    script!.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow('Não foi possível verificar');
  });
  it('traduz bloqueios e falha de captcha do Supabase Auth', () => {
    expect(friendlyAuthProtectionError({status:429,message:'rate limit'})).toBe(ANTIBOT_LIMIT_MESSAGE);
    expect(friendlyAuthProtectionError({code:'captcha_failed',message:'verification failed'})).toMatch('Não foi possível verificar');
  });
  it('permite nova tentativa quando o script não emite load nem error', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key');
    vi.stubGlobal('turnstile', undefined);
    const scripts: HTMLScriptElement[] = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      scripts.push(node as unknown as HTMLScriptElement); return node;
    });
    const first = expect(captchaToken('login')).rejects.toThrow('Não foi possível verificar');
    await vi.advanceTimersByTimeAsync(15000);
    await first;
    expect(document.body.children).toHaveLength(0);
    const retry = captchaToken('login');
    expect(scripts).toHaveLength(2);
    const rejection = expect(retry).rejects.toThrow('Não foi possível verificar');
    scripts[1].dispatchEvent(new Event('error'));
    await rejection;
  });
  it('preserva mensagem de negócio das RPCs legadas com retorno UUID', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    const message = 'AUTH_REQUIRED: Faça login.';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status:400, headers:{'x-antibot-error-base64': btoa(unescape(encodeURIComponent(JSON.stringify({code: 'P0001', message}))))} })));
    const response = await protectedFetch('https://example.test/rest/v1/rpc/process_checkout_atomic');
    expect(await response.json()).toEqual({code: 'P0001', message});
  });
  it('com chave executa widget em português e remove depois de obter token novo', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    let options: any;
    const remove = vi.fn();
    vi.stubGlobal('turnstile', { render: vi.fn((_, opts) => { options = opts; return 'id'; }), execute: vi.fn(() => options.callback('fresh-token')), remove });
    expect(await captchaToken('signup')).toBe('fresh-token');
    expect(options).toMatchObject({ sitekey: 'site-key', action: 'signup', language: 'pt-br', execution: 'execute' });
    expect(remove).toHaveBeenCalledWith('id');
    expect(document.body.children).toHaveLength(0);
  });
  it('envia token só nos checkouts e mantém mesa/totem sem widget', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key');
    let options: any;
    const render = vi.fn((_, opts) => { options = opts; return 'id'; });
    vi.stubGlobal('turnstile', { render, execute: () => options.callback('new-token'), remove: vi.fn() });
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    await protectedFetch('https://example.test/rest/v1/rpc/process_promotional_checkout_atomic', { headers: { Authorization: 'Bearer user' } });
    expect(new Headers(fetch.mock.calls[0][1].headers).get('x-turnstile-token')).toBe('new-token');
    expect(new Headers(fetch.mock.calls[0][1].headers).get('authorization')).toBe('Bearer user');
    render.mockClear();
    for (const rpc of ['create_totem_order', 'totem_activate', 'enter_table', 'submit_round', 'validate_coupon']) await protectedFetch(`https://example.test/rest/v1/rpc/${rpc}`);
    expect(render).not.toHaveBeenCalled();
  });
  it('mostra mensagem de bloqueio amigável em português', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 429 })));
    const response = await protectedFetch('https://example.test/rest/v1/rpc/validate_coupon');
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: 'RATE_LIMITED', message: ANTIBOT_LIMIT_MESSAGE });
  });
  it('falha fechada e limpa widget quando verificação falha', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key');
    let options: any;
    vi.stubGlobal('turnstile', { render: (_: HTMLElement, opts: any) => { options = opts; return 'id'; }, execute: () => options['error-callback'](), remove: vi.fn() });
    await expect(captchaToken('recovery')).rejects.toThrow('Não foi possível verificar');
    expect(document.body.children).toHaveLength(0);
  });
});
