export const feedbackTypes = {
  sugestao: 'Sugestão',
  elogio: 'Elogio',
  reclamacao: 'Reclamação',
} as const;
export const feedbackAreas = {
  atendimento: 'Atendimento',
  produto: 'Produto',
  entrega: 'Entrega',
  preco: 'Preço',
  app: 'App',
  outro: 'Outro',
} as const;
export type FeedbackInput = {
  type: keyof typeof feedbackTypes;
  message: string;
  area?: keyof typeof feedbackAreas | null;
  rating?: number | null;
};
export type StoreFeedback = Omit<FeedbackInput, 'area' | 'rating'> & {
  area: keyof typeof feedbackAreas | null;
  rating: number | null;
  id: string;
  day: string;
  is_read: boolean;
  archived: boolean;
};
export function validFeedback(value: unknown): value is FeedbackInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as FeedbackInput;
  const length =
    typeof v.message === 'string' ? [...v.message.trim()].length : 0;
  return (
    typeof v.type === 'string' &&
    Object.hasOwn(feedbackTypes, v.type) &&
    length >= 10 &&
    length <= 1000 &&
    (v.area == null ||
      (typeof v.area === 'string' && Object.hasOwn(feedbackAreas, v.area))) &&
    (v.rating == null ||
      (Number.isInteger(v.rating) && v.rating >= 1 && v.rating <= 5))
  );
}
export interface FeedbackStats {
  total: number;
  unread: number;
  average: number | null;
  types: Record<FeedbackInput['type'], number>;
  weeks: Array<{ week: string; total: number; average: number | null }>;
}
export const EMPTY_FEEDBACK_STATS: FeedbackStats = {
  total: 0,
  unread: 0,
  average: null,
  types: { sugestao: 0, elogio: 0, reclamacao: 0 },
  weeks: [],
};
