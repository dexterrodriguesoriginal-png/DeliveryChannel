/** Rótulo da taxa de entrega no cabeçalho da vitrine (independe do carrinho). */
export function storeDeliveryLabel(settings: { deliveryFee?: number | null; freeDeliveryThreshold?: number | null }): string {
  const fee = Number(settings.deliveryFee) || 0;
  if (fee <= 0) return 'Entrega Grátis';
  const brl = (v: number) => v.toFixed(2).replace('.', ',');
  const thr = Number(settings.freeDeliveryThreshold) || 0;
  return thr > 0 ? `Entrega R$ ${brl(fee)} (grátis acima de R$ ${brl(thr)})` : `Entrega R$ ${brl(fee)}`;
}

/** Converte valor monetário digitado em pt-BR ("7,00", "1.234,50", "7.5") em número; inválido → NaN. */
export function parseBRMoney(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
