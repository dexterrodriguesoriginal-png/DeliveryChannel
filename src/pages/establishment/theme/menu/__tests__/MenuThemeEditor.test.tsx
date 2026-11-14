// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tenant } from '../../../../../types';
const mocks = vi.hoisted(() => ({
  load: vi.fn(), save: vi.fn(), product: vi.fn(), category: vi.fn(),
  context: { userId: 'owner-a', userName: 'Dono', userRole: 'OWNER', tenantId: 'store-a' },
  tenant: null as Tenant | null,
}));
vi.mock('../../../../../context/AuthContext', () => ({ useAuth: () => ({ securityContext: mocks.context, activeTenant: mocks.tenant }) }));
vi.mock('../../../../../repositories/menuThemeRepository', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../repositories/menuThemeRepository')>(),
  menuThemeRepository: { load: mocks.load, save: mocks.save },
}));
vi.mock('../../../../../repositories/menuOptionsRepository', () => ({ menuOptionsRepository: { load: vi.fn().mockResolvedValue({ totemMode: false, idleSeconds: 60 }), save: vi.fn() } }));
vi.mock('../../../../../repositories/menuHeaderRepository', () => ({ menuHeaderRepository: { load: vi.fn().mockResolvedValue({ coverUrl: null, categoryMenuMode: 'ICON' }), save: vi.fn(), uploadCover: vi.fn() } }));
vi.mock('../../../../../repositories/totemWelcomeRepository', () => ({ totemWelcomeRepository: { load: vi.fn().mockResolvedValue({ slides: [], imageSeconds: 6, buttonText: 'Toque para começar', buttonStyle: 'BAR', buttonBg: null, buttonFg: null, idleSeconds: 90 }), save: vi.fn(), uploadSlide: vi.fn() } }));
vi.mock('../../../../../repositories/totemDesignRepository', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../repositories/totemDesignRepository')>(),
  totemDesignRepository: { canManage: () => mocks.context.userRole === 'OWNER' || mocks.context.userRole === 'MANAGER', load: vi.fn().mockResolvedValue(null), save: vi.fn() },
}));
vi.mock('../../../../../repositories/totemAccessRepository', () => ({
  totemAccessRepository: { listUsers: vi.fn().mockResolvedValue([]), listDevices: vi.fn().mockResolvedValue([]), createUser: vi.fn(), setUserPassword: vi.fn(), setUserActive: vi.fn(), revokeDevice: vi.fn() },
}));
vi.mock('../../../../../repositories/productRepository', () => ({ productRepository: { getProducts: mocks.product } }));
vi.mock('../../../../../repositories/categoryRepository', () => ({ categoryRepository: { getCategories: mocks.category } }));
vi.mock('../BestSellersPanel', () => ({ BestSellersPanel: () => <section aria-label="Destaques do cardápio" /> }));
vi.mock('../../../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }));
vi.mock('../../TemplateGallery', () => ({ TemplateGallery: () => <section aria-label="Catálogo compartilhado" /> }));
vi.mock('../../ThemeEditorShell', () => ({ ThemeEditorShell: () => <label>Nome do app<input defaultValue="App original" /></label> }));
import { DEFAULT_MENU_THEME, MENU_TEMPLATES } from '../../../../../lib/theme/menuTheme';
import { MenuThemeEditor } from '../MenuThemeEditor';
import { ThemePage } from '../../../ThemePage';

const tenant = { id: 'store-a', name: 'Minha loja', category: 'HAMBURGUERIA', slug: 'minha-loja', theme: { storeName: 'Minha marca', primaryColor: '#123456', tokens: { private: 'app-only' } }, settings: {} } as unknown as Tenant;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }
async function loaded() { await waitFor(() => expect(screen.queryByText('Carregando o design do cardápio…')).toBeNull()); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.context = { userId: 'owner-a', userName: 'Dono', userRole: 'OWNER', tenantId: 'store-a' }; mocks.tenant = tenant;
  mocks.load.mockResolvedValue({ ...DEFAULT_MENU_THEME }); mocks.save.mockImplementation(async (_context, _tenant, theme) => theme);
  mocks.product.mockResolvedValue([{ id: 'burger', name: 'Hambúrguer da casa', description: 'Feito na hora', price: 28, isActive: true, imageUrl: '/demo/hamburgueria/placeholder.svg' }]);
  mocks.category.mockResolvedValue([{ id: 'cat', name: 'Especiais', isActive: true }]);
});
afterEach(cleanup);

describe('editor independente do cardápio', () => {
  it('aplica modelo no rascunho e salva somente a configuração do cardápio', async () => {
    const original = JSON.stringify(tenant);
    render(<MenuThemeEditor tenant={tenant} />); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Usar modelo Noturno' }));
    expect(mocks.save).not.toHaveBeenCalled();
    const preview = screen.getByTestId('menu-design-preview');
    expect(preview.style.background).toBe('#101113');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cardápio' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith(mocks.context, tenant.id, { ...MENU_TEMPLATES.find(item => item.id === 'noturno')!.theme, followApp: false }));
    expect(JSON.stringify(tenant)).toBe(original);
    expect(await screen.findByText('Design do cardápio salvo.')).toBeTruthy();
  });
  it('mostra catálogo real, prévia celular/tablet e aplica fonte, cantos e espaçamento', async () => {
    render(<MenuThemeEditor tenant={tenant} />); await loaded();
    expect(screen.getByTitle('Prévia real do cardápio')).toBeTruthy();
    expect(mocks.product).toHaveBeenCalledWith(mocks.context, tenant.id);
    expect(mocks.category).toHaveBeenCalledWith(mocks.context, tenant.id);
    fireEvent.change(screen.getByLabelText('Fonte'), { target: { value: 'Playfair Display' } });
    fireEvent.change(screen.getByLabelText('Arredondamento dos cantos'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Espaçamento'), { target: { value: 'compact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prévia no tablet' }));
    const preview = screen.getByTestId('menu-design-preview');
    expect(preview.dataset.device).toBe('tablet'); expect(preview.dataset.layout).toBe('compact');
    expect(preview.style.fontFamily).toContain('Playfair Display'); expect(preview.style.getPropertyValue('--menu-preview-radius')).toBe('8px');
    expect(document.documentElement.style.fontFamily).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar alterações' }));
    expect(preview.dataset.layout).toBe('comfortable'); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('permite ajustar todas as seis cores e sinaliza contraste insuficiente', async () => {
    render(<MenuThemeEditor tenant={tenant} />); await loaded();
    for (const label of ['Fundo', 'Cartões', 'Texto', 'Botões e destaques', 'Texto dos botões', 'Categoria selecionada']) expect(screen.getByLabelText(label)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Texto dos botões'), { target: { value: DEFAULT_MENU_THEME.accent } });
    expect(screen.getByText(/Melhore o contraste/)).toBeTruthy();
  });
  it('mantém rascunho em erro e impede envios simultâneos', async () => {
    const pending = deferred<never>(); mocks.save.mockReturnValue(pending.promise);
    render(<MenuThemeEditor tenant={tenant} />); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Usar modelo Horta' }));
    const button = screen.getByRole('button', { name: 'Salvar cardápio' }); fireEvent.click(button); fireEvent.click(button);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error('Servidor indisponível')); });
    expect(screen.getByRole('alert').textContent).toContain('Servidor indisponível');
    expect(screen.getByRole('button', { name: 'Usar modelo Horta' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Salvar cardápio' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('não sobrescreve configuração desconhecida após falha de leitura; permite tentar de novo', async () => {
    mocks.load.mockRejectedValueOnce(new Error('Falha ao carregar'));
    render(<MenuThemeEditor tenant={tenant} />); await loaded();
    expect((screen.getByRole('button', { name: 'Usar modelo Horta' }) as HTMLButtonElement).closest('fieldset')?.disabled).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await loaded();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it('ignora leitura atrasada de outra identidade na mesma loja', async () => {
    const old = deferred<typeof DEFAULT_MENU_THEME>(); mocks.load.mockReturnValueOnce(old.promise);
    const view = render(<MenuThemeEditor tenant={tenant} />);
    mocks.context = { ...mocks.context, userId: 'manager-b', userRole: 'MANAGER' }; view.rerender(<MenuThemeEditor tenant={tenant} />); await loaded();
    await act(async () => { old.resolve(MENU_TEMPLATES.find(item => item.id === 'noturno')!.theme); });
    expect(screen.getByTestId('menu-design-preview').style.background).toBe('#FFF8F0');
  });
  it('ignora confirmação de salvamento de outra loja/identidade', async () => {
    const pending = deferred<typeof DEFAULT_MENU_THEME>(); mocks.save.mockReturnValue(pending.promise);
    const view = render(<MenuThemeEditor tenant={tenant} />); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Usar modelo Noturno' })); fireEvent.click(screen.getByRole('button', { name: 'Salvar cardápio' }));
    mocks.context = { ...mocks.context, userId: 'owner-b', tenantId: 'store-b' };
    view.rerender(<MenuThemeEditor tenant={{ ...tenant, id: 'store-b' }} />); await loaded();
    await act(async () => { pending.resolve(MENU_TEMPLATES.find(item => item.id === 'noturno')!.theme); });
    expect(screen.queryByText('Design do cardápio salvo.')).toBeNull();
    expect(screen.getByTestId('menu-design-preview').style.background).toBe('#FFF8F0');
  });
  it('não carrega nem oferece controles para garçom', () => {
    mocks.context = { ...mocks.context, userRole: 'WAITER' };
    render(<MenuThemeEditor tenant={tenant} />);
    expect(screen.getByText(/Apenas o dono ou gerente/)).toBeTruthy(); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.product).not.toHaveBeenCalled();
  });
  it('funciona com repetição de efeitos em StrictMode', async () => {
    render(<React.StrictMode><MenuThemeEditor tenant={tenant} /></React.StrictMode>); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Usar modelo Oceano' }));
    expect(screen.getByTestId('menu-design-preview').style.background).toBe('#EFF6FF');
  });
  it('mantém rascunhos de app e cardápio separados ao alternar abas', async () => {
    render(<ThemePage />);
    fireEvent.change(screen.getByLabelText('Nome do app'), { target: { value: 'Novo app' } });
    const tabs = screen.getByRole('tablist', { name: 'Qual design editar' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Design do Cardápio' })); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Usar modelo Amora' }));
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Design do App' }));
    expect((screen.getByLabelText('Nome do app') as HTMLInputElement).value).toBe('Novo app');
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Design do Cardápio' }));
    expect(screen.getByRole('button', { name: 'Usar modelo Amora' }).getAttribute('aria-pressed')).toBe('true');
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it('permite alternar as abas pelo teclado', async () => {
    render(<ThemePage />);
    const app = screen.getByRole('tab', { name: 'Design do App' });
    fireEvent.keyDown(app, { key: 'ArrowRight' }); await loaded();
    expect(screen.getByRole('tab', { name: 'Design do Cardápio' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Design do Cardápio' }), { key: 'Home' });
    expect(app.getAttribute('aria-selected')).toBe('true');
  });
  it('oculta a aba do cardápio quando o contexto não pertence à loja', () => {
    mocks.context = { ...mocks.context, tenantId: 'store-b' }; render(<ThemePage />);
    expect(screen.queryByRole('tab', { name: 'Design do Cardápio' })).toBeNull(); expect(mocks.load).not.toHaveBeenCalled();
  });
  it('oferece Design do Totem e esconde a Tela inicial', () => {
    render(<ThemePage />);
    const tabs = screen.getByRole('tablist', { name: 'Qual design editar' });
    expect(within(tabs).getByRole('tab', { name: 'Design do Totem' })).toBeTruthy();
    expect(within(tabs).queryByRole('tab', { name: 'Tela Inicial' })).toBeNull();
  });
});

it('does not claim everything is saved while independently saved options are pending', async () => {
  render(<MenuThemeEditor tenant={tenant} />); await loaded();
  await waitFor(() => expect(screen.queryByText('Confira o carregamento dos painéis')).toBeNull());
  fireEvent.click(screen.getByLabelText('Modo totem'));
  expect(screen.getByText(/Alterações não salvas — confira os painéis/)).toBeTruthy();
  expect(screen.queryByText('Tudo salvo')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Usar modelo Noturno' }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar cardápio' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/Alterações não salvas — confira os painéis/)).toBeTruthy();
  expect(screen.queryByText('Tudo salvo')).toBeNull();
});

it('starts linked for new stores and lets the owner opt out before choosing a legacy model', async () => {
  mocks.load.mockResolvedValue({ ...DEFAULT_MENU_THEME, followApp: true });
  render(<MenuThemeEditor tenant={tenant} />); await loaded();
  const toggle = screen.getByRole('switch', { name: 'Seguir o tema do Design do App' }) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  expect(screen.getByRole('button', { name: 'Usar modelo Horta' }).closest('fieldset')?.disabled).toBe(true);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Usar modelo Horta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar cardápio' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(mocks.context, tenant.id, { ...MENU_TEMPLATES.find(t => t.id === 'horta')!.theme, followApp: false }));
});
