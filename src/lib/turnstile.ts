/** Tokens novos por operação; nenhum segredo do Turnstile pertence ao navegador. */
export const ANTIBOT_LIMIT_MESSAGE = 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
const CAPTCHA_MESSAGE = 'Não foi possível verificar a segurança. Tente novamente.';
export function friendlyAuthProtectionError(error: { status?: number; code?: string; message: string }): string {
  if (error.status === 429) return ANTIBOT_LIMIT_MESSAGE;
  if (error.code === 'captcha_failed' || /captcha/i.test(error.message)) return CAPTCHA_MESSAGE;
  return error.message;
}
export const turnstileSiteKey = () => String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
type WidgetAPI = { render: (element: HTMLElement, options: Record<string, unknown>) => string; execute: (id: string) => void; remove: (id: string) => void };
let loading: Promise<WidgetAPI> | undefined;
function loadWidget(): Promise<WidgetAPI> {
  const existing = (window as any).turnstile as WidgetAPI | undefined;
  if (existing) return Promise.resolve(existing);
  if (!loading) loading = new Promise<WidgetAPI>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => (window as any).turnstile ? resolve((window as any).turnstile) : reject(new Error(CAPTCHA_MESSAGE));
    script.onerror = () => { script.remove(); reject(new Error(CAPTCHA_MESSAGE)); };
    document.head.appendChild(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading!;
}
export async function captchaToken(action: 'login' | 'signup' | 'recovery' | 'checkout'): Promise<string | undefined> {
  const sitekey = turnstileSiteKey();
  if (!sitekey) return undefined;
  return new Promise((resolve, reject) => {
    const element = document.createElement('div');
    element.setAttribute('aria-label', 'Verificação de segurança');
    document.body.appendChild(element);
    let api: WidgetAPI | undefined, id: string | undefined, settled = false;
    const finish = (token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (id !== undefined) api?.remove(id);
      element.remove();
      token ? resolve(token) : reject(new Error(CAPTCHA_MESSAGE));
    };
    const timeout = setTimeout(() => finish(), 30000);
    loadWidget().then(widget => {
      if (settled) return;
      api = widget;
      id = api.render(element, { sitekey, action, execution: 'execute', appearance: 'interaction-only', language: 'pt-br', callback: (token: string) => finish(token), 'error-callback': () => finish(), 'expired-callback': () => finish(), 'timeout-callback': () => finish() });
      api.execute(id);
    }).catch(() => finish());
  });
}
/** Mesa e totem têm RPCs próprias: nunca passam por esta lista. */
export async function protectedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const operation = /\/rest\/v1\/rpc\/([^/?]+)/.exec(url)?.[1];
  const checkout = ['process_checkout_atomic', 'process_checkout_atomic_v2', 'process_checkout_atomic_v3', 'process_promotional_checkout_atomic'].includes(operation || '');
  let options = init;
  if (checkout && turnstileSiteKey()) {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('x-turnstile-token', (await captchaToken('checkout'))!);
    options = { ...init, headers };
  }
  const response = await fetch(input, options);
  if (response.status === 429 && operation) {
    return new Response(JSON.stringify({ code: 'RATE_LIMITED', message: ANTIBOT_LIMIT_MESSAGE }), { status: 429, headers: { 'Content-Type': 'application/json' } });
  }
  const serverMessage = response.headers.get('x-antibot-error-base64');
  if (!response.ok && operation && serverMessage) {
    return new Response(new TextDecoder().decode(Uint8Array.from(atob(serverMessage), char => char.charCodeAt(0))), { status: response.status, headers: { 'Content-Type': 'application/json' } });
  }
  return response;
}
