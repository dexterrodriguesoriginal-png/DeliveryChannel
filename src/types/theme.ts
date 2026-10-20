/**
 * Especificação e Tipagem Completa do Sistema de Design do App (DeliveryChannel)
 * Tokens centralizados, paletas semânticas, fundos, tipografia e componentes.
 */

export type ColorHex = string;

export interface BackgroundStyleConfig {
  type: 'solid' | 'gradient-linear' | 'gradient-radial' | 'image';
  color: ColorHex;
  gradientColors?: [ColorHex, ColorHex, ...ColorHex[]];
  angle?: number; // 0 a 360 graus para linear
  imageUrl?: string;
  position?: 'center' | 'top' | 'bottom';
  size?: 'cover' | 'contain' | 'auto';
  overlayColor?: ColorHex;
  overlayOpacity?: number; // 0 a 100 (%)
}

export interface ThemePalette {
  // Cores de marca e destaque
  primary: ColorHex;
  secondary: ColorHex;
  accent: ColorHex;

  // Fundos estruturais
  bgGeneral: ColorHex;
  bgHeader: ColorHex;
  bgCard: ColorHex;
  bgMenu: ColorHex;

  // Textos e legibilidade
  textTitle: ColorHex;
  textMain: ColorHex;
  textSecondary: ColorHex;

  // Botões e Ações
  buttonBg: ColorHex;
  buttonText: ColorHex;

  // Comercial e Preços
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
}

export interface ComponentStyles {
  borderRadius: string; // Ex: '0.75rem', '1rem'
  cardRadius: string;
  buttonRadius: string;
  cardShadow: 'none' | 'sm' | 'md' | 'lg';
  buttonShadow: 'none' | 'sm' | 'md';
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
