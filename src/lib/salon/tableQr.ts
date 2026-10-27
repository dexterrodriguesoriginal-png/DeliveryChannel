// Table QR helpers: name rule, link format, token validation, batch naming. Pure, no network.

export const TABLE_NAME_MIN = 3;
export const TABLE_NAME_MAX = 15;

/** Returns an error message or null. Same rule as the DB trigger on dining_tables.label (3–15 after trimming). */
export function validateTableName(name: string, others: string[] = []): string | null {
  const value = name.trim();
  if (value.length < TABLE_NAME_MIN) return `O nome precisa ter pelo menos ${TABLE_NAME_MIN} caracteres.`;
  if (value.length > TABLE_NAME_MAX) return `O nome pode ter no máximo ${TABLE_NAME_MAX} caracteres.`;
  if (/[<>]/.test(value)) return 'Use apenas letras, números e espaços.';
  const key = value.toLocaleLowerCase('pt-BR');
  if (others.some(other => other.trim().toLocaleLowerCase('pt-BR') === key)) return 'Já existe uma mesa com esse nome.';
  return null;
}

const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
export function isValidTableToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
/** Link printed on the QR: /app/<slug>?mesa=<token>. Empty string when slug/token are unusable (never builds a broken link). */
export function tableAppUrl(origin: string, slug: string, token: string): string {
  const cleanSlug = slug.trim().toLowerCase();
  if (!SLUG.test(cleanSlug) || !isValidTableToken(token)) return '';
  return `${origin.replace(/\/+$/, '')}/app/${cleanSlug}?mesa=${encodeURIComponent(token)}`;
}

/** Reads ?mesa= from a location.search string; only well-formed opaque tokens are accepted. */
export function readMesaParam(search: string): string | null {
  try {
    const value = new URLSearchParams(search).get('mesa');
    return isValidTableToken(value) ? value : null;
  } catch { return null; }
}

export function nextTableName(existing: string[], prefix = 'Mesa'): string {
  const used = new Set(existing.map(name => name.trim().toLocaleLowerCase('pt-BR')));
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${prefix} ${String(n).padStart(2, '0')}`;
    if (!used.has(candidate.toLocaleLowerCase('pt-BR'))) return candidate;
  }
  return `${prefix} ${Date.now() % 1000}`;
}

/** "Mesa 01" … "Mesa 20", skipping names that already exist. */
export function bulkTableNames(count: number, existing: string[], prefix = 'Mesa'): string[] {
  const used = new Set(existing.map(name => name.trim().toLocaleLowerCase('pt-BR')));
  const out: string[] = [];
  for (let n = 1; out.length < count && n < 1000; n += 1) {
    const name = `${prefix} ${String(n).padStart(2, '0')}`;
    if (!used.has(name.toLocaleLowerCase('pt-BR'))) out.push(name);
  }
  return out;
}

export function qrFileName(label: string, slug: string): string {
  const safe = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mesa';
  return `qr-${slug.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'loja'}-${safe}.png`;
}

/** Friendly pt-BR message for errors raised by the table-join / round RPCs. */
export function friendlyTableError(message: string): string {
  if (/QR_PAUSED/i.test(message)) return 'O pedido pelo QR está pausado agora. Chame um atendente.';
  if (/TAB_PAYMENT_IN_PROGRESS/i.test(message)) return 'A conta está sendo paga. Chame um atendente para novos pedidos.';
  if (/RATE_LIMITED/i.test(message)) return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos ou chame um atendente.';
  if (/INVALID_TABLE_NAME/i.test(message)) return `O nome da mesa deve ter de ${TABLE_NAME_MIN} a ${TABLE_NAME_MAX} caracteres.`;
  return message;
}
