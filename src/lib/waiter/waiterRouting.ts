// Garçom v2 — regras puras de roteamento de chamados (espelham public._waiter_call_visible do banco).
// O banco é a autoridade (RLS restritiva); aqui servem para rótulos, contagem regressiva e testes.

export type ServiceMode = 'FREE' | 'FIXED' | 'CENTRAL';

export interface ServiceSettings {
  mode: ServiceMode;
  hybridHelp: boolean;
  acceptTimeoutSeconds: number;
  dispatchTimeoutSeconds: number;
}
export const DEFAULT_SERVICE_SETTINGS: ServiceSettings = { mode: 'FREE', hybridHelp: false, acceptTimeoutSeconds: 60, dispatchTimeoutSeconds: 60 };

export const MIN_TIMEOUT_SECONDS = 10;
export const MAX_TIMEOUT_SECONDS = 600;

export interface RoutedCall {
  status: string;
  route: 'ALL' | 'ASSIGNED' | 'CENTRAL';
  created_at: string;
  assigned_to?: string | null;
  accepted_by?: string | null;
  escalated_at?: string | null;
}

export const SERVICE_MODE_LABELS: Record<ServiceMode, { title: string; hint: string }> = {
  FREE: { title: 'Livre', hint: 'Qualquer garçom atende qualquer mesa. O primeiro que tocar em "Vou atender" assume.' },
  FIXED: { title: 'Mesas fixas', hint: 'Cada garçom cuida das suas mesas. Se ele não aceitar a tempo ou estiver offline, o chamado vai para todos.' },
  CENTRAL: { title: 'Central (dono/gerente decide)', hint: 'O chamado aparece só no painel do dono/gerente, que escolhe o garçom.' },
};

export function parseServiceMode(value: unknown): ServiceMode {
  return value === 'FIXED' || value === 'CENTRAL' ? value : 'FREE';
}

export function clampTimeout(value: unknown, fallback = 60): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, n));
}

export function parseServiceSettings(row: unknown): ServiceSettings {
  if (!row || typeof row !== 'object') return DEFAULT_SERVICE_SETTINGS;
  const r = row as Record<string, unknown>;
  const mode = parseServiceMode(r.mode);
  return {
    mode,
    hybridHelp: mode === 'FIXED' && r.hybrid_help === true,
    acceptTimeoutSeconds: clampTimeout(r.accept_timeout_seconds),
    dispatchTimeoutSeconds: clampTimeout(r.dispatch_timeout_seconds),
  };
}

/** Segundos que faltam para o prazo (nunca negativo). */
export function secondsLeft(createdAt: string, timeoutSeconds: number, nowMs: number): number {
  const deadline = Date.parse(createdAt) + timeoutSeconds * 1000;
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.ceil((deadline - nowMs) / 1000));
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Chamado foi escalonado para todos? (gravado, ou prazo vencido no modo fixo) */
export function isCallEscalated(call: RoutedCall, settings: ServiceSettings, nowMs: number): boolean {
  if (call.escalated_at) return true;
  return call.route === 'ASSIGNED' && !call.accepted_by && secondsLeft(call.created_at, settings.acceptTimeoutSeconds, nowMs) === 0;
}

/** Mesma decisão da RLS para o papel WAITER (assignedOnline = responsável com sinal recente). */
export function isCallVisibleToWaiter(call: RoutedCall, waiterId: string, settings: ServiceSettings, nowMs: number, assignedOnline = true): boolean {
  if (call.status !== 'OPEN') return call.accepted_by === waiterId;
  if (call.accepted_by) return call.accepted_by === waiterId;
  if (call.route === 'ALL') return true;
  if (call.assigned_to === waiterId) return true;
  if (call.escalated_at) return true;
  if (call.route === 'ASSIGNED') return !call.assigned_to || !assignedOnline || isCallEscalated(call, settings, nowMs);
  return false;
}

export type CallStage = 'TAKEN_BY_ME' | 'TAKEN' | 'MINE' | 'ESCALATED' | 'OPEN' | 'WAITING_CENTRAL';

/** Situação do chamado para o rótulo do cartão. */
export function callStage(call: RoutedCall, viewerId: string, settings: ServiceSettings, nowMs: number): CallStage {
  if (call.accepted_by) return call.accepted_by === viewerId ? 'TAKEN_BY_ME' : 'TAKEN';
  if (call.assigned_to === viewerId && !call.escalated_at) return 'MINE';
  if (isCallEscalated(call, settings, nowMs)) return 'ESCALATED';
  if (call.route === 'CENTRAL' && !call.assigned_to) return 'WAITING_CENTRAL';
  return 'OPEN';
}

export const CALL_STAGE_LABELS: Record<CallStage, string> = {
  TAKEN_BY_ME: 'Você está atendendo',
  TAKEN: 'Outro garçom atendendo',
  MINE: 'Mesa sua',
  ESCALATED: 'Liberado para todos',
  OPEN: 'Chamado aberto',
  WAITING_CENTRAL: 'Aguardando a central',
};

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

export interface RosterEntry { userId: string; name: string; photoUrl: string | null; online: boolean; busy: boolean; tableCount: number; openCalls: number }

/** Online primeiro, depois livres antes de ocupados, depois menos mesas, depois nome. */
export function sortRoster(roster: readonly RosterEntry[]): RosterEntry[] {
  return [...roster].sort((a, b) =>
    Number(b.online) - Number(a.online) || Number(a.busy) - Number(b.busy) || a.tableCount - b.tableCount || a.name.localeCompare(b.name, 'pt-BR'));
}

/** waiterId → ids de mesa, a partir da lista de atribuições. */
export function tablesByWaiter(assignments: ReadonlyArray<{ table_id: string; waiter_id: string }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of assignments) out.set(a.waiter_id, [...(out.get(a.waiter_id) ?? []), a.table_id]);
  return out;
}

/** Aplica "selecionar mesa → garçom" no mapa local: alterna a mesa para o garçom escolhido (ou solta se já era dele). */
export function toggleAssignment(assignments: ReadonlyArray<{ table_id: string; waiter_id: string }>, tableId: string, waiterId: string): Array<{ table_id: string; waiter_id: string }> {
  const current = assignments.find(a => a.table_id === tableId);
  const rest = assignments.filter(a => a.table_id !== tableId);
  return current?.waiter_id === waiterId ? rest : [...rest, { table_id: tableId, waiter_id: waiterId }];
}

/** "João: 2, 4, 6" — mesas em ordem natural pelo rótulo. */
export function summarizeTables(labels: readonly string[]): string {
  const num = (s: string) => Number((/\d+/.exec(s) ?? ['NaN'])[0]);
  return [...labels].sort((a, b) => num(a) - num(b) || a.localeCompare(b, 'pt-BR')).map(l => (/^\s*mesa\s+/i.test(l) ? l.replace(/^\s*mesa\s+/i, '') : l)).join(', ');
}

export function formatResponseTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`;
}
