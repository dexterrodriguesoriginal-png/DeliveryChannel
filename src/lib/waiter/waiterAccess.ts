/** Link de entrada do App do Garçom (rota /garcom do mesmo site) e atalhos de compartilhamento. */
export const WAITER_PATH = '/garcom';
const EMAIL_RE = /^[^\s@<>"'()]{1,64}@[^\s@<>"'()]{1,190}\.[A-Za-z]{2,}$/;

export function cleanWaiterEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/** https://site/garcom, com ?email=<convidado> quando o e-mail é válido (só pré-preenche o campo; nunca entra sozinho). */
export function waiterEntryUrl(origin: string, email?: string | null): string {
  const base = `${origin.replace(/\/$/, '')}${WAITER_PATH}`;
  const clean = cleanWaiterEmail(email);
  return clean ? `${base}?email=${encodeURIComponent(clean)}` : base;
}

export function waiterWhatsAppUrl(url: string, storeName?: string | null): string {
  const store = String(storeName || '').trim().slice(0, 60);
  const text = `${store ? `Você foi convidado(a) para a equipe de ${store} como garçom. ` : 'Você foi convidado(a) para a equipe como garçom. '}Abra o link no celular, entre ou crie sua conta com o e-mail do convite e pronto: ${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** ?email= na URL do /garcom (valida; ignora lixo). */
export function readWaiterEmailParam(search: string): string | null {
  try { return cleanWaiterEmail(new URLSearchParams(search).get('email')); } catch { return null; }
}
