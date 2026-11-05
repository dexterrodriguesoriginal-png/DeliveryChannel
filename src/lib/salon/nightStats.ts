import { formatElapsed } from './tableStatus';

/** Only aggregates from salon_night_stats; no customer, employee or table identity. */
export interface SalonNightStats {
  window_start: string;
  window_end: string;
  window_source: 'OPENED_TODAY' | 'LAST_12_HOURS';
  timezone: 'America/Sao_Paulo';
  orders_count: number;
  tables_served: number;
  revenue_cents: number;
  paid_visits: number;
  average_ticket_cents: number | null;
  average_stay_seconds: number | null;
  calls_handled: number;
  average_response_seconds: number | null;
  open_tabs: number;
}

const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableInteger = (value: unknown): value is number | null => value === null || integer(value);

export function parseSalonNightStats(value: unknown): SalonNightStats | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.window_start !== 'string' || typeof row.window_end !== 'string'
    || !Number.isFinite(Date.parse(row.window_start)) || !Number.isFinite(Date.parse(row.window_end))
    || Date.parse(row.window_start) > Date.parse(row.window_end)
    || !['OPENED_TODAY', 'LAST_12_HOURS'].includes(String(row.window_source))
    || row.timezone !== 'America/Sao_Paulo'
    || !integer(row.orders_count) || !integer(row.tables_served) || !integer(row.revenue_cents)
    || !integer(row.paid_visits) || !integer(row.calls_handled) || !integer(row.open_tabs)
    || !nullableInteger(row.average_ticket_cents) || !nullableInteger(row.average_stay_seconds)
    || !nullableInteger(row.average_response_seconds)) return null;
  return {
    window_start: row.window_start, window_end: row.window_end,
    window_source: row.window_source as SalonNightStats['window_source'], timezone: row.timezone,
    orders_count: row.orders_count, tables_served: row.tables_served, revenue_cents: row.revenue_cents,
    paid_visits: row.paid_visits, average_ticket_cents: row.average_ticket_cents,
    average_stay_seconds: row.average_stay_seconds, calls_handled: row.calls_handled,
    average_response_seconds: row.average_response_seconds, open_tabs: row.open_tabs,
  };
}

export function salonStatsPeriod(stats: SalonNightStats): string {
  if (stats.window_source === 'LAST_12_HOURS') return 'Últimas 12 horas';
  const time = new Date(stats.window_start).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: stats.timezone,
  });
  return `Desde a abertura às ${time}`;
}

export function salonStatsDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const rounded = Math.max(0, Math.round(seconds));
  return rounded < 60 ? `${rounded} s` : formatElapsed(Math.round(rounded / 60));
}

