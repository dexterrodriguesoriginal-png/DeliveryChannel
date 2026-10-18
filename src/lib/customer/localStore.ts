/**
 * Dados do cliente guardados NO APARELHO (localStorage), separados por usuário (auth uid ou "anon").
 * Endereços salvos, favoritos, preferências de notificação, histórico de busca e leitura de notificações.
 * Nada aqui é fonte de verdade de pedido/preço: o servidor sempre revalida.
 */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const memory = new Map<string, string>();
const memoryKV: KV = {
  getItem: k => (memory.has(k) ? (memory.get(k) as string) : null),
  setItem: (k, v) => void memory.set(k, v),
  removeItem: k => void memory.delete(k),
};

export function defaultKV(): KV {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const t = '__dc_probe__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      return window.localStorage;
    }
  } catch {
    // modo privado / bloqueado
  }
  return memoryKV;
}

export const customerKey = (userId: string | null | undefined, name: string) => `dc_cust:${userId || 'anon'}:${name}`;

export function readJSON<T>(kv: KV, key: string, fallback: T): T {
  try {
    const raw = kv.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(kv: KV, key: string, value: unknown): void {
  try {
    kv.setItem(key, JSON.stringify(value));
  } catch {
    // cota cheia: ignora
  }
}

// ----------------------------------------------------------------------------- Endereços salvos
export type AddressLabel = 'Casa' | 'Trabalho' | 'Outro';

export interface SavedAddress {
  id: string;
  label: AddressLabel;
  /** Apelido quando label = Outro (ex.: "Casa da mãe"). */
  nickname?: string;
  street: string;
  number: string;
  complement?: string;
  reference?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  /** "sem número" marcado. */
  noNumber?: boolean;
  updatedAt: string;
}

interface AddressBook { selectedId: string | null; items: SavedAddress[] }

const ADDR = 'addresses';
const MAX_ADDRESSES = 20;

export function loadAddressBook(kv: KV, userId: string | null | undefined): AddressBook {
  const b = readJSON<AddressBook>(kv, customerKey(userId, ADDR), { selectedId: null, items: [] });
  const items = Array.isArray(b.items) ? b.items.filter(a => a && typeof a.id === 'string' && typeof a.street === 'string') : [];
  const selectedId = items.some(a => a.id === b.selectedId) ? b.selectedId : items[0]?.id ?? null;
  return { selectedId, items };
}

function saveBook(kv: KV, userId: string | null | undefined, b: AddressBook) {
  writeJSON(kv, customerKey(userId, ADDR), b);
}

export function newAddressId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `addr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Insere ou atualiza (mesmo id) e marca como selecionado. */
export function upsertAddress(kv: KV, userId: string | null | undefined, a: SavedAddress): AddressBook {
  const b = loadAddressBook(kv, userId);
  const rest = b.items.filter(x => x.id !== a.id);
  const next = { selectedId: a.id, items: [a, ...rest].slice(0, MAX_ADDRESSES) };
  saveBook(kv, userId, next);
  return next;
}

export function removeAddress(kv: KV, userId: string | null | undefined, id: string): AddressBook {
  const b = loadAddressBook(kv, userId);
  const items = b.items.filter(x => x.id !== id);
  const next = { selectedId: b.selectedId === id ? items[0]?.id ?? null : b.selectedId, items };
  saveBook(kv, userId, next);
  return next;
}

export function selectAddress(kv: KV, userId: string | null | undefined, id: string): AddressBook {
  const b = loadAddressBook(kv, userId);
  if (!b.items.some(x => x.id === id)) return b;
  const next = { ...b, selectedId: id };
  saveBook(kv, userId, next);
  return next;
}

export function addressTitle(a: SavedAddress): string {
  return `${a.street}${a.noNumber ? ', s/n' : a.number ? `, ${a.number}` : ''}`;
}

export function addressSubtitle(a: SavedAddress): string {
  return [a.complement, a.neighborhood, [a.city, a.state].filter(Boolean).join(' - ')].filter(Boolean).join(', ');
}

// ----------------------------------------------------------------------------- Favoritos (por loja)
export function loadFavorites(kv: KV, userId: string | null | undefined, tenantId: string): string[] {
  const v = readJSON<string[]>(kv, customerKey(userId, `fav:${tenantId}`), []);
  return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
}

export function toggleFavorite(kv: KV, userId: string | null | undefined, tenantId: string, productId: string): string[] {
  const cur = loadFavorites(kv, userId, tenantId);
  const next = cur.includes(productId) ? cur.filter(x => x !== productId) : [productId, ...cur];
  writeJSON(kv, customerKey(userId, `fav:${tenantId}`), next);
  return next;
}

// ----------------------------------------------------------------------------- Histórico de busca
const MAX_SEARCH = 8;
export function loadSearchHistory(kv: KV, userId: string | null | undefined): string[] {
  const v = readJSON<string[]>(kv, customerKey(userId, 'search'), []);
  return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, MAX_SEARCH) : [];
}
export function pushSearchHistory(kv: KV, userId: string | null | undefined, term: string): string[] {
  const t = term.trim();
  if (t.length < 2) return loadSearchHistory(kv, userId);
  const cur = loadSearchHistory(kv, userId).filter(x => x.toLowerCase() !== t.toLowerCase());
  const next = [t, ...cur].slice(0, MAX_SEARCH);
  writeJSON(kv, customerKey(userId, 'search'), next);
  return next;
}
export function clearSearchHistory(kv: KV, userId: string | null | undefined): void {
  kv.removeItem(customerKey(userId, 'search'));
}

// ----------------------------------------------------------------------------- Preferências de notificação
export interface NotificationPrefs {
  orderStatus: boolean;
  promotions: boolean;
  whatsapp: boolean;
}
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { orderStatus: true, promotions: true, whatsapp: true };

export function loadNotificationPrefs(kv: KV, userId: string | null | undefined): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...readJSON<Partial<NotificationPrefs>>(kv, customerKey(userId, 'notif_prefs'), {}) };
}
export function saveNotificationPrefs(kv: KV, userId: string | null | undefined, p: NotificationPrefs): void {
  writeJSON(kv, customerKey(userId, 'notif_prefs'), p);
}

// ----------------------------------------------------------------------------- Convite de push (soft prompt)
const PUSH_PROMPT = 'dc_push_prompt';
/** Não insiste: depois de "Não ativar agora", só pergunta de novo após 7 dias. */
export function shouldShowPushPrompt(kv: KV, permission: string | null, nowMs = Date.now()): boolean {
  if (permission !== 'default') return false;
  const last = Number(kv.getItem(PUSH_PROMPT) || 0);
  return !last || nowMs - last > 7 * 864e5;
}
export function markPushPromptShown(kv: KV, nowMs = Date.now()): void {
  try {
    kv.setItem(PUSH_PROMPT, String(nowMs));
  } catch {
    // ignore
  }
}

// ----------------------------------------------------------------------------- Leitura das notificações
export function loadNotificationsSeenAt(kv: KV, userId: string | null | undefined, tenantId: string): number {
  return Number(kv.getItem(customerKey(userId, `notif_seen:${tenantId}`)) || 0);
}
export function markNotificationsSeen(kv: KV, userId: string | null | undefined, tenantId: string, atMs = Date.now()): void {
  try {
    kv.setItem(customerKey(userId, `notif_seen:${tenantId}`), String(atMs));
  } catch {
    // ignore
  }
}
