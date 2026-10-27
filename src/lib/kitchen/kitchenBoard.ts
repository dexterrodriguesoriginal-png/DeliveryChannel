import { formatTableLabel } from '../orders/labels';

/** 19/10: regras puras da Tela da Cozinha (sem preço nem dado pessoal além do 1º nome na retirada). */
export type KitchenStatus = 'CONFIRMED' | 'PREPARING';
export interface KitchenItem {
  order_item_id: string;
  product_name: string;
  quantity: number;
  unit?: string | null;
  notes?: string | null;
  station?: 'KITCHEN' | 'BAR' | null;
  options?: Array<{ group_name: string; option_name: string; qty: number; fraction?: number | null }>;
}
export interface KitchenOrder {
  awaiting_online_payment?: boolean;
  order_id: string; order_number: number; status: KitchenStatus; fulfillment_type: 'DELIVERY' | 'PICKUP' | 'DINE_IN';
  created_at: string; notes?: string | null; customer_first_name?: string | null; pickup_code?: string | null;
  table_label?: string | null; round_no?: number | null;
  confirmed_at?: string | null; preparing_at?: string | null; items: KitchenItem[];
}
export type KitchenStationFilter = 'ALL' | 'KITCHEN' | 'BAR';

/** Filtra linhas e remove os pedidos sem itens para a estação escolhida. */
export function filterKitchenOrders(orders: readonly KitchenOrder[], station: KitchenStationFilter): KitchenOrder[] {
  if (station === 'ALL') return [...orders];
  return orders.flatMap(order => {
    const items = order.items.filter(item => item.station === station);
    return items.length ? [{ ...order, items }] : [];
  });
}

/** Únicas transições que a cozinha pode fazer. */
export function kitchenNextAction(status: string): { to: 'PREPARING' | 'READY'; label: string } | null {
  if (status === 'CONFIRMED') return { to: 'PREPARING', label: 'Iniciar preparo' };
  if (status === 'PREPARING') return { to: 'READY', label: 'Pronto' };
  return null;
}

export function kitchenColumns(orders: readonly KitchenOrder[]) {
  const by = (s: string) => orders.filter(o => o.status === s).sort((a, b) => (a.confirmed_at || a.created_at).localeCompare(b.confirmed_at || b.created_at));
  return { toDo: by('CONFIRMED'), doing: by('PREPARING') };
}

/** Minutos desde que o pedido entrou na etapa atual. */
export function minutesInStage(o: Pick<KitchenOrder, 'status' | 'created_at' | 'confirmed_at' | 'preparing_at'>, now = Date.now()): number {
  const ref = o.status === 'PREPARING' ? (o.preparing_at || o.confirmed_at || o.created_at) : (o.confirmed_at || o.created_at);
  return Math.max(0, Math.floor((now - new Date(ref).getTime()) / 60000));
}
export function lateLevel(min: number): 'ok' | 'warn' | 'late' { return min >= 20 ? 'late' : min >= 10 ? 'warn' : 'ok'; }

export function kitchenOrderLabel(o: Pick<KitchenOrder, 'fulfillment_type' | 'customer_first_name' | 'table_label' | 'round_no'>): string {
  if (o.fulfillment_type === 'DINE_IN') {
    const guest = o.customer_first_name ? ` · ${o.customer_first_name}` : '';
    const round = o.round_no ? ` · rodada ${o.round_no}` : '';
    return `${formatTableLabel(o.table_label, 'Mesa —')}${guest}${round}`;
  }
  return o.fulfillment_type === 'PICKUP' ? `Retirada${o.customer_first_name ? ` · ${o.customer_first_name}` : ''}` : 'Entrega';
}

/** Código de pareamento: 8 caracteres, exibido XXXX-XXXX. */
export function normalizePairCode(raw: string): string { return (raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8); }
export function formatPairCode(raw: string): string { const c = normalizePairCode(raw); return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c; }
export function pairCodeFromHash(hash: string): string {
  const m = /(?:^|[#&])c=([^&]+)/.exec(hash || ''); return m ? normalizePairCode(decodeURIComponent(m[1])) : '';
}
export function pairUrl(origin: string, code: string): string { return `${origin.replace(/\/$/, '')}/cozinha/parear#c=${normalizePairCode(code)}`; }
export function secondsLeft(expiresAt: string, now = Date.now()): number { return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000)); }

/** Banco sem a migration 2300: a função some e a tela se esconde. */
export function isKitchenMissing(err: any): boolean {
  const c = err?.code || ''; const m = String(err?.message || '');
  return c === 'PGRST202' || c === 'PGRST205' || c === '42P01' || c === '42883' || /Could not find the function/i.test(m);
}

const MSG: Record<string, string> = {
  PAIRING_CODE_INVALID: 'Código inválido ou expirado. Peça um novo código no painel.',
  ALREADY_PAIRED: 'Este aparelho já está conectado a uma loja.',
  KITCHEN_DEVICE_REVOKED: 'Este aparelho foi desconectado pela loja.',
  NOT_PAIRED: 'Aparelho não conectado.',
  KITCHEN_DISABLED: 'A Tela da Cozinha está desligada nesta loja.',
  KITCHEN_LOCKED: 'Digite o PIN para destravar.',
  PIN_INVALID: 'PIN incorreto.',
  PIN_FORMAT: 'O PIN deve ter 4 números.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde alguns minutos.',
  TOO_MANY_CODES: 'Já existem 5 códigos válidos. Aguarde expirarem.',
  TRANSITION_FORBIDDEN: 'A cozinha não pode fazer essa mudança.',
  ORDER_NOT_FOUND: 'Pedido não encontrado.',
  USE_STAFF_LOGIN: 'Você já está logado com uma conta. Abra a Tela da Cozinha pelo painel.',
  FORBIDDEN: 'Sem permissão.',
  ANONYMOUS_FORBIDDEN: 'Entre com sua conta para continuar.',
};
export function kitchenErrorCode(err: any): string { const m = /^([A-Z_]+):/.exec(String(err?.message || '')); return m ? m[1] : ''; }
export function kitchenErrorMessage(err: any): string {
  if (isKitchenMissing(err)) return 'A Tela da Cozinha ainda não está disponível.';
  if (/anonymous.*disabled|Anonymous sign-ins are disabled/i.test(String(err?.message || ''))) return 'Pareamento indisponível: o login de aparelhos ainda não foi liberado. Avise o dono da loja.';
  return MSG[kitchenErrorCode(err)] || 'Não foi possível concluir. Tente de novo.';
}

/** Pedidos que viraram READY desde a última leitura (a 1ª leitura não alerta). */
export function newReadyIds(prev: ReadonlySet<string> | null, orders: readonly { id: string; status: string }[]): string[] {
  if (!prev) return [];
  return orders.filter(o => o.status === 'READY' && !prev.has(o.id)).map(o => o.id);
}
