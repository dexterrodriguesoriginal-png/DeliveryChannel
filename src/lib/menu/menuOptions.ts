import type { MenuOptions } from '../../types/menuOptions';

export const MIN_IDLE_SECONDS = 30;
export const MAX_IDLE_SECONDS = 300;
export const DEFAULT_IDLE_SECONDS = 60;

export const DEFAULT_MENU_OPTIONS: Readonly<MenuOptions> = Object.freeze({
  totemMode: false,
  idleSeconds: DEFAULT_IDLE_SECONDS,
});

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw);
const isIdleSeconds = (raw: unknown): raw is number =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= MIN_IDLE_SECONDS && raw <= MAX_IDLE_SECONDS;

/** Projeção pública explícita: descarta chaves desconhecidas e valores inválidos. */
export function normalizeMenuOptions(raw: unknown): MenuOptions {
  const source = isObject(raw) ? raw : {};
  return {
    totemMode: source.totemMode === true,
    idleSeconds: isIdleSeconds(source.idleSeconds) ? source.idleSeconds : DEFAULT_IDLE_SECONDS,
  };
}

/** Escrita não transforma configurações inválidas em um sucesso aparente. */
export function isValidMenuOptions(raw: unknown): raw is MenuOptions {
  return isObject(raw)
    && Object.keys(raw).every(key => ['totemMode', 'idleSeconds'].includes(key))
    && typeof raw.totemMode === 'boolean' && isIdleSeconds(raw.idleSeconds);
}
