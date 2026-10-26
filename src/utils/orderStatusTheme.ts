import { prepLimitMinutes } from '../lib/orders/sla';
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

// 19/10 (padrão KDS): Novo = âmbar, Confirmado = âmbar claro, Em preparo = azul, Pronto = verde,
// Em rota = ciano, Entregue = cinza, Cancelado = vermelho suave, Atrasado = vermelho forte. Toda ação principal usa o verde da marca (#15803D).
export const BRAND_ACTION = { bg: '#15803D', hover: '#166534', text: '#FFFFFF' };

export const ORDER_STATUS_THEME: Record<OrderStatus, StatusTheme> = {
  PENDING: {
    bg: '#FFFBEB',
    drawerBg: '#FFFCF0',
    border: '#FCD34D',
    accent: '#F59E0B',
    text: '#78350F',
    badgeBg: '#FEF3C7',
    badgeText: '#92400E',
    badgeBorder: '#F59E0B',
    label: 'NOVO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Aceitar Pedido',
  },
  CONFIRMED: {
    bg: '#FFFDF5',
    drawerBg: '#FFFDF7',
    border: '#FDE68A',
    accent: '#D97706',
    text: '#78350F',
    badgeBg: '#FFFBEB',
    badgeText: '#92400E',
    badgeBorder: '#FDE68A',
    label: 'CONFIRMADO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Iniciar Preparo',
  },
  PREPARING: {
    bg: '#EFF6FF',
    drawerBg: '#F3F8FF',
    border: '#93C5FD',
    accent: '#2563EB',
    text: '#1E3A8A',
    badgeBg: '#DBEAFE',
    badgeText: '#1E40AF',
    badgeBorder: '#93C5FD',
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
    accent: '#15803D',
    text: '#14532D',
    badgeBg: '#DCFCE7',
    badgeText: '#166534',
    badgeBorder: '#86EFAC',
    label: 'PRONTO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Chamar entregador',
  },
  WAITING_FOR_DRIVER: {
    bg: '#F0FDF4',
    drawerBg: '#F3FDF6',
    border: '#86EFAC',
    accent: '#15803D',
    text: '#14532D',
    badgeBg: '#DCFCE7',
    badgeText: '#166534',
    badgeBorder: '#86EFAC',
    label: 'PRONTO',
    buttonBg: '#15803D',
    buttonHover: '#166534',
    buttonText: '#FFFFFF',
    buttonLabel: 'Ver detalhes',
  },
  OUT_FOR_DELIVERY: {
    bg: '#ECFEFF',
    drawerBg: '#F0FEFF',
    border: '#67E8F9',
    accent: '#0891B2',
    text: '#164E63',
    badgeBg: '#CFFAFE',
    badgeText: '#155E75',
    badgeBorder: '#67E8F9',
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
    badgeBorder: '#CBD5E1',
    label: 'ENTREGUE',
    buttonBg: '#E2E8F0',
    buttonHover: '#CBD5E1',
    buttonText: '#334155',
    buttonLabel: 'Ver Detalhes',
  },
  CANCELLED: {
    bg: '#FEF2F2',
    drawerBg: '#FEF5F5',
    border: '#FECACA',
    accent: '#DC2626',
    text: '#7F1D1D',
    badgeBg: '#FEE2E2',
    badgeText: '#991B1B',
    badgeBorder: '#FECACA',
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

// Atrasado = aceito/em preparo há mais tempo que o Tempo de Preparo da loja (padrão 25 min).
// Mesma regra da faixa "Alertas de pedidos" (lib/orders/orderAlerts) e do cronômetro vermelho.
export function checkIsPreparingDelayed(createdAt: string | Date, status: OrderStatus, maxMinutes?: number | null): boolean {
  if (status !== 'PREPARING' && status !== 'CONFIRMED') return false;
  const elapsedMs = Date.now() - new Date(createdAt).getTime();
  return elapsedMs > prepLimitMinutes(maxMinutes) * 60000;
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
// resync
