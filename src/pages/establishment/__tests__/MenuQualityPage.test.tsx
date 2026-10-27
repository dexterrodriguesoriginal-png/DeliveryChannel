// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../../types';

const mocks = vi.hoisted(() => ({
  auth: { activeTenant: { id: 'tenant-1', name: 'Loja', settings: {} }, securityContext: { sc: true }, activeRole: 'OWNER' },
  toast: { showToast: vi.fn() },
  getProducts: vi.fn(), update: vi.fn(), getCategories: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => mocks.toast }));
vi.mock('../../../repositories/productRepository', () => ({ productRepository: { getProducts: mocks.getProducts, update: mocks.update } }));
vi.mock('../../../repositories/categoryRepository', () => ({ categoryRepository: { getCategories: mocks.getCategories } }));
vi.mock('../../../components/common/ImageUploader', () => ({
  ImageUploader: ({ onChange }: { onChange: (u: string) => void }) => <button type="button" data-testid="fake-upload" onClick={() => onChange('https://cdn/x.webp')}>enviar</button>,
}));

import { MenuQualityPage, PAGE_SIZE } from '../MenuQualityPage';

const DESC = 'Descrição completa com mais de vinte caracteres.';
const prod = (id: string, over: Partial<Product> = {}): Product => ({
  id, tenantId: 'tenant-1', categoryId: 'c1', name: `Produto ${id}`, description: DESC, price: 10, imageUrl: 'https://cdn/a.webp',
  isAvailable: true, isActive: true, stockQuantity: 1, unit: 'un', ...over,
} as Product);
const cats = [{ id: 'c1', name: 'Bebidas' }, { id: 'c2', name: 'Petiscos' }];

let container: HTMLDivElement; let root: Root; let data: Product[];
const q = (sel: string) => container.querySelector(sel) as HTMLElement;
const qa = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const type = async (el: HTMLElement, value: string) => {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const mount = async () => { await act(async () => { root.render(<MenuQualityPage />); }); await flush(); };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: true }) as MediaQueryList); // reduz movimento: números sem animação
  data = [
    prod('1'), prod('2', { name: 'Sem foto', imageUrl: '' }), prod('3', { name: 'Vazio', imageUrl: '', description: '', price: 0, categoryId: '' }),
    prod('4', { name: 'Curta', description: 'oi' }), prod('5', { name: 'Inativo', isActive: false, imageUrl: '' }),
  ];
  mocks.getProducts.mockImplementation(async () => data.map(p => ({ ...p })));
  mocks.getCategories.mockResolvedValue(cats);
  mocks.update.mockImplementation(async (_c: unknown, _t: string, id: string, ch: Partial<Product>) => { const p = data.find(x => x.id === id)!; Object.assign(p, ch); return { ...p }; });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.restoreAllMocks(); });

describe('página Qualidade do Cardápio', () => {
  it('calcula a nota só com itens ativos e lista os piores primeiro', async () => {
    await mount();
    // 4 ativos: 100 + 65 + 0 + 70 = 235 / 4 = 58,75 → 59
    expect(q('[data-testid=quality-gauge]').dataset.score).toBe('59');
    expect(q('[data-testid=metric-photo]').dataset.pct).toBe('50');
    expect(q('[data-testid=metric-description]').dataset.pct).toBe('50');
    expect(q('[data-testid=metric-price]').dataset.pct).toBe('75');
    expect(q('[data-testid=metric-category]').dataset.pct).toBe('75');
    expect(qa('[data-testid=quality-row]').map(r => r.dataset.score)).toEqual(['0', '65', '70', '100']);
    expect(container.textContent).toContain('1 item inativo não entra');
  });

  it('botão da métrica filtra a lista pelo problema', async () => {
    await mount();
    await click(q('[data-testid=cta-photo]'));
    expect(qa('[data-testid=quality-row]')).toHaveLength(2);
    expect(q('[data-testid=problem-NO_PHOTO]').getAttribute('aria-selected')).toBe('true');
    await click(q('[data-testid=problem-NO_PRICE]'));
    expect(qa('[data-testid=quality-row]')).toHaveLength(1);
    await click(q('[data-testid=problem-NO_CATEGORY]'));
    expect(container.textContent).toContain('Vazio');
  });

  it('busca e categoria', async () => {
    await mount();
    await type(q('input[aria-label="Buscar item"]'), 'curta');
    expect(qa('[data-testid=quality-row]')).toHaveLength(1);
    await type(q('input[aria-label="Buscar item"]'), '');
    const sel = q('select[aria-label="Filtrar por categoria"]') as HTMLSelectElement;
    await act(async () => { sel.value = 'c2'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(q('[data-testid=quality-empty-filter]')).toBeTruthy();
  });

  it('pagina a lista', async () => {
    data = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => prod(String(i + 10), { imageUrl: '' }));
    await mount();
    expect(qa('[data-testid=quality-row]')).toHaveLength(PAGE_SIZE);
    expect(q('[data-testid=quality-page]').textContent).toBe('Página 1 de 2');
    await click(q('button[aria-label="Próxima página"]'));
    expect(qa('[data-testid=quality-row]')).toHaveLength(3);
  });

  it('chip abre o painel no campo certo; salvar usa o caminho existente do tenant e atualiza a nota', async () => {
    await mount();
    const row = qa('[data-testid=quality-row]')[1]; // "Sem foto"
    await click(row.querySelector('[data-testid=chip-photo]'));
    const drawer = q('[data-testid=quality-drawer]');
    expect(drawer).toBeTruthy();
    expect(q('[data-testid=fix-photo]').dataset.focus).toBe('true');
    expect(q('[data-testid=quality-drawer-score]').textContent).toBe('65%');
    expect((q('[data-testid=quality-save]') as HTMLButtonElement).disabled).toBe(true); // nada mudou
    await click(q('[data-testid=fake-upload]'));
    expect(q('[data-testid=quality-drawer-score]').textContent).toBe('100%');
    await click(q('[data-testid=quality-save]')); await flush();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(mocks.auth.securityContext, 'tenant-1', '2', { imageUrl: 'https://cdn/x.webp' });
    expect(q('[data-testid=quality-drawer]')).toBeNull();
    expect(q('[data-testid=quality-gauge]').dataset.score).toBe('68'); // (100+100+0+70)/4 = 67,5 → 68 (subiu de 59)
  });

  it('descrição: contador de caracteres e envio só do campo alterado', async () => {
    await mount();
    await click(qa('[data-testid=quality-row]')[2].querySelector('[data-testid=chip-description]'));
    const area = q('textarea[aria-label="Descrição do produto"]');
    await type(area, 'curta');
    expect(q('[data-testid=desc-counter]').textContent).toBe('5/400');
    expect(q('[data-testid=desc-counter-hint]').textContent).toContain('Faltam 15');
    await type(area, 'Pizza grande de calabresa com muito queijo.');
    expect(q('[data-testid=desc-counter-hint]').textContent).toContain('Ótima');
  });

  it('preço inválido não conta e ao salvar envia o número', async () => {
    await mount();
    const vazio = qa('[data-testid=quality-row]')[0];
    await click(vazio.querySelector('[data-testid=chip-price]'));
    await type(q('input[aria-label="Preço do produto"]'), '0');
    expect(q('[data-testid=fix-price]').textContent).toContain('maior que zero');
    await type(q('input[aria-label="Preço do produto"]'), '12,50');
    await click(q('[data-testid=quality-save]')); await flush();
    expect(mocks.update).toHaveBeenCalledWith(mocks.auth.securityContext, 'tenant-1', '3', { price: 12.5 });
  });

  it('erro ao salvar mostra aviso e mantém o painel aberto', async () => {
    mocks.update.mockRejectedValueOnce(new Error('RLS negou'));
    await mount();
    await click(qa('[data-testid=quality-row]')[1].querySelector('[data-testid=chip-photo]'));
    await click(q('[data-testid=fake-upload]'));
    await click(q('[data-testid=quality-save]')); await flush();
    expect(mocks.toast.showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'RLS negou' }));
    expect(q('[data-testid=quality-drawer]')).toBeTruthy();
  });

  it('100%: mostra a celebração; sem produtos não mostra', async () => {
    data = [prod('1'), prod('2')];
    await mount();
    expect(q('[data-testid=quality-gauge]').dataset.score).toBe('100');
    expect(q('[data-testid=quality-celebration]')).toBeTruthy();
  });
  it('sem produtos: estado vazio, sem celebração', async () => {
    data = [];
    await mount();
    expect(q('[data-testid=quality-celebration]')).toBeNull();
    expect(container.textContent).toContain('Nenhum produto ativo');
  });
});
