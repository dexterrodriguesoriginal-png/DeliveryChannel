/**
 * Pares Tipográficos Homologados para o DeliveryChannel
 * Combinações harmoniosas entre headingFontFamily (títulos) e fontFamily (textos corridos).
 * Todas as fontes são provenientes da lista homologada SAFE_FONT_FAMILIES.
 */

import { TypographyConfig } from '../../../types/theme';

export interface NamedTypePair {
  id: string;
  name: string;
  headingFont: string;
  bodyFont: string;
  style: string;
  config: TypographyConfig;
}

export const TYPE_PAIRS: NamedTypePair[] = [
  // 1. Padrão Moderno Limpo
  {
    id: 'modern-clean',
    name: 'Inter Moderno',
    headingFont: 'Inter',
    bodyFont: 'Inter',
    style: 'Moderno, limpo e legível',
    config: {
      fontFamily: 'Inter',
      headingFontFamily: 'Inter',
      titleWeight: 'bold',
      bodyWeight: 'normal',
      scale: 'standard',
      scalePercent: 100,
      titleUppercase: false,
      titleItalic: false,
      letterSpacing: 'normal',
      lineHeight: 'normal',
    },
  },
  // 2. Editorial Nobre & Gastronômico (Playfair Display + Plus Jakarta Sans)
  {
    id: 'editorial-serif',
    name: 'Playfair Nobre & Jakarta',
    headingFont: 'Playfair Display',
    bodyFont: 'Plus Jakarta Sans',
    style: 'Elegante, clássico e gastronômico para adegas, vinhos e restaurantes',
    config: {
      fontFamily: 'Plus Jakarta Sans',
      headingFontFamily: 'Playfair Display',
      titleWeight: 'bold',
      bodyWeight: 'normal',
      scale: 'standard',
      scalePercent: 105,
      titleUppercase: false,
      titleItalic: false,
      letterSpacing: 'tight',
      lineHeight: 'normal',
    },
  },
  // 3. Arrojado & Dinâmico (Outfit + Inter)
  {
    id: 'bold-punch',
    name: 'Outfit Forte & Inter',
    headingFont: 'Outfit',
    bodyFont: 'Inter',
    style: 'Arrojado, geométrico e comercial para hamburguerias e delivery',
    config: {
      fontFamily: 'Inter',
      headingFontFamily: 'Outfit',
      titleWeight: 'extrabold',
      bodyWeight: 'normal',
      scale: 'standard',
      scalePercent: 102,
      titleUppercase: false,
      titleItalic: false,
      letterSpacing: 'tight',
      lineHeight: 'normal',
    },
  },
  // 4. Amigável & Acolhedor (Poppins + Roboto)
  {
    id: 'friendly-curve',
    name: 'Poppins Suave & Roboto',
    headingFont: 'Poppins',
    bodyFont: 'Roboto',
    style: 'Amigável, arredondado e acolhedor para açaí, docerias e sorvetes',
    config: {
      fontFamily: 'Roboto',
      headingFontFamily: 'Poppins',
      titleWeight: 'bold',
      bodyWeight: 'normal',
      scale: 'standard',
      scalePercent: 100,
      titleUppercase: false,
      titleItalic: false,
      letterSpacing: 'normal',
      lineHeight: 'relaxed',
    },
  },
  // 5. Urbano & Comercial (Montserrat + Inter)
  {
    id: 'urban-commerce',
    name: 'Montserrat Urbano & Inter',
    headingFont: 'Montserrat',
    bodyFont: 'Inter',
    style: 'Sólido, contemporâneo e comercial para mercados e empórios',
    config: {
      fontFamily: 'Inter',
      headingFontFamily: 'Montserrat',
      titleWeight: 'extrabold',
      bodyWeight: 'normal',
      scale: 'compact',
      scalePercent: 98,
      titleUppercase: true,
      titleItalic: false,
      letterSpacing: 'wide',
      lineHeight: 'tight',
    },
  },
  // 6. Sofisticado & Tecnológico (Plus Jakarta Sans + Plus Jakarta Sans)
  {
    id: 'tech-refined',
    name: 'Plus Jakarta All-Around',
    headingFont: 'Plus Jakarta Sans',
    bodyFont: 'Plus Jakarta Sans',
    style: 'Premium, equilibrado e fluido para estética e salões',
    config: {
      fontFamily: 'Plus Jakarta Sans',
      headingFontFamily: 'Plus Jakarta Sans',
      titleWeight: 'semibold',
      bodyWeight: 'normal',
      scale: 'standard',
      scalePercent: 100,
      titleUppercase: false,
      titleItalic: false,
      letterSpacing: 'tight',
      lineHeight: 'normal',
    },
  },
  // 7. Funcional & Neutro (Roboto + Roboto)
  {
    id: 'functional-clinic',
    name: 'Roboto Prático',
    headingFont: 'Roboto',
    bodyFont: 'Roboto',
    style: 'Claro, neutro e objetivo para farmácias e pet shops',
    config: {
      fontFamily: 'Roboto',
      headingFontFamily: 'Roboto',
      titleWeight: 'bold',
      bodyWeight: 'normal',
      scale: 'standard',
      scalePercent: 98,
      titleUppercase: false,
      titleItalic: false,
      letterSpacing: 'normal',
      lineHeight: 'normal',
    },
  },
  // 8. Rápido Nativo do Sistema (system-ui)
  {
    id: 'native-system',
    name: 'Sistema Nativo iOS/Android',
    headingFont: 'system-ui',
    bodyFont: 'system-ui',
    style: 'Carregamento instantâneo com zero requisições externas',
    config: {
      fontFamily: 'system-ui',
      headingFontFamily: 'system-ui',
      titleWeight: 'bold',
      bodyWeight: 'normal',
      scale: 'standard',
      scalePercent: 100,
      titleUppercase: false,
      titleItalic: false,
      letterSpacing: 'normal',
      lineHeight: 'normal',
    },
  },
];
