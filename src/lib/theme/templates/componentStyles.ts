/**
 * Estilos de Componentes Homologados para o DeliveryChannel
 * Variações de raio de borda (0 a 24px), sombras (0 a 5 níveis) e acabamentos de cartões.
 */

import { ComponentStyles } from '../../../types/theme';

export interface NamedComponentStyle {
  id: string;
  name: string;
  description: string;
  config: ComponentStyles;
}

export const COMPONENT_STYLES: NamedComponentStyle[] = [
  // 1. Padrão Suave Arredondado (16px, sombra leve)
  {
    id: 'rounded-soft',
    name: 'Arredondado Suave (16px)',
    description: 'Bordas curvas contemporâneas e sombra suave equilibrada.',
    config: {
      borderRadius: '1rem',
      cardRadius: '1rem',
      buttonRadius: '0.75rem',
      borderRadiusPx: 16,
      borderWidthPx: 1,
      cardShadow: 'sm',
      buttonShadow: 'sm',
      shadowLevel: 1,
      shadowIntensity: 8,
      shadowBlur: 12,
      shadowSpread: 0,
      shadowColor: '#000000',
      cardBorder: true,
      headerStyle: 'solid',
      categoryStyle: 'solid',
    },
  },
  // 2. Curvas Marcantes (24px, pill buttons)
  {
    id: 'rounded-playful',
    name: 'Curvas Marcantes (24px)',
    description: 'Cantos generosamente arredondados para docerias, açaí e lanches.',
    config: {
      borderRadius: '1.5rem',
      cardRadius: '1.5rem',
      buttonRadius: '9999px',
      borderRadiusPx: 24,
      borderWidthPx: 1,
      cardShadow: 'md',
      buttonShadow: 'sm',
      shadowLevel: 2,
      shadowIntensity: 10,
      shadowBlur: 16,
      shadowSpread: -2,
      shadowColor: '#000000',
      cardBorder: true,
      headerStyle: 'translucent',
      categoryStyle: 'pill',
    },
  },
  // 3. Compacto Funcional (8px, sombra sutil)
  {
    id: 'compact-clean',
    name: 'Compacto Funcional (8px)',
    description: 'Bordas curtas e limpas para mercados, empórios e alta densidade.',
    config: {
      borderRadius: '0.5rem',
      cardRadius: '0.5rem',
      buttonRadius: '0.375rem',
      borderRadiusPx: 8,
      borderWidthPx: 1,
      cardShadow: 'sm',
      buttonShadow: 'none',
      shadowLevel: 1,
      shadowIntensity: 6,
      shadowBlur: 8,
      shadowSpread: 0,
      shadowColor: '#000000',
      cardBorder: true,
      headerStyle: 'solid',
      categoryStyle: 'solid',
    },
  },
  // 4. Reto Moderno Sem Raio (0px, borda definida)
  {
    id: 'sharp-editorial',
    name: 'Reto Editorial (0px)',
    description: 'Ângulos retos minimalistas para estética brutalista ou tradicional requintada.',
    config: {
      borderRadius: '0px',
      cardRadius: '0px',
      buttonRadius: '0px',
      borderRadiusPx: 0,
      borderWidthPx: 1,
      cardShadow: 'none',
      buttonShadow: 'none',
      shadowLevel: 0,
      shadowIntensity: 0,
      shadowBlur: 0,
      shadowSpread: 0,
      shadowColor: '#000000',
      cardBorder: true,
      headerStyle: 'solid',
      categoryStyle: 'outline',
    },
  },
  // 5. Profundidade Elevada (12px, sombra pronunciada)
  {
    id: 'elevated-depth',
    name: 'Profundidade Elevada (12px)',
    description: 'Sombras elegantes que destacam os cartões sobre o fundo da vitrine.',
    config: {
      borderRadius: '0.75rem',
      cardRadius: '0.75rem',
      buttonRadius: '0.75rem',
      borderRadiusPx: 12,
      borderWidthPx: 1,
      cardShadow: 'lg',
      buttonShadow: 'md',
      shadowLevel: 4,
      shadowIntensity: 14,
      shadowBlur: 24,
      shadowSpread: -4,
      shadowColor: '#000000',
      cardBorder: false,
      headerStyle: 'gradient',
      categoryStyle: 'solid',
    },
  },
  // 6. Contorno Minimalista (14px, sem sombra)
  {
    id: 'flat-outline',
    name: 'Contorno Minimalista (14px)',
    description: 'Visual 100% flat baseado em linhas e contrastes nítidos sem sombras.',
    config: {
      borderRadius: '0.875rem',
      cardRadius: '0.875rem',
      buttonRadius: '0.625rem',
      borderRadiusPx: 14,
      borderWidthPx: 1,
      cardShadow: 'none',
      buttonShadow: 'none',
      shadowLevel: 0,
      shadowIntensity: 0,
      shadowBlur: 0,
      shadowSpread: 0,
      shadowColor: '#000000',
      cardBorder: true,
      headerStyle: 'solid',
      categoryStyle: 'outline',
    },
  },
];
