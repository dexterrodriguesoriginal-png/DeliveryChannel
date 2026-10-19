/** 19/10: fila de chegada da retirada (migration 20261019002100). Funções puras. */

/** Token da loja a partir do QR lido (URL .../chegada/ABC234) ou do código digitado. */
export function parseStoreToken(raw: string | null | undefined): string | null {
  const s = String(raw || '').toUpperCase();
  const fromUrl = s.match(/CHEGADA\/([A-Z2-9]{6})/);
  if (fromUrl) return fromUrl[1];
  const clean = s.replace(/[^A-Z0-9]/g, '');
  return /^[A-Z2-9]{6}$/.test(clean) ? clean : null;
}

export function arrivalQrUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/chegada/${token}`;
}

/** Banco sem a migration (ex.: produção antes de aplicar): esconder a fila, nunca quebrar a tela. */
export function isArrivalFeatureMissing(err: unknown): boolean {
  const e = err as any;
  const code = String(e?.code || '');
  const m = String(e?.message || e || '');
  return ['PGRST202', 'PGRST205', '42883', '42P01'].includes(code)
    || /could not find the (function|table)|does not exist|schema cache/i.test(m);
}

export function arrivalErrorMessage(err: unknown): string {
  const m = String((err as any)?.message ?? err ?? '');
  if (m.includes('WRONG_STORE')) return 'Este QR Code não é da loja do seu pedido.';
  if (m.includes('NOT_PICKUP')) return 'Este pedido é de entrega, não de retirada.';
  if (m.includes('ORDER_CLOSED')) return 'Este pedido já foi encerrado.';
  if (m.includes('RATE_LIMITED')) return 'Muitas tentativas. Aguarde um minuto.';
  if (m.includes('CODE_LOCKED')) return 'Código bloqueado após 5 tentativas. Conclua informando o motivo.';
  if (m.includes('INVALID_STATE')) return 'Marque o pedido como pronto antes.';
  if (m.includes('ORDER_NOT_FOUND')) return 'Pedido não encontrado.';
  if (m.includes('FORBIDDEN')) return 'Seu perfil não pode fazer isso.';
  return m.replace(/^[A-Z_]+:\s*/, '') || 'Não foi possível concluir. Tente novamente.';
}

export function firstName(name: string | null | undefined): string {
  return (String(name || '').trim().split(/\s+/)[0]) || 'Cliente';
}

export function minutesSince(iso: string | null | undefined, now = Date.now()): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0;
}

export function arrivalLine(name: string, arrivedAt: string, now = Date.now()): string {
  return `${firstName(name)} chegou, aguardando há ${minutesSince(arrivedAt, now)} min`;
}

export interface ArrivalRow {
  order_id: string; pickup_code: string; arrived_at: string | null; called_at: string | null; closed_at?: string | null;
}

/** Fila: só quem chegou e não retirou, em ordem de chegada (1 = próximo). */
export function arrivalQueue<T extends ArrivalRow>(rows: T[]): (T & { position: number })[] {
  return rows
    .filter(r => r.arrived_at && !r.closed_at)
    .sort((a, b) => (a.arrived_at! < b.arrived_at! ? -1 : a.arrived_at! > b.arrived_at! ? 1 : a.order_id < b.order_id ? -1 : 1))
    .map((r, i) => ({ ...r, position: i + 1 }));
}

/** Códigos chamados para a TV (/chamada): mais recente primeiro, só os últimos 30 min. */
export function calledCodes(rows: ArrivalRow[], now = Date.now(), windowMin = 30): string[] {
  return rows
    .filter(r => r.called_at && !r.closed_at && now - new Date(r.called_at).getTime() <= windowMin * 60000)
    .sort((a, b) => (a.called_at! < b.called_at! ? 1 : -1))
    .map(r => r.pickup_code);
}
