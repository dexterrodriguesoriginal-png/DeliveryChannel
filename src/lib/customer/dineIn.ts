export type DineInPaymentMethod = 'CAIXA' | 'CARD' | 'CASH' | 'PIX';

export type BillSplitMode = 'ALL' | 'EQUAL' | 'CUSTOM';

export function billSplitAmounts(totalCents: number, mode: BillSplitMode, parts: number, customCents: number): number[] {
  if (mode === 'ALL') return [totalCents];
  if (mode === 'CUSTOM') return Number.isInteger(customCents) && customCents > 0 ? [customCents] : [];
  return splitAmountCents(totalCents, parts);
}

/** Split integer cents evenly; the final share receives any remainder cent. */
export function splitAmountCents(totalCents: number, parts: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new RangeError('O total deve ser um valor inteiro não negativo.');
  if (!Number.isInteger(parts) || parts < 1 || parts > 100) throw new RangeError('Escolha entre 1 e 100 partes.');
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents % parts;
  return Array.from({ length: parts }, (_, index) => base + (index >= parts - remainder ? 1 : 0));
}

export function parseTenderCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!normalized) return null;
  const amount = normalized.includes(',')
    ? Number(normalized.replace(/\./g, '').replace(',', '.'))
    : Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

export function tenderStatus(totalCents: number, tenderCents: number | null): 'missing' | 'insufficient' | 'ok' {
  if (tenderCents === null) return 'missing';
  return tenderCents < totalCents ? 'insufficient' : 'ok';
}
