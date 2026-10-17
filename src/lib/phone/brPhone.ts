/**
 * Telefone/WhatsApp BR. Forma canônica (a mesma gravada no perfil e enviada ao checkout):
 * só dígitos nacionais = DDD + número (10 ou 11 dígitos), sem +55.
 */
export function brPhoneDigits(input: string | null | undefined): string {
  let d = String(input ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2); // +55 / 55
  else if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1); // 0 + DDD (discagem nacional)
  return d;
}

/** Número válido (DDD + 8/9 dígitos) → dígitos canônicos; senão null. */
export function normalizeBRPhone(input: string | null | undefined): string | null {
  const d = brPhoneDigits(input);
  return /^[1-9]{2}\d{8,9}$/.test(d) ? d : null;
}

/** Máscara de digitação: "(11) 99999-0000". Aceita colar com +55. */
export function formatBRPhone(input: string | null | undefined): string {
  const d = brPhoneDigits(input).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
