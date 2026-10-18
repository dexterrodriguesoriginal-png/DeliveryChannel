/** Texto de validade do cupom: "Acaba em 45 min" / "Acaba em 3h 20min" (< 24 h), "Válido até 20/10" (≥ 24 h). */
export function couponCountdownLabel(endsAt: string | null | undefined, nowMs: number = Date.now()): { label: string; urgent: boolean; expired: boolean } | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const diff = end - nowMs;
  if (diff <= 0) return { label: 'Expirado', urgent: false, expired: true };
  const DAY = 24 * 60 * 60 * 1000;
  if (diff < DAY) {
    const totalMin = Math.max(1, Math.ceil(diff / 60000));
    if (totalMin < 60) return { label: `Acaba em ${totalMin} min`, urgent: true, expired: false };
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return { label: m ? `Acaba em ${h}h ${m}min` : `Acaba em ${h}h`, urgent: true, expired: false };
  }
  const d = new Date(end).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  return { label: `Válido até ${d}`, urgent: false, expired: false };
}
