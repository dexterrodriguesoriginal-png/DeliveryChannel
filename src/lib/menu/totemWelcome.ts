import { contrastRatio } from '../theme/themeEngine';
import { safeHomeImageUrl } from '../storeHome/storeHome.model';
import { clampIdleTimeout, MAX_IDLE_TIMEOUT_SECONDS, MIN_IDLE_TIMEOUT_SECONDS } from '../../hooks/useIdleTimer';

export type TotemButtonStyle = 'BAR' | 'PILL' | 'OUTLINE';
export type TotemSlideKind = 'IMAGE' | 'VIDEO';

export interface TotemWelcomeSlide {
  url: string;
  kind: TotemSlideKind;
}

export interface TotemWelcomeSettings {
  slides: TotemWelcomeSlide[];
  imageSeconds: number;
  buttonText: string;
  buttonStyle: TotemButtonStyle;
  /** Cor de fundo do botão (#RRGGBB). null = usar a cor de destaque do tema. */
  buttonBg: string | null;
  /** Cor do texto do botão (#RRGGBB). null = usar o texto de destaque do tema. */
  buttonFg: string | null;
  idleSeconds: number;
}

export const DEFAULT_TOTEM_IMAGE_SECONDS = 6;
export const MIN_TOTEM_IMAGE_SECONDS = 2;
export const MAX_TOTEM_IMAGE_SECONDS = 120;
export const DEFAULT_TOTEM_IDLE_SECONDS = 90;
export const MAX_TOTEM_SLIDES = 12;
export const MAX_TOTEM_BUTTON_TEXT = 32;
export const DEFAULT_TOTEM_BUTTON_TEXT = 'Toque para começar';
export const TOTEM_BUTTON_TEXT_PRESETS = ['Toque para começar', 'Peça agora'] as const;
export const TOTEM_BUTTON_STYLES: ReadonlyArray<{ id: TotemButtonStyle; label: string; hint: string }> = [
  { id: 'BAR', label: 'Barra', hint: 'Faixa larga com ícone de mão' },
  { id: 'PILL', label: 'Pílula', hint: 'Botão arredondado com ícone de toque' },
  { id: 'OUTLINE', label: 'Contorno', hint: 'Botão vazado com borda destacada' },
];

export const DEFAULT_TOTEM_WELCOME: TotemWelcomeSettings = Object.freeze({
  slides: [],
  imageSeconds: DEFAULT_TOTEM_IMAGE_SECONDS,
  buttonText: DEFAULT_TOTEM_BUTTON_TEXT,
  buttonStyle: 'BAR',
  buttonBg: null,
  buttonFg: null,
  idleSeconds: DEFAULT_TOTEM_IDLE_SECONDS,
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const isObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

export function isTotemHexColor(raw: unknown): raw is string {
  return typeof raw === 'string' && HEX.test(raw);
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) return source[key];
  }
  return undefined;
}

function clampImageSeconds(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(n)) return DEFAULT_TOTEM_IMAGE_SECONDS;
  return Math.min(MAX_TOTEM_IMAGE_SECONDS, Math.max(MIN_TOTEM_IMAGE_SECONDS, n));
}

function clampIdle(value: unknown): number {
  if (typeof value === 'number') return clampIdleTimeout(value);
  if (typeof value === 'string' && /^[0-9]{2,3}$/.test(value)) return clampIdleTimeout(Number(value));
  return DEFAULT_TOTEM_IDLE_SECONDS;
}

function cleanButtonText(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_TOTEM_BUTTON_TEXT;
  const text = value.replace(/[<>\u0000-\u001F]/g, '').trim().slice(0, MAX_TOTEM_BUTTON_TEXT);
  return text || DEFAULT_TOTEM_BUTTON_TEXT;
}

function cleanStyle(value: unknown): TotemButtonStyle {
  return value === 'PILL' || value === 'OUTLINE' || value === 'BAR' ? value : 'BAR';
}

function optionalColor(value: unknown): string | null {
  if (value == null || value === '') return null;
  return isTotemHexColor(value) ? value : null;
}

function cleanSlide(raw: unknown): TotemWelcomeSlide | null {
  if (!isObject(raw)) return null;
  const url = safeHomeImageUrl(pick(raw, 'url', 'src'));
  if (!url) return null;
  const kindRaw = pick(raw, 'kind', 'type', 'mediaType');
  const kind: TotemSlideKind = kindRaw === 'VIDEO' || kindRaw === 'video' ? 'VIDEO' : 'IMAGE';
  return { url, kind };
}

/** Projeção explícita: descarta chaves desconhecidas e valores inválidos. */
export function normalizeTotemWelcome(raw: unknown): TotemWelcomeSettings {
  const source = isObject(raw) ? raw : {};
  const slides = Array.isArray(source.slides)
    ? source.slides.map(cleanSlide).filter((slide): slide is TotemWelcomeSlide => Boolean(slide)).slice(0, MAX_TOTEM_SLIDES)
    : [];
  return {
    slides,
    imageSeconds: clampImageSeconds(pick(source, 'imageSeconds', 'image_seconds')),
    buttonText: cleanButtonText(pick(source, 'buttonText', 'button_text')),
    buttonStyle: cleanStyle(pick(source, 'buttonStyle', 'button_style')),
    buttonBg: optionalColor(pick(source, 'buttonBg', 'button_bg_color', 'button_bg')),
    buttonFg: optionalColor(pick(source, 'buttonFg', 'button_text_color', 'button_fg')),
    idleSeconds: clampIdle(pick(source, 'idleSeconds', 'idle_seconds')) || DEFAULT_TOTEM_IDLE_SECONDS,
  };
}

export function resolvedTotemButtonColors(
  settings: TotemWelcomeSettings,
  theme: { accent: string; accentText: string },
): { background: string; color: string; fromTheme: boolean } {
  const background = settings.buttonBg || theme.accent;
  const color = settings.buttonFg || theme.accentText;
  return { background, color, fromTheme: !settings.buttonBg && !settings.buttonFg };
}

/** Aviso quando o texto do botão fica difícil de ler no fundo escolhido. */
export function totemButtonContrastWarning(foreground: string, background: string): string | null {
  if (!isTotemHexColor(foreground) || !isTotemHexColor(background)) return null;
  const ratio = contrastRatio(foreground, background);
  if (ratio < 3) {
    return 'Essas cores deixam o texto do botão ilegível. Escolha uma combinação com mais contraste.';
  }
  if (ratio < 4.5) {
    return 'O contraste do botão está baixo. O texto pode ficar difícil de ler de longe.';
  }
  return null;
}

export function totemIdleSecondsOrDefault(value?: number): number {
  if (typeof value !== 'number') return DEFAULT_TOTEM_IDLE_SECONDS;
  return Math.max(MIN_IDLE_TIMEOUT_SECONDS, Math.min(MAX_IDLE_TIMEOUT_SECONDS, Math.round(value)));
}

