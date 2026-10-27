import type { OwnerNotification } from '../../repositories/dispatchChatRepository';
import { formatBRL } from '../pricing/money';

/** Tempo relativo curto: "agora", "há 2 min", "há 1 h", "ontem", "há 3 d". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} d`;
}

export type NotificationType = 'order' | 'payment' | 'driver' | 'table' | 'chat' | 'default';
export function notificationType(n: Pick<OwnerNotification, 'kind' | 'title'>): NotificationType {
  const title = (n.title || '').toLowerCase();
  if (n.kind === 'ORDER_MESSAGE') return 'chat';
  if (n.kind === 'DRIVER_JOIN_REQUEST') return 'driver';
  if (/pagamento|pix|pago/.test(title)) return 'payment';
  if (/mesa|gar[cç]om|comanda/.test(title)) return 'table';
  if (n.kind === 'ORDER_NEW') return 'order';
  return 'default';
}

export interface OrderBrief { orderNumber: number | string | null; customerName: string | null; total: number | null }

/** Remove duplicação acidental de "Mesa Mesa ..." em títulos ou nomes de notificação. */
export function cleanMesaDuplication(text?: string | null): string {
  return String(text || '').replace(/\b(mesa)(?:\s+mesa)+\b/gi, '$1').trim();
}

/** "#45 · Cliente · R$ 13,00" (partes ausentes são omitidas). */
export function notificationDetail(brief?: OrderBrief | null): string {
  if (!brief) return '';
  const parts: string[] = [];
  if (brief.orderNumber != null && brief.orderNumber !== '') parts.push(`#${brief.orderNumber}`);
  if (brief.customerName) parts.push(cleanMesaDuplication(brief.customerName));
  if (brief.total != null && Number.isFinite(brief.total)) parts.push(formatBRL(brief.total));
  return parts.join(' · ');
}
