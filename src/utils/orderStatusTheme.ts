import { OrderStatus } from '../types';

export interface StatusTheme {
  bg: string;
  drawerBg: string;
  border: string;
  accent: string;
  text: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  label: string;
  buttonBg: string;
  buttonHover: string;
  buttonText: string;
  buttonLabel: string;
}

// 19/10 (painel do dono): cores únicas por status em todo o painel —
// Novo = azul, Confirmado = índigo, Em preparo = âmbar, Pronto = verde, Em rota = violeta,
// Entregue/Cancelado = neutros, Atrasado = vermelho. Toda ação principal usa o verde da marca (#15803D).
export const BRAND_ACTION = { bg: '#15803D', hover: '#166534', text: '#FFFFFF' };

export const ORDER_STATUS_THEME: Record<OrderStatus, StatusTheme> = {
  PENDING: {
    bg: '#EFF6FF',
    drawerBg: '#F3F8FF',
    border: '#93C5FD',
    accent: '#2563EB',
    text: '#1E40AF',
    badgeBg: '#DBEAFE',
    badgeText: '#1D4ED8',
    badgeBorder: '#93C5FD',
    label: 'NOVO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Aceitar Pedido',
  },
  CONFIRMED: {
    bg: '#EEF2FF',
    drawerBg: '#F3F5FF',
    border: '#C7D2FE',
    accent: '#4F46E5',
    text: '#3730A3',
    badgeBg: '#E0E7FF',
    badgeText: '#4338CA',
    badgeBorder: '#A5B4FC',
    label: 'CONFIRMADO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Iniciar Preparo',
  },
  PREPARING: {
    bg: '#FFFBEB',
    drawerBg: '#FFFCF0',
    border: '#FCD34D',
    accent: '#D97706',
    text: '#92400E',
    badgeBg: '#FEF3C7',
    badgeText: '#B45309',
    badgeBorder: '#FCD34D',
    label: 'EM PREPARO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Marcar como Pronto',
  },
  READY: {
    bg: '#F0FDF4',
    drawerBg: '#F3FDF6',
    border: '#86EFAC',
    accent: '#16A34A',
    text: '#166534',
    badgeBg: '#DCFCE7',
    badgeText: '#15803D',
    badgeBorder: '#86EFAC',
    label: 'PRONTO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Despachar Pedido',
  },
  WAITING_FOR_DRIVER: {
    bg: '#F0FDF4',
    drawerBg: '#F3FDF6',
    border: '#86EFAC',
    accent: '#16A34A',
    text: '#166534',
    badgeBg: '#DCFCE7',
    badgeText: '#15803D',
    badgeBorder: '#86EFAC',
    label: 'PRONTO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Despachar Pedido',
  },
  OUT_FOR_DELIVERY: {
    bg: '#F5F3FF',
    drawerBg: '#F7F5FF',
    border: '#C4B5FD',
    accent: '#7C3AED',
    text: '#5B21B6',
    badgeBg: '#EDE9FE',
    badgeText: '#6D28D9',
    badgeBorder: '#C4B5FD',
    label: 'EM ROTA',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Marcar como Entregue',
  },
  DELIVERED: {
    bg: '#F8FAFC',
    drawerBg: '#F8FAFC',
    border: '#CBD5E1',
    accent: '#64748B',
    text: '#334155',
    badgeBg: '#F1F5F9',
    badgeText: '#334155',
    badgeBorder: '#E2E8F0',
    label: 'ENTREGUE',
    buttonBg: '#E2E8F0',
    buttonHover: '#CBD5E1',
    buttonText: '#334155',
    buttonLabel: 'Ver Detalhes',
  },
  CANCELLED: {
    bg: '#FAFAF9',
    drawerBg: '#FAFAF9',
    border: '#D6D3D1',
    accent: '#78716C',
    text: '#57534E',
    badgeBg: '#F5F5F4',
    badgeText: '#57534E',
    badgeBorder: '#D6D3D1',
    label: 'CANCELADO',
    buttonBg: '#E2E8F0',
    buttonHover: '#CBD5E1',
    buttonText: '#334155',
    buttonLabel: 'Ver Detalhes',
  },
};

// Variação para pedidos EM PREPARO atrasados (ultrapassou o limite operacional, ex.: 25 min) — vermelho
export const DELAYED_PREPARING_THEME: StatusTheme = {
    bg: '#FEF2F2',
    drawerBg: '#FFF5F5',
    border: '#FCA5A5',
    accent: '#DC2626',
    text: '#991B1B',
    badgeBg: '#FEE2E2',
    badgeText: '#B91C1C',
    badgeBorder: '#F87171',
    label: 'ATRASADO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Marcar como Pronto',
};

// Verifica se um pedido em preparo está atrasado (padrão: 25 minutos)
export function checkIsPreparingDelayed(createdAt: string | Date, status: OrderStatus, maxMinutes = 25): boolean {
  if (status !== 'PREPARING') return false;
  const elapsedMinutes = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60);
  return elapsedMinutes >= maxMinutes;
}


/**
 * 19/10: estilo do botão de ação do pedido. Em PRONTO com entrega, "Chamar motoboy" é a ação principal
 * (verde); "Despachar Pedido" (escolher um entregador) vira secundário, com contorno.
 */
export function orderActionButtonStyle(
  theme: StatusTheme,
  order: { status: OrderStatus; fulfillmentType?: string },
): { backgroundColor: string; color: string; border?: string } {
  if (order.status === 'READY' && order.fulfillmentType !== 'PICKUP') {
    return { backgroundColor: '#FFFFFF', color: '#166534', border: '1px solid #86EFAC' };
  }
  return { backgroundColor: theme.buttonBg, color: theme.buttonText };
}
