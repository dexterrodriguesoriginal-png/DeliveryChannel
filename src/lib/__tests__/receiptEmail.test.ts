import { describe, expect, it } from 'vitest';
import { isValidReceiptEmail } from '../receiptEmail';

describe('destinatário único de comprovante', () => {
  it.each(['cliente@example.com', '  cliente+recibo@example.com.br  ', 'o\'nome@example.test'])('aceita um endereço convencional: %s', value => {
    expect(isValidReceiptEmail(value)).toBe(true);
  });
  it.each(['', 'nome<cliente@example.com>', 'cliente,lista@example.com', 'a@example.com,b@example.com', 'a@example.com\r\n', '.a@example.com', 'a..b@example.com', 'a@example..com', 'a@-example.com', 'a@domain-.com', 'a'.repeat(65) + '@example.com'])('recusa lista, display name ou endereço inválido: %s', value => {
    expect(isValidReceiptEmail(value)).toBe(false);
  });
});

