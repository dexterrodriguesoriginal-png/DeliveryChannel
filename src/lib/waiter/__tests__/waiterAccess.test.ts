import { describe, expect, it } from 'vitest';
import { cleanWaiterEmail, readWaiterEmailParam, waiterEntryUrl, waiterWhatsAppUrl } from '../waiterAccess';
import { emailRedirectUrl } from '../../auth/authRedirect';

describe('acesso do garçom (link, WhatsApp, e-mail)', () => {
  it('monta o link /garcom pela origem e só pré-preenche e-mail válido', () => {
    expect(waiterEntryUrl('https://x.app/')).toBe('https://x.app/garcom');
    expect(waiterEntryUrl('https://x.app', 'Ana@Loja.com')).toBe('https://x.app/garcom?email=ana%40loja.com');
    expect(waiterEntryUrl('https://x.app', 'lixo<script>')).toBe('https://x.app/garcom');
    expect(readWaiterEmailParam('?email=ana%40loja.com')).toBe('ana@loja.com');
    expect(readWaiterEmailParam('?email=%3Cb%3E')).toBeNull();
    expect(cleanWaiterEmail('a b@c.com')).toBeNull();
  });
  it('WhatsApp leva o link codificado e o nome da loja', () => {
    const url = waiterWhatsAppUrl('https://x.app/garcom?email=a%40b.com', 'Bar do Zé');
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]);
    expect(text).toContain('Bar do Zé');
    expect(text).toContain('https://x.app/garcom?email=a%40b.com');
  });
  it('o link do e-mail de confirmação volta para /garcom', () => {
    expect(emailRedirectUrl({ origin: 'https://x.app', pathname: '/garcom' })).toBe('https://x.app/garcom');
    expect(emailRedirectUrl({ origin: 'https://x.app', pathname: '/garcom/' })).toBe('https://x.app/garcom');
  });
});
