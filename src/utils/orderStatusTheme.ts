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

export const ORDER_STATUS_THEME: Record<OrderStatus, StatusTheme> = {
  // 1. NOVO (Amarelo / Laranja muito suave)
  // Ação principal: AMARELO (Aceitar Pedido), Secundária: VERMELHO (Recusar)
  PENDING: {
    bg: '#FFF7D6',
    drawerBg: '#FFF9E8',
    border: '#F4C542',
    accent: '#E3A900',
    text: '#854D0E',
    badgeBg: '#FEF08A',
    badgeText: '#854D0E',
    badgeBorder: '#FDE047',
    label: 'NOVO',
    buttonBg: '#EAB308',
    buttonHover: '#CA8A04',
    buttonText: '#0F172A',
    buttonLabel: 'Aceitar Pedido',
  },
  // 2. CONFIRMADO (Azul suave)
  // Ação: AZUL (Iniciar Preparo)
  CONFIRMED: {
    bg: '#EEF5FF',
    drawerBg: '#F2F7FF',
    border: '#B9D2FF',
    accent: '#2563EB',
    text: '#1E40AF',
    badgeBg: '#DBEAFE',
    badgeText: '#1D4ED8',
    badgeBorder: '#93C5FD',
    label: 'CONFIRMADO',
    buttonBg: '#2563EB',
    buttonHover: '#1D4ED8',
    buttonText: '#FFFFFF',
    buttonLabel: 'Iniciar Preparo',
  },
  // 3. EM PREPARO (Verde suave - Cozinha trabalhando!)
  // Ação: VERDE (Marcar como Pronto)
  PREPARING: {
    bg: '#ECF8F2',
    drawerBg: '#EFF9F4',
    border: '#A9DEC7',
    accent: '#008F6B',
    text: '#065F46',
    badgeBg: '#D1FAE5',
    badgeText: '#047857',
    badgeBorder: '#6EE7B7',
    label: 'EM PREPARO',
    buttonBg: '#16A34A',
    buttonHover: '#15803D',
    buttonText: '#FFFFFF',
    buttonLabel: 'Marcar como Pronto',
  },
  // 4. PRONTO (Roxo suave - Cozinha finalizou e aguarda saída)
  // Ação: ROXO (Despachar Pedido)
  READY: {
    bg: '#F4EEFF',
    drawerBg: '#F6F1FF',
    border: '#D7C2FF',
    accent: '#6D3DF5',
    text: '#5B21B6',
    badgeBg: '#EDE9FE',
    badgeText: '#6D28D9',
    badgeBorder: '#C4B5FD',
    label: 'PRONTO',
    buttonBg: '#7C3AED',
    buttonHover: '#6D28D9',
    buttonText: '#FFFFFF',
    buttonLabel: 'Despachar Pedido',
  },
  WAITING_FOR_DRIVER: {
    bg: '#F4EEFF',
    drawerBg: '#F6F1FF',
    border: '#D7C2FF',
    accent: '#6D3DF5',
    text: '#5B21B6',
    badgeBg: '#EDE9FE',
    badgeText: '#6D28D9',
    badgeBorder: '#C4B5FD',
    label: 'PRONTO',
    buttonBg: '#7C3AED',
    buttonHover: '#6D28D9',
    buttonText: '#FFFFFF',
    buttonLabel: 'Despachar Pedido',
  },
  // 5. EM ROTA (Azul suave - Movimento, trajeto, entrega)
  // Ação: AZUL (Marcar como Entregue)
  OUT_FOR_DELIVERY: {
    bg: '#EDF5FF',
    drawerBg: '#F2F7FF',
    border: '#B8D2FF',
    accent: '#2563EB',
    text: '#1E40AF',
    badgeBg: '#DBEAFE',
    badgeText: '#1D4ED8',
    badgeBorder: '#93C5FD',
    label: 'EM ROTA',
    buttonBg: '#2563EB',
    buttonHover: '#1D4ED8',
    buttonText: '#FFFFFF',
    buttonLabel: 'Marcar como Entregue',
  },
  // 6. ENTREGUE (Verde / Cinza muito suave - Pedido concluído)
  // Ação: Neutro / Verde-Cinza (Ver Detalhes)
  DELIVERED: {
    bg: '#F8FAF9',
    drawerBg: '#F8FAF9',
    border: '#D1D5DB',
    accent: '#10B981',
    text: '#374151',
    badgeBg: '#F3F4F6',
    badgeText: '#374151',
    badgeBorder: '#E5E7EB',
    label: 'ENTREGUE',
    buttonBg: '#E2E8F0',
    buttonHover: '#CBD5E1',
    buttonText: '#334155',
    buttonLabel: 'Ver Detalhes',
  },
  // 7. CANCELADO (Vermelho suave / opaco - Sem ação operacional)
  CANCELLED: {
    bg: '#FFF0F1',
    drawerBg: '#FFF2F3',
    border: '#F3B7BE',
    accent: '#D6455D',
    text: '#9F1239',
    badgeBg: '#FFE4E6',
    badgeText: '#BE123C',
    badgeBorder: '#FDA4AF',
    label: 'CANCELADO',
    buttonBg: '#DC2626',
    buttonHover: '#B91C1C',
    buttonText: '#FFFFFF',
    buttonLabel: 'Ver Detalhes',
  },
};

// Variação de estilo para pedidos EM PREPARO atrasados (ultrapassou limite operacional, ex: 25 min)
export const DELAYED_PREPARING_THEME: StatusTheme = {
  bg: '#FFF1F2',
  drawerBg: '#FFF5F5',
  border: '#FCA5A5',
  accent: '#DC2626',
  text: '#991B1B',
  badgeBg: '#FEE2E2',
  badgeText: '#B91C1C',
  badgeBorder: '#F87171',
  label: 'ATRASADO',
  buttonBg: '#2563EB',
  buttonHover: '#1D4ED8',
  buttonText: '#FFFFFF',
  buttonLabel: 'Marcar como Pronto',
};

// Verifica se um pedido em preparo está atrasado (padrão: 25 minutos)
export function checkIsPreparingDelayed(createdAt: string | Date, status: OrderStatus, maxMinutes = 25): boolean {
  if (status !== 'PREPARING') return false;
  const elapsedMinutes = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60);
  return elapsedMinutes >= maxMinutes;
}

