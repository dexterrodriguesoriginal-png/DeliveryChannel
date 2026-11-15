/** Tokens públicos do cardápio; ausência de followApp preserva lojas antigas. */
export interface MenuTheme {
  followApp?: boolean;
  templateId?: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  accentText: string;
  categoryActiveBg: string;
  fontFamily: string;
  radius: number;
  layout: 'comfortable' | 'compact';
}

export interface MenuTemplate {
  id: string;
  name: string;
  description: string;
  theme: MenuTheme;
}
