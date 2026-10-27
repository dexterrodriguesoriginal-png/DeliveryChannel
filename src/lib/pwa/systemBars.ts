/**
 * Cores das barras do sistema (status bar e barra de navegação do Android) do app instalado da loja.
 * Padrão = cor do cabeçalho do tema; a loja pode escolher outras em Design do App.
 * Funções puras: usadas no servidor (manifesto + <meta theme-color>) e no navegador (atualização ao vivo).
 */
export const BAR_PRESETS: { id: string; label: string; color: string }[] = [
  { id: 'preto', label: 'Preto', color: '#0b0b0f' },
  { id: 'grafite', label: 'Grafite', color: '#1f2937' },
  { id: 'dourado', label: 'Dourado', color: '#d4a017' },
  { id: 'branco', label: 'Branco', color: '#ffffff' },
  { id: 'vermelho', label: 'Vermelho', color: '#b91c1c' },
  { id: 'verde', label: 'Verde', color: '#15803d' },
  { id: 'azul', label: 'Azul', color: '#1d4ed8' },
  { id: 'roxo', label: 'Roxo', color: '#6d28d9' },
];

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;
export const BARS_FALLBACK = '#334155';

export function normalizeBarColor(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  const v = c.trim();
  if (HEX6.test(v)) return v.toLowerCase();
  const m = HEX3.exec(v);
  return m ? `#${m[1].split('').map((x) => x + x).join('')}`.toLowerCase() : null;
}

export function isDarkColor(hex: string): boolean {
  const n = normalizeBarColor(hex);
  if (!n) return false;
  const v = parseInt(n.slice(1), 16);
  return 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) < 140;
}

export interface SystemBarsInput {
  statusBarColor?: string | null;
  navBarColor?: string | null;
  /** Cor do cabeçalho do tema (padrão das duas barras). */
  headerColor?: string | null;
  primaryColor?: string | null;
  /** Fundo geral: último recurso da barra de navegação (comportamento anterior do manifesto). */
  backgroundColor?: string | null;
}
export interface SystemBars { status: string; nav: string; statusIsDark: boolean; navIsDark: boolean; colorScheme: 'dark' | 'light' }

export function resolveSystemBars(i: SystemBarsInput = {}): SystemBars {
  const header = normalizeBarColor(i.headerColor);
  const primary = normalizeBarColor(i.primaryColor);
  const status = normalizeBarColor(i.statusBarColor) || header || primary || BARS_FALLBACK;
  const nav = normalizeBarColor(i.navBarColor) || header || normalizeBarColor(i.backgroundColor) || primary || BARS_FALLBACK;
  const navIsDark = isDarkColor(nav);
  return { status, nav, statusIsDark: isDarkColor(status), navIsDark, colorScheme: navIsDark ? 'dark' : 'light' };
}

/** Lê as cores configuradas do tema (tokens.meta.systemBars) e a cor do cabeçalho (palette.bgHeader). */
export function systemBarsFromTokens(tokens: { palette?: { bgHeader?: string; primary?: string }; meta?: { systemBars?: { statusBarColor?: string; navBarColor?: string } } } | null | undefined): SystemBars {
  return resolveSystemBars({
    statusBarColor: tokens?.meta?.systemBars?.statusBarColor,
    navBarColor: tokens?.meta?.systemBars?.navBarColor,
    headerColor: tokens?.palette?.bgHeader,
    primaryColor: tokens?.palette?.primary,
  });
}
