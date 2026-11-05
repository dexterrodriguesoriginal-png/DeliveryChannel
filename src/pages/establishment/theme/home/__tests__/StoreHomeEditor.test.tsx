// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tenant } from '../../../../../types';
import { DEFAULT_HOME_DESIGN } from '../../../../../lib/storeHome/storeHome.model';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  upload: vi.fn(),
  context: { userId: 'owner-a', userName: 'Dono', userRole: 'OWNER', tenantId: 'store-a' },
}));

vi.mock('../../../../../context/AuthContext', () => ({
  useAuth: () => ({ securityContext: mocks.context }),
}));
vi.mock('../../../../../repositories/storeHomeRepository', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../repositories/storeHomeRepository')>(),
  storeHomeRepository: {
    loadPrivate: mocks.load,
    saveDraft: mocks.save,
    publish: mocks.publish,
    uploadImage: mocks.upload,
    loadPublic: vi.fn(),
  },
}));
vi.mock('../../../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }));

import { StoreHomeEditor } from '../StoreHomeEditor';

const tenant = {
  id: 'store-a',
  name: 'Adega Show',
  slug: 'adega-show',
  category: 'ADEGA',
  theme: { storeName: 'ADEGASSHOW', logoUrl: 'https://example.com/logo.png' },
  settings: {},
} as unknown as Tenant;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context = { userId: 'owner-a', userName: 'Dono', userRole: 'OWNER', tenantId: 'store-a' };
  mocks.load.mockResolvedValue({ draft: { ...DEFAULT_HOME_DESIGN }, published: null, revision: 0 });
  mocks.save.mockResolvedValue(1);
  mocks.publish.mockResolvedValue({ ...DEFAULT_HOME_DESIGN });
  mocks.upload.mockResolvedValue('https://cdn.example.com/bg.webp');
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => true) });
});
afterEach(cleanup);

async function loaded() {
  await waitFor(() => expect(screen.queryByText('Carregando design…')).toBeNull());
}

describe('StoreHomeEditor', () => {
  it('carrega, aplica template, salva rascunho e publica', async () => {
    render(<StoreHomeEditor tenant={tenant} />);
    await loaded();
    expect(screen.getByTestId('store-home-editor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Adega Neon/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][2].templateId).toBe('adega-neon');
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled());
    expect(await screen.findByText(/Tela inicial publicada/)).toBeTruthy();
  });

  it('restaura padrão só no rascunho', async () => {
    mocks.load.mockResolvedValue({
      draft: { ...DEFAULT_HOME_DESIGN, templateId: 'burger-fogo', title: 'Custom' },
      published: { ...DEFAULT_HOME_DESIGN, templateId: 'burger-fogo' },
      revision: 2,
    });
    render(<StoreHomeEditor tenant={tenant} />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar padrão' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(screen.getByText(/Padrão restaurado no rascunho/)).toBeTruthy();
  });

  it('bloqueia garçom sem permissão', () => {
    mocks.context = { ...mocks.context, userRole: 'WAITER' };
    render(<StoreHomeEditor tenant={tenant} />);
    expect(screen.getByText(/Apenas o dono ou gerente/)).toBeTruthy();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('alterna prévia celular/totem', async () => {
    render(<StoreHomeEditor tenant={tenant} />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Prévia no totem' }));
    expect(screen.getByTestId('store-home-preview-frame').getAttribute('data-device')).toBe('totem');
  });
});
