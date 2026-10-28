import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cleanWaiterPhone, generateWaiterPassword, isValidWaiterPassword, isValidWaiterUsername, isWaiterSyntheticEmail,
  normalizeWaiterUsername, parseWaiterLoginPath, waiterSyntheticEmail,
} from '../waiterIdentity';

describe('waiterIdentity', () => {
  it('normaliza usuário (sem acento, minúsculas, sem espaços)', () => {
    expect(normalizeWaiterUsername('  João Silva ')).toBe('joaosilva');
    expect(normalizeWaiterUsername('MARIA_01!')).toBe('maria_01');
    expect(normalizeWaiterUsername(null)).toBe('');
    expect(normalizeWaiterUsername('a'.repeat(40))).toHaveLength(24);
  });
  it('valida usuário e senha', () => {
    expect(isValidWaiterUsername('joao')).toBe(true);
    expect(isValidWaiterUsername('jo')).toBe(false);
    expect(isValidWaiterUsername('João')).toBe(false);
    expect(isValidWaiterPassword('123456')).toBe(true);
    expect(isValidWaiterPassword('12345')).toBe(false);
    expect(isValidWaiterPassword(undefined)).toBe(false);
  });
  it('monta o e-mail sintético que nunca é exibido', () => {
    expect(waiterSyntheticEmail('João', 'Adega-A')).toBe('joao.adega-a@garcom.deliverychannel.local');
    expect(isWaiterSyntheticEmail('joao.adega-a@garcom.deliverychannel.local')).toBe(true);
    expect(isWaiterSyntheticEmail('joao@gmail.com')).toBe(false);
  });
  it('limpa o telefone', () => {
    expect(cleanWaiterPhone('(11) 99999-1111')).toBe('11999991111');
    expect(cleanWaiterPhone('123')).toBeNull();
  });
  it('gera senha legível com o tamanho pedido e mínimo de 6', () => {
    let i = 0;
    const pw = generateWaiterPassword(max => (i++ * 7) % max, 8);
    expect(pw).toHaveLength(8);
    expect(pw).not.toMatch(/[01OlI]/);
    expect(generateWaiterPassword(() => 0, 3)).toHaveLength(6);
  });
  it('lê o slug em /garcom/<slug>', () => {
    expect(parseWaiterLoginPath('/garcom/Adega-A')).toBe('adega-a');
    expect(parseWaiterLoginPath('/garcom/adega-a/')).toBe('adega-a');
    expect(parseWaiterLoginPath('/garcom')).toBeNull();
    expect(parseWaiterLoginPath('/garcom/a/b')).toBeNull();
  });
  it('a cópia usada pelas Edge Functions é idêntica ao módulo do app', () => {
    const a = readFileSync('src/lib/waiter/waiterIdentity.ts', 'utf8');
    const b = readFileSync('supabase/functions/_shared/waiterIdentity.ts', 'utf8');
    expect(b).toBe(a);
  });
});
