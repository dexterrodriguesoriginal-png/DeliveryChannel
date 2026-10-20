import { describe, expect, it } from 'vitest';
import { customerWhatsAppLink } from '../crm';

describe('customerWhatsAppLink', () => {
  it('does not provide contact access without explicit consent', () => {
    expect(customerWhatsAppLink('11999998888', false)).toBeNull();
  });

  it('adds Brazil country code to a local phone number', () => {
    expect(customerWhatsAppLink('(11) 99999-8888', true)).toBe('https://wa.me/5511999998888');
  });

  it('keeps an existing country code and rejects invalid numbers', () => {
    expect(customerWhatsAppLink('+55 11 99999-8888', true)).toBe('https://wa.me/5511999998888');
    expect(customerWhatsAppLink('1234', true)).toBeNull();
  });
});
