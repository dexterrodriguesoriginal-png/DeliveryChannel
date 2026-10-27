import { describe, expect, it } from 'vitest';
import { bulkTableInputs, diningTableQrUrl, readDineInConfig, salonPermissions } from '../salonSetup';

describe('salon setup helpers', () => {
  it('allows owners and managers to configure the salon without granting module controls or QR renewal to managers', () => {
    expect(salonPermissions('OWNER')).toEqual({
      canManageSalon: true,
      canManageServiceFeeModule: true,
      canRegenerateQr: true,
    });
    expect(salonPermissions('MANAGER')).toEqual({
      canManageSalon: true,
      canManageServiceFeeModule: false,
      canRegenerateQr: false,
    });
    expect(salonPermissions('CASHIER')).toEqual({
      canManageSalon: false,
      canManageServiceFeeModule: false,
      canRegenerateQr: false,
    });
  });

  it('provides schema-compatible defaults for dine-in settings', () => {
    expect(readDineInConfig()).toEqual({
      mode: 'TABLE',
      release_required: true,
      round_limit: 300,
      salon_open: false,
      close_roles: ['OWNER', 'MANAGER', 'CASHIER'],
    });
  });

  it('normalizes invalid config while preserving valid choices', () => {
    expect(readDineInConfig({ mode: 'INDIVIDUAL', round_limit: -1, close_roles: ['WAITER', 2] })).toEqual({
      mode: 'INDIVIDUAL',
      release_required: true,
      round_limit: 300,
      salon_open: false,
      close_roles: ['WAITER'],
    });
  });

  it('builds the public mesa QR URL and numbered bulk table names', () => {
    expect(diningTableQrUrl('https://example.com/', 'token/one')).toBe('https://example.com/mesa/token%2Fone');
    // with a valid slug and an opaque token: new-style link; invalid slug/token falls back to the legacy link
    const token = 'a'.repeat(48);
    expect(diningTableQrUrl('https://example.com/', token, 'minha-loja')).toBe(`https://example.com/app/minha-loja?mesa=${token}`);
    expect(diningTableQrUrl('https://example.com', token, 'Bad Slug!')).toBe(`https://example.com/mesa/${token}`);
    expect(diningTableQrUrl('https://example.com', 'token/one', 'minha-loja')).toBe('https://example.com/mesa/token%2Fone');
    expect(bulkTableInputs(3, 'Varanda', 4)).toEqual([
      { label: 'Mesa 1', area: 'Varanda', seats: 4 },
      { label: 'Mesa 2', area: 'Varanda', seats: 4 },
      { label: 'Mesa 3', area: 'Varanda', seats: 4 },
    ]);
  });
});
