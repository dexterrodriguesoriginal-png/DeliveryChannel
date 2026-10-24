export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean;
export function isValidUuid(id: unknown): id is string;
export function isValidUuid(id: unknown): boolean {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}
