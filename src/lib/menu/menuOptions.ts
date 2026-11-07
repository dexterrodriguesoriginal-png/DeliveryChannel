import type { MenuOptions } from '../../types/menuOptions';
import { DEFAULT_HOME_LABEL, isValidHomeLabel, sanitizeHomeLabel } from './homeLabel';

export const MIN_IDLE_SECONDS = 30;
export const MAX_IDLE_SECONDS = 300;
export const DEFAULT_IDLE_SECONDS = 60;

export const DEFAULT_MENU_OPTIONS: Readonly<MenuOptions> = Object.freeze({
  totemMode: false,
  serviceMode: 'TABLE',
  productColumns: 3,
  reuseAppBanners: false,
  idleSeconds: DEFAULT_IDLE_SECONDS,
  homeLabel: DEFAULT_HOME_LABEL,
});

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw);
const isIdleSeconds = (raw: unknown): raw is number =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= MIN_IDLE_SECONDS && raw <= MAX_IDLE_SECONDS;

/** Projeção pública explícita: descarta chaves desconhecidas e valores inválidos. */
export function normalizeMenuOptions(raw: unknown): MenuOptions {
  const source = isObject(raw) ? raw : {};
  return {
    totemMode: source.totemMode === true,
    serviceMode: source.serviceMode === 'COUNTER' || source.serviceMode === 'BOTH' ? source.serviceMode : 'TABLE',
    productColumns: source.productColumns === 1 || source.productColumns === 2 ? source.productColumns : 3,
    reuseAppBanners: source.reuseAppBanners === true,
    idleSeconds: isIdleSeconds(source.idleSeconds) ? source.idleSeconds : DEFAULT_IDLE_SECONDS,
    homeLabel: sanitizeHomeLabel(source.homeLabel),
  };
}

/** Escrita não transforma configurações inválidas em um sucesso aparente. */
export function isValidMenuOptions(raw: unknown): raw is MenuOptions {
  return isObject(raw)
    && Object.keys(raw).every(key => ['totemMode', 'idleSeconds', 'homeLabel', 'serviceMode', 'productColumns', 'reuseAppBanners'].includes(key))
    && typeof raw.totemMode === 'boolean' && isIdleSeconds(raw.idleSeconds) && isValidHomeLabel(raw.homeLabel)
    && ['TABLE','COUNTER','BOTH'].includes(String(raw.serviceMode))
    && [1,2,3].includes(Number(raw.productColumns)) && typeof raw.reuseAppBanners === 'boolean';
}
