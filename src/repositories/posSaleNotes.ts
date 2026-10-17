/** Observação do PDV (ex.: troco) enviada como p_notes (migration 1400). Vazia → omitida; máx. 500. */
export function posSaleNotes(notes?: string | null): string | undefined {
  const t = (notes ?? '').trim();
  return t ? t.slice(0, 500) : undefined;
}

/** PostgREST sem a assinatura pedida (PGRST202) — ex.: banco sem a 1400. */
export function isMissingRpcSignature(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202';
}
