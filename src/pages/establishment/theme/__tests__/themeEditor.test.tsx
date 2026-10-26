// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeEditorShell } from '../ThemeEditorShell';
import { TEMPLATES } from '../../../../lib/theme/templates';
import { DEFAULT_DELIVERY_CHANNEL_THEME, themeToTokens } from '../../../../lib/theme/themeEngine';
import { Tenant } from '../../../../types';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  setTenant: vi.fn(),
  toast: vi.fn(),
  context: { tenantId: 'tenant-1', userRole: 'OWNER', userId: 'owner-1' },
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ securityContext: mocks.context, setActiveTenant: mocks.setTenant }),
}));
vi.mock('../../../../context/ToastContext', () => ({
  useToast: () => ({ showToast: mocks.toast }),
}));
vi.mock('../../../../services/themeService', () => ({ themeService: { updateTheme: mocks.save } }));
vi.mock('../../../../repositories/productRepository', () => ({
  productRepository: {
    getProducts: async () => [
      { id: 'real-product', name: 'Meu produto real', price: 12, isActive: true },
    ],
  },
}));
vi.mock('../../../../components/establishment/theme/ThemeImageUploader', () => ({
  ThemeImageUploader: () => null,
}));
const identity = {
  storeName: 'Minha loja',
  tagline: 'Meu slogan',
  logoUrl: '/logo.png',
  bannerUrl: '/capa.png',
};
const tenant = {
  id: 'tenant-1',
  category: 'ADEGA',
  slug: 'minha-loja',
  name: 'Minha loja',
  theme: { ...DEFAULT_DELIVERY_CHANNEL_THEME, ...identity },
  settings: { isOpen: true },
} as Tenant;
async function applySecondModel() {
  fireEvent.click(screen.getAllByRole('button', { name: /Ver na minha loja/ })[1]);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Usar modelo' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.save.mockImplementation(async (_context, _tenantId, theme) => theme);
});
afterEach(cleanup);

describe('editor e salvamento', () => {
  it('aplica apenas no rascunho e salva tokens/layout/templateId com identidade preservada', async () => {
    const user = userEvent.setup();
    render(<ThemeEditorShell tenant={tenant} />);
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    const savedId = themeToTokens(tenant.theme).meta?.templateId;
    await applySecondModel();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(tenant.theme.tokens?.meta?.templateId).toBe(savedId);
    expect(screen.getByText('Alterações não salvas')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const [context, tenantId, saved] = mocks.save.mock.calls[0];
    expect(context).toBe(mocks.context);
    expect(tenantId).toBe(tenant.id);
    expect(TEMPLATES.some((model) => model.id === saved.tokens.meta.templateId)).toBe(true);
    expect(saved.tokens.layout).toEqual(
      TEMPLATES.find((model) => model.id === saved.tokens.meta.templateId)!.tokens.layout
    );
    for (const key of Object.keys(identity) as Array<keyof typeof identity>)
      expect(saved[key]).toBe(identity[key]);
    expect(mocks.setTenant).toHaveBeenCalledWith(
      expect.objectContaining({ id: tenant.id, theme: saved })
    );
    await waitFor(() => expect(screen.getByText('Tudo salvo')).toBeTruthy());
  });
  it('desfaz e cancela sem gravar no backend; mantém linguagem de lojista nas abas', async () => {
    render(<ThemeEditorShell tenant={tenant} />);
    await applySecondModel();
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(screen.getByText('Tudo salvo')).toBeTruthy();
    const input = screen.getByDisplayValue(identity.storeName);
    fireEvent.change(input, { target: { value: 'Outro nome' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar alterações' }));
    expect(screen.getByDisplayValue(identity.storeName)).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Seções do editor' });
    for (const name of ['Modelos', 'Identidade', 'Cores', 'Fundos', 'Fontes', 'Estilo', 'Prévia']) {
      fireEvent.click(within(nav).getByRole('button', { name }));
      expect(document.body.textContent).not.toMatch(/tokens CSS|homologad|semântica/i);
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('mantém o rascunho se o salvamento falhar', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Falha temporária'));
    render(<ThemeEditorShell tenant={tenant} />);
    await applySecondModel();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Não foi possível salvar' })
      )
    );
    expect(screen.getByText('Alterações não salvas')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    expect(mocks.setTenant).not.toHaveBeenCalled();
  });
});
