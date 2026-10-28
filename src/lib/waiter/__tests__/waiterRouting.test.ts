import { describe, expect, it } from 'vitest';
import {
  callStage, clampTimeout, DEFAULT_SERVICE_SETTINGS, formatCountdown, formatResponseTime, initials, isCallEscalated,
  isCallVisibleToWaiter, parseServiceSettings, secondsLeft, sortRoster, summarizeTables, tablesByWaiter, toggleAssignment,
  type RoutedCall, type ServiceSettings,
} from '../waiterRouting';

const NOW = Date.parse('2026-10-27T20:00:00Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const fixed: ServiceSettings = { ...DEFAULT_SERVICE_SETTINGS, mode: 'FIXED' };
const call = (over: Partial<RoutedCall> = {}): RoutedCall => ({ status: 'OPEN', route: 'ALL', created_at: ago(5), ...over });

describe('visibilidade do chamado (espelha a RLS)', () => {
  it('LIVRE: todos veem; depois de assumido só quem assumiu', () => {
    expect(isCallVisibleToWaiter(call(), 'w1', DEFAULT_SERVICE_SETTINGS, NOW)).toBe(true);
    expect(isCallVisibleToWaiter(call({ accepted_by: 'w1' }), 'w2', DEFAULT_SERVICE_SETTINGS, NOW)).toBe(false);
    expect(isCallVisibleToWaiter(call({ accepted_by: 'w1' }), 'w1', DEFAULT_SERVICE_SETTINGS, NOW)).toBe(true);
  });
  it('FIXO: só o responsável; prazo vencido, offline ou sem responsável liberam para todos', () => {
    const c = call({ route: 'ASSIGNED', assigned_to: 'w1' });
    expect(isCallVisibleToWaiter(c, 'w1', fixed, NOW)).toBe(true);
    expect(isCallVisibleToWaiter(c, 'w2', fixed, NOW)).toBe(false);
    expect(isCallVisibleToWaiter(call({ ...c, created_at: ago(61) }), 'w2', fixed, NOW)).toBe(true);
    expect(isCallVisibleToWaiter(c, 'w2', fixed, NOW, false)).toBe(true);
    expect(isCallVisibleToWaiter(call({ route: 'ASSIGNED', assigned_to: null }), 'w2', fixed, NOW)).toBe(true);
    expect(isCallVisibleToWaiter({ ...c, escalated_at: ago(1) }, 'w2', fixed, NOW)).toBe(true);
  });
  it('CENTRAL: oculto até despachar (só o escolhido) ou escalonar', () => {
    const c = call({ route: 'CENTRAL' });
    const central = { ...DEFAULT_SERVICE_SETTINGS, mode: 'CENTRAL' as const };
    expect(isCallVisibleToWaiter(c, 'w1', central, NOW)).toBe(false);
    expect(isCallVisibleToWaiter({ ...c, assigned_to: 'w2' }, 'w2', central, NOW)).toBe(true);
    expect(isCallVisibleToWaiter({ ...c, assigned_to: 'w2' }, 'w1', central, NOW)).toBe(false);
    expect(isCallVisibleToWaiter({ ...c, escalated_at: ago(1) }, 'w1', central, NOW)).toBe(true);
  });
  it('chamado encerrado só aparece para quem atendeu', () => {
    expect(isCallVisibleToWaiter(call({ status: 'HANDLED', accepted_by: 'w1' }), 'w2', fixed, NOW)).toBe(false);
  });
});

describe('prazos e rótulos', () => {
  it('conta regressiva nunca fica negativa', () => {
    expect(secondsLeft(ago(10), 60, NOW)).toBe(50);
    expect(secondsLeft(ago(100), 60, NOW)).toBe(0);
    expect(formatCountdown(75)).toBe('1:15');
    expect(formatCountdown(-3)).toBe('0:00');
  });
  it('escalonamento por prazo só vale no modo fixo e sem aceite', () => {
    expect(isCallEscalated(call({ route: 'ASSIGNED', assigned_to: 'w1', created_at: ago(61) }), fixed, NOW)).toBe(true);
    expect(isCallEscalated(call({ route: 'ASSIGNED', assigned_to: 'w1', created_at: ago(61), accepted_by: 'w1' }), fixed, NOW)).toBe(false);
    expect(isCallEscalated(call({ route: 'CENTRAL', created_at: ago(500) }), fixed, NOW)).toBe(false);
  });
  it('estágios do chamado', () => {
    expect(callStage(call({ accepted_by: 'me' }), 'me', fixed, NOW)).toBe('TAKEN_BY_ME');
    expect(callStage(call({ accepted_by: 'x' }), 'me', fixed, NOW)).toBe('TAKEN');
    expect(callStage(call({ route: 'ASSIGNED', assigned_to: 'me' }), 'me', fixed, NOW)).toBe('MINE');
    expect(callStage(call({ route: 'CENTRAL' }), 'me', fixed, NOW)).toBe('WAITING_CENTRAL');
    expect(callStage(call({ route: 'ASSIGNED', assigned_to: 'x', escalated_at: ago(1) }), 'me', fixed, NOW)).toBe('ESCALATED');
  });
  it('limita tempos a 10–600 s e lê configurações', () => {
    expect(clampTimeout(5)).toBe(10);
    expect(clampTimeout(9999)).toBe(600);
    expect(clampTimeout('abc', 45)).toBe(45);
    expect(parseServiceSettings({ mode: 'FIXED', hybrid_help: true, accept_timeout_seconds: 30, dispatch_timeout_seconds: 90 }))
      .toEqual({ mode: 'FIXED', hybridHelp: true, acceptTimeoutSeconds: 30, dispatchTimeoutSeconds: 90 });
    expect(parseServiceSettings({ mode: 'CENTRAL', hybrid_help: true }).hybridHelp).toBe(false);
    expect(parseServiceSettings(null)).toEqual(DEFAULT_SERVICE_SETTINGS);
  });
});

describe('equipe e mesas', () => {
  it('iniciais e tempo de resposta', () => {
    expect(initials('João Silva')).toBe('JS');
    expect(initials('maria')).toBe('M');
    expect(initials('')).toBe('?');
    expect(formatResponseTime(45)).toBe('45s');
    expect(formatResponseTime(125)).toBe('2min 05s');
    expect(formatResponseTime(null)).toBe('—');
  });
  it('ordena a central: online e livres primeiro, menos mesas antes', () => {
    const mk = (name: string, o: Partial<{ online: boolean; busy: boolean; tableCount: number }>) => ({ userId: name, name, photoUrl: null, online: true, busy: false, tableCount: 0, openCalls: 0, ...o });
    const sorted = sortRoster([mk('Zé', { online: false }), mk('Ana', { busy: true }), mk('Bia', { tableCount: 3 }), mk('Caio', {})]);
    expect(sorted.map(r => r.name)).toEqual(['Caio', 'Bia', 'Ana', 'Zé']);
  });
  it('agrupa e alterna atribuições de mesa', () => {
    const base = [{ table_id: 't1', waiter_id: 'a' }, { table_id: 't2', waiter_id: 'a' }, { table_id: 't3', waiter_id: 'b' }];
    expect(tablesByWaiter(base).get('a')).toEqual(['t1', 't2']);
    expect(toggleAssignment(base, 't3', 'a').find(x => x.table_id === 't3')?.waiter_id).toBe('a');
    expect(toggleAssignment(base, 't1', 'a').some(x => x.table_id === 't1')).toBe(false);
    expect(toggleAssignment(base, 't9', 'b')).toHaveLength(4);
  });
  it('resume as mesas como "2, 4, 6, 9"', () => {
    expect(summarizeTables(['Mesa 9', 'Mesa 2', 'Mesa 10', 'Mesa 4'])).toBe('2, 4, 9, 10');
    expect(summarizeTables(['Varanda'])).toBe('Varanda');
  });
});
