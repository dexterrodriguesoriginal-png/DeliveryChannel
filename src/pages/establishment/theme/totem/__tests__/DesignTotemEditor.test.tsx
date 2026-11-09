// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOTEM_DESIGN, designFromPreset } from '../../../../../lib/menu/totemDesign';
import type { Tenant } from '../../../../../types';

const load = vi.fn();
const save = vi.fn();
vi.mock('../../../../../context/AuthContext', () => ({
  useAuth: () => ({ securityContext: { userId: 'owner', userRole: 'OWNER', tenantId: 'store-a', userName: 'Dono' } }),
}));
vi.mock('../../../../../repositories/totemDesignRepository', () => ({
  totemDesignRepository: { canManage: () => true, load: (...a: unknown[]) => load(...a), save: (...a: unknown[]) => save(...a) },
}));
vi.mock('../../../../../repositories/totemWelcomeRepository', () => ({
  totemWelcomeRepository: { load: vi.fn().mockResolvedValue({ slides: [], imageSeconds: 6, buttonText: 'Toque para começar', buttonStyle: 'BAR', buttonBg: null, buttonFg: null, idleSeconds: 90 }), save: vi.fn(), uploadSlide: vi.fn() },
}));
vi.mock('../../../../../repositories/totemAccessRepository', () => ({
  totemAccessRepository: { listUsers: vi.fn().mockResolvedValue([]), listDevices: vi.fn().mockResolvedValue([]), createUser: vi.fn(), setUserPassword: vi.fn(), setUserActive: vi.fn(), revokeDevice: vi.fn() },
}));

import { DesignTotemEditor } from '../DesignTotemEditor';

const tenant = { id: 'store-a', name: 'Minha loja', slug: 'loja', theme: { storeName: 'Adega' }, settings: {} } as unknown as Tenant;

beforeEach(() => {
  load.mockReset(); save.mockReset();
  load.mockResolvedValue({ ...DEFAULT_TOTEM_DESIGN, colors: { ...DEFAULT_TOTEM_DESIGN.colors } });
  save.mockImplementation(async (_c: unknown, _t: unknown, design: unknown) => design);
});
afterEach(cleanup);

describe('DesignTotemEditor', () => {
  it('applies a preset, previews custom colors, restores and saves', async () => {
    render(<DesignTotemEditor tenant={tenant} />);
    await waitFor(() => expect(screen.getByTestId('totem-design-editor')).toBeTruthy());
    expect(screen.getByTestId('totem-welcome-panel')).toBeTruthy();
    expect(screen.getByTestId('totem-access-card')).toBeTruthy();
    expect(screen.getByTestId('totem-users-panel')).toBeTruthy();
    expect(screen.getByTestId('totem-design-themes')).toBeTruthy();
    expect(screen.getByTestId('totem-design-colors')).toBeTruthy();
    fireEvent.click(screen.getByTestId('totem-theme-oceano'));
    const oceano = designFromPreset('oceano');
    const preview = screen.getByTestId('totem-design-preview').querySelector('.totem-design-preview') as HTMLElement;
    expect(preview.style.getPropertyValue('--dc-kiosk-bg').toLowerCase()).toBe(oceano.colors.pageBg.toLowerCase());
    fireEvent.click(screen.getByTestId('totem-design-restore'));
    fireEvent.click(screen.getByTestId('totem-design-save'));
    await waitFor(() => expect(save).toHaveBeenCalled());
  });
});
