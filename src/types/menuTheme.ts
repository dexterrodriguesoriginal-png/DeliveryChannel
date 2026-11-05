/** Visual exclusivo do cardápio da mesa. Nunca é derivado do tema do app. */
export interface MenuTheme {
  background: string;
  surface: string;
  text: string;
  accent: string;
  accentText: string;
  categoryActiveBg: string;
  fontFamily: string;
  radius: number;
  layout: 'comfortable' | 'compact';
  totemMode?: boolean;
  totemIdleTimeout?: number;
}

export interface MenuTemplate {
  id: string;
  name: string;
  description: string;
  theme: MenuTheme;
}
