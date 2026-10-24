/**
 * Especificação e Tipagem Completa do Sistema de Design do App (DeliveryChannel)
 * Tokens centralizados, paletas semânticas isoladas, fundos, tipografia e componentes.
 */

export type ColorHex = string;

export interface BackgroundStyleConfig {
  type: 'solid' | 'gradient-linear' | 'gradient-radial' | 'image';
  color: ColorHex;
  gradientStops?: 2 | 3; // 2 cores como padrão inicial, 3ª cor opcional
  gradientColors?: [ColorHex, ColorHex, ...ColorHex[]];
  angle?: number; // 0 a 360 graus para linear
  imageUrl?: string;
  position?: 'center' | 'top' | 'bottom';
  positionX?: number; // 0 a 100 (%) para enquadramento horizontal interativo
  positionY?: number; // 0 a 100 (%) para enquadramento vertical interativo
  zoom?: number; // 100 a 250 (%) para zoom do enquadramento
  size?: 'cover' | 'contain' | 'auto';
  overlayColor?: ColorHex;
  overlayOpacity?: number; // 0 a 100 (%)
}

export interface ThemePalette {
  // Cores de marca e destaque
  primary: ColorHex;
  secondary: ColorHex;
  accent: ColorHex;

  // Fundos estruturais independentes
  bgGeneral: ColorHex;
  bgHeader: ColorHex;
  bgCard: ColorHex;
  bgMenu: ColorHex;
  categoryBg: ColorHex;

  // Ícones independentes
  iconColor: ColorHex;

  // Textos e legibilidade independentes
  textTitle: ColorHex;
  textMain: ColorHex;
  textSecondary: ColorHex;

  // Botões de ação principal independentes
  buttonBg: ColorHex;
  buttonText: ColorHex;

  // Comercial e Preços independentes
  price: ColorHex;
  promoPrice: ColorHex;

  // Linhas e Contornos
  border: ColorHex;
}

export interface TypographyConfig {
  fontFamily: string;
  titleWeight: 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold';
  bodyWeight: 'normal' | 'medium' | 'semibold';
  scale: 'compact' | 'standard' | 'spacious';
  scalePercent?: number; // 85 a 125 (%)
  titleUppercase?: boolean;
  titleItalic?: boolean;
  letterSpacing?: 'tight' | 'normal' | 'wide';
  lineHeight?: 'tight' | 'normal' | 'relaxed';
}

export interface ComponentStyles {
  borderRadius: string; // Ex: '0.75rem', '1rem', '16px'
  cardRadius: string;
  buttonRadius: string;
  borderRadiusPx?: number; // 0 a 32 px
  borderWidthPx?: number; // 0 a 4 px
  cardShadow: 'none' | 'sm' | 'md' | 'lg';
  buttonShadow: 'none' | 'sm' | 'md';
  shadowIntensity?: number; // 0 a 100 (%)
  shadowBlur?: number; // 0 a 40 (px)
  shadowSpread?: number; // -10 a 20 (px)
  shadowColor?: ColorHex;
  cardBorder: boolean;
  headerStyle: 'solid' | 'gradient' | 'translucent';
  categoryStyle: 'solid' | 'outline' | 'pill' | 'subtle';
}

export interface ThemeTokens {
  version: 1;
  palette: ThemePalette;
  backgrounds: {
    general: BackgroundStyleConfig;
    header: BackgroundStyleConfig;
    card: BackgroundStyleConfig;
  };
  typography: TypographyConfig;
  components: ComponentStyles;
}

export interface PresetTheme {
  id: string;
  name: string;
  category: string;
  description: string;
  tokens: ThemeTokens;
}

export interface ContrastResult {
  ratio: number;
  passNormal: boolean; // >= 4.5:1 (WCAG AA para texto padrão)
  passLarge: boolean;  // >= 3.0:1 (WCAG AA para texto grande / UI)
  level: 'AAA' | 'AA' | 'FAIL';
}
