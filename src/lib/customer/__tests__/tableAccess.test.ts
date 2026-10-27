import { describe, expect, it } from 'vitest';
import {
  clearPendingMesa, endedMessage, formatInviteCode, friendlyAccessError, inviteMinutesLeft, inviteUrl, isInviteCodeComplete, normalizeInviteCode,
  parseTableEntry, PENDING_MESA_KEY, readInviteParam, readPendingMesa, rememberPendingMesa, PENDING_APPROVAL_TEXT,
} from '../tableAccess';

const TOKEN = 'k'.repeat(48);
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('código de convite', () => {
  it('normaliza como as pessoas digitam: maiúsculas, sem espaço/traço, no máximo 6', () => {
    expect(normalizeInviteCode(' ab3-k7p9 ')).toBe('AB3K7P');
    expect(formatInviteCode('ab3k7p')).toBe('AB3 K7P');
  });
  it('só aceita o alfabeto do servidor (sem 0, 1, I, O)', () => {
    expect(isInviteCodeComplete('AB3K7P')).toBe(true);
    for (const bad of ['AB3K7', 'AB3K70', 'AB3K7I', 'AB3K7O', 'AB3K71', '']) expect(isInviteCodeComplete(bad)).toBe(false);
  });
  it('link do convite = link da mesa + &convite=CÓDIGO; nunca monta link quebrado', () => {
    expect(inviteUrl('https://x.app/', 'minha-loja', TOKEN, 'ab3k7p')).toBe(`https://x.app/app/minha-loja?mesa=${TOKEN}&convite=AB3K7P`);
    expect(inviteUrl('https://x.app', 'Loja Inválida!', TOKEN, 'AB3K7P')).toBe('');
    expect(inviteUrl('https://x.app', 'minha-loja', TOKEN, 'AB3')).toBe('');
  });
  it('lê ?convite= só quando bem formado', () => {
    expect(readInviteParam(`?mesa=${TOKEN}&convite=ab3k7p`)).toBe('AB3K7P');
    expect(readInviteParam('?convite=<script>')).toBeNull();
    expect(readInviteParam('')).toBeNull();
  });
  it('minutos restantes arredondam para cima e nunca ficam negativos', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    expect(inviteMinutesLeft('2026-10-27T12:14:10Z', now)).toBe(15);
    expect(inviteMinutesLeft('2026-10-27T11:59:00Z', now)).toBe(0);
    expect(inviteMinutesLeft('lixo', now)).toBe(0);
  });
});

describe('resposta do servidor e textos', () => {
  it('parseTableEntry só aceita estados conhecidos', () => {
    expect(parseTableEntry({ state: 'RESPONSIBLE', sessionId: 's1', approved: true })).toMatchObject({ state: 'RESPONSIBLE', sessionId: 's1', approved: true });
    expect(parseTableEntry({ state: 'IN_USE', tableLabel: 'Mesa 03' })).toMatchObject({ state: 'IN_USE', tableLabel: 'Mesa 03' });
    expect(parseTableEntry({ state: 'INVALID_CODE' })).toBeNull();
    expect(parseTableEntry(null)).toBeNull();
  });
  it('mensagens de sessão encerrada são claras e sem jargão', () => {
    expect(endedMessage('REMOVED')).toMatch(/removido/);
    expect(endedMessage('TAB_CLOSED')).toMatch(/encerrada/);
    expect(endedMessage('RESET')).toMatch(/Escaneie/);
    expect(endedMessage(undefined)).toMatch(/terminou/);
    expect(PENDING_APPROVAL_TEXT).not.toMatch(/aprovação do garçom/i);
  });
  it('erros do servidor viram português amigável (sem prefixo técnico)', () => {
    expect(friendlyAccessError('RATE_LIMITED: muitas tentativas')).toMatch(/Muitas tentativas/);
    expect(friendlyAccessError('IDENTIFICATION_REQUIRED: x')).toMatch(/Entre na sua conta/);
    expect(friendlyAccessError('TAB_NOT_FOUND: comanda não encontrada.')).toBe('comanda não encontrada.');
  });
});

describe('mesa pendente depois do e-mail de confirmação', () => {
  it('guarda, devolve e expira (3 h); lixo no armazenamento é ignorado', () => {
    const s = memory();
    rememberPendingMesa(s, TOKEN, 1000);
    expect(readPendingMesa(s, 2000)).toBe(TOKEN);
    expect(readPendingMesa(s, 1000 + 3 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(s.getItem(PENDING_MESA_KEY)).toBeNull();
    s.setItem(PENDING_MESA_KEY, '{"token":"<x>","at":1}');
    expect(readPendingMesa(s, 2)).toBeNull();
    s.setItem(PENDING_MESA_KEY, 'não é json');
    expect(readPendingMesa(s, 2)).toBeNull();
    rememberPendingMesa(s, TOKEN, 5); clearPendingMesa(s);
    expect(readPendingMesa(s, 6)).toBeNull();
  });
});
