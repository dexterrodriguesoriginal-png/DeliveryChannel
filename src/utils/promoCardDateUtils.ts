/**
 * Utilitários Oficiais para Agendamento de Cards Promocionais (Data + Horário)
 * Fuso Horário Obrigatório: America/Sao_Paulo (UTC-3)
 */

export const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * Converte data (YYYY-MM-DD) e horário (HH:mm) para string ISO no fuso America/Sao_Paulo.
 * Exemplo: ("2026-10-04", "07:00") -> ISO equivalente a "2026-10-04T07:00:00-03:00"
 */
export function combineDateAndTimeToIso(dateStr: string, timeStr: string = '00:00'): string | null {
  if (!dateStr || !dateStr.trim()) return null;
  const cleanDate = dateStr.trim();
  const cleanTime = timeStr && timeStr.trim() ? timeStr.trim() : '00:00';

  // Validação simples de formato YYYY-MM-DD e HH:mm
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return null;
  const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
  const validTime = timeRegex.test(cleanTime) ? cleanTime.slice(0, 5) : '00:00';

  // Offset fixo padrão de São Paulo (-03:00)
  const fullIsoString = `${cleanDate}T${validTime}:00-03:00`;
  const parsed = new Date(fullIsoString);
  if (isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

/**
 * Extrai data (YYYY-MM-DD) e horário (HH:mm) a partir de um ISO string,
 * projetados no fuso horário America/Sao_Paulo.
 */
export function extractDateAndTimeFromIso(isoString?: string | null): { date: string; time: string } {
  if (!isoString) {
    return { date: '', time: '' };
  }

  const dateObj = new Date(isoString);
  if (isNaN(dateObj.getTime())) {
    return { date: '', time: '' };
  }

  // en-CA produz YYYY-MM-DD
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dateObj);

  // pt-BR com 2 dígitos para hora e minuto
  const timePart = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dateObj);

  return { date: datePart, time: timePart };
}

/**
 * Formata data e horário no padrão brasileiro: "05/10/2026 às 07:00"
 */
export function formatPromoDateTimeBr(isoString?: string | null): string {
  if (!isoString) return 'Não programado';
  const dateObj = new Date(isoString);
  if (isNaN(dateObj.getTime())) return 'Data inválida';

  const dateFormatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(dateObj);

  const timeFormatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dateObj);

  return `${dateFormatted} às ${timeFormatted}`;
}

/**
 * Calcula o status real do card promocional baseado no horário atual de São Paulo:
 * - PAUSED (🔴 Desativado): se isActive for false
 * - SCHEDULED (🟡 Agendado): se a data/hora atual for anterior ao início
 * - EXPIRED (⚪ Expirado): se a data/hora de término existir e for anterior à atual
 * - ACTIVE (🟢 Ativo): dentro do período programado ou sem data de término
 */
export function calculatePromoCardStatus(card: {
  isActive: boolean;
  startDate?: string | null;
  endDate?: string | null;
  startAt?: string | null;
  endAt?: string | null;
}): 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'PAUSED' {
  if (!card.isActive) {
    return 'PAUSED';
  }

  const nowMs = Date.now();
  const startStr = card.startAt || card.startDate;
  const endStr = card.endAt || card.endDate;

  if (startStr) {
    const startMs = new Date(startStr).getTime();
    if (!isNaN(startMs) && startMs > nowMs) {
      return 'SCHEDULED';
    }
  }

  if (endStr) {
    const endMs = new Date(endStr).getTime();
    if (!isNaN(endMs) && endMs < nowMs) {
      return 'EXPIRED';
    }
  }

  return 'ACTIVE';
}

/**
 * Validação rigorosa de agendamento (tanto para o frontend quanto para o backend)
 */
export function validatePromoSchedule(
  startIso: string | null,
  endIso: string | null,
  noEndDate: boolean
): { isValid: boolean; errorMessage?: string } {
  if (!startIso) {
    return { isValid: false, errorMessage: 'Informe a data e o horário de início da exibição.' };
  }

  const startMs = new Date(startIso).getTime();
  if (isNaN(startMs)) {
    return { isValid: false, errorMessage: 'A data e horário de início são inválidos.' };
  }

  if (!noEndDate) {
    if (!endIso) {
      return { isValid: false, errorMessage: 'Informe a data e o horário de término ou marque "Sem data de término".' };
    }

    const endMs = new Date(endIso).getTime();
    if (isNaN(endMs)) {
      return { isValid: false, errorMessage: 'A data e horário de término são inválidos.' };
    }

    if (startMs >= endMs) {
      return {
        isValid: false,
        errorMessage: 'O horário de início não pode ser igual ou posterior ao horário de término.',
      };
    }
  }

  return { isValid: true };
}

/**
 * Metadados visuais de status para cards e resumos
 */
export function getPromoStatusMeta(status: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'PAUSED') {
  switch (status) {
    case 'SCHEDULED':
      return {
        key: 'SCHEDULED' as const,
        label: 'Agendado',
        emoji: '🟡',
        fullLabel: '🟡 Agendado',
        badgeClass: 'bg-amber-500 text-white border-amber-400',
        cardBorderClass: 'border-amber-200 bg-amber-50/40 text-amber-900',
        summaryText: 'O card aparecerá automaticamente na vitrine no horário programado.',
      };
    case 'EXPIRED':
      return {
        key: 'EXPIRED' as const,
        label: 'Expirado',
        emoji: '⚪',
        fullLabel: '⚪ Expirado',
        badgeClass: 'bg-gray-500 text-white border-gray-400',
        cardBorderClass: 'border-gray-200 bg-gray-50 text-gray-800',
        summaryText: 'O período de exibição deste card encerrou. Ele não está mais visível aos clientes.',
      };
    case 'PAUSED':
      return {
        key: 'PAUSED' as const,
        label: 'Desativado',
        emoji: '🔴',
        fullLabel: '🔴 Desativado',
        badgeClass: 'bg-rose-500 text-white border-rose-400',
        cardBorderClass: 'border-rose-200 bg-rose-50/40 text-rose-900',
        summaryText: 'Card pausado manualmente. Ele não aparecerá na vitrine enquanto estiver desativado.',
      };
    case 'ACTIVE':
    default:
      return {
        key: 'ACTIVE' as const,
        label: 'Ativo',
        emoji: '🟢',
        fullLabel: '🟢 Ativo',
        badgeClass: 'bg-emerald-500 text-white border-emerald-400',
        cardBorderClass: 'border-emerald-200 bg-emerald-50/40 text-emerald-900',
        summaryText: 'O card está ativo e participando da rotação do carrossel na vitrine.',
      };
  }
}
