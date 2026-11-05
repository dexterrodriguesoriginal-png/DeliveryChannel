export const DEFAULT_HOME_LABEL = 'Cardápio';
export const MAX_HOME_LABEL_LENGTH = 24;

/**
 * Rótulo do bloco "Cardápio" da tela inicial do QR: texto puro.
 * Remove tags/entidades HTML, caracteres de controle e `<` `>`; normaliza espaços; limita a 24 caracteres.
 * Vazio após a limpeza volta ao padrão.
 */
export function sanitizeHomeLabel(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_HOME_LABEL;
  const cleaned = raw
    .replace(/<[^>]*>?/g, '')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, '')
    .replace(/[<>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const limited = Array.from(cleaned).slice(0, MAX_HOME_LABEL_LENGTH).join('').trim();
  return limited || DEFAULT_HOME_LABEL;
}

/** Verdadeiro somente quando o texto já está limpo e dentro do limite (escrita estrita). */
export function isValidHomeLabel(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && Array.from(raw).length <= MAX_HOME_LABEL_LENGTH
    && sanitizeHomeLabel(raw) === raw && raw.trim() === raw;
}
