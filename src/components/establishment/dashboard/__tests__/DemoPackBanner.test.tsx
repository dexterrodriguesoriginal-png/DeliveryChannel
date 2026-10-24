import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/demoPackService', () => ({
  demoPackService: { keepDemoItems: vi.fn(), removeDemoItems: vi.fn() },
}));

import { demoPackService, DemoReviewItem } from '../../../../services/demoPackService';
import { DemoPackBanner, DemoPackBannerView, submitDemoPackChoice, updateDemoSelection } from '../DemoPackBanner';

const items: DemoReviewItem[] = [
  { id: 'c1', kind: 'category', name: 'Pizzas' },
  { id: 'p1', kind: 'product', name: 'Pizza de muçarela', categoryId: 'c1' },
  { id: 'o1', kind: 'offer', name: 'Pizza da semana', productId: 'p1' },
];

function findButton(node: React.ReactNode, label: string): React.ReactElement<any> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(child)) continue;
    if (child.props.children === label && child.props.onClick) return child;
    const found = findButton(child.props.children, label);
    if (found) return found;
  }
}

function view(overrides: Partial<Parameters<typeof DemoPackBannerView>[0]> = {}) {
  const selected = new Set(items.map(item => item.id));
  return DemoPackBannerView({
    items, selected, choosing: false, busy: false,
    onChoose: vi.fn(), onCancel: vi.fn(), onCheck: vi.fn(),
    onDecision: choice => submitDemoPackChoice(choice, items, selected),
    ...overrides,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('banner do pacote demo', () => {
  it('Manter tudo chama o serviço de manutenção sem remover itens', async () => {
    await findButton(view(), 'Manter tudo')!.props.onClick();
    expect(demoPackService.keepDemoItems).toHaveBeenCalledOnce();
    expect(demoPackService.removeDemoItems).not.toHaveBeenCalled();
  });

  it('Remover tudo chama o serviço de remoção sem IDs de cliente ou tenant', async () => {
    await findButton(view(), 'Remover tudo')!.props.onClick();
    expect(demoPackService.removeDemoItems).toHaveBeenCalledExactlyOnceWith(null);
    expect(demoPackService.keepDemoItems).not.toHaveBeenCalled();
  });

  it('Escolher o que manter abre a seleção e só envia os itens desmarcados ao salvar', async () => {
    const onChoose = vi.fn();
    findButton(view({ onChoose }), 'Escolher o que manter')!.props.onClick();
    expect(onChoose).toHaveBeenCalledOnce();
    expect(demoPackService.removeDemoItems).not.toHaveBeenCalled();

    const selected = new Set(['c1', 'p1']);
    const selection = view({ choosing: true, selected, onDecision: choice => submitDemoPackChoice(choice, items, selected) });
    const html = renderToStaticMarkup(selection);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    await findButton(selection, 'Salvar seleção')!.props.onClick();
    expect(demoPackService.removeDemoItems).toHaveBeenCalledExactlyOnceWith(['o1']);
  });

  it('salvar com todos marcados finaliza a revisão sem remover nada', async () => {
    const selected = new Set(items.map(item => item.id));
    await submitDemoPackChoice('selection', items, selected);
    expect(demoPackService.removeDemoItems).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('falha ao salvar é propagada para permitir tentativa novamente sem concluir a revisão', async () => {
    vi.mocked(demoPackService.keepDemoItems).mockRejectedValueOnce(new Error('Falha de conexão'));
    await expect(findButton(view(), 'Manter tudo')!.props.onClick()).rejects.toThrow('Falha de conexão');
    expect(renderToStaticMarkup(view({ error: 'Falha de conexão' }))).toContain('role="alert"');
  });

  it('não oferece ações para quem não é dono', () => {
    expect(renderToStaticMarkup(<DemoPackBanner tenantId="t1" isOwner={false} />)).toBe('');
  });

  it('desabilita as três ações enquanto salva', () => {
    const pending = view({ busy: true });
    for (const label of ['Manter tudo', 'Remover tudo', 'Escolher o que manter']) {
      expect(findButton(pending, label)!.props.disabled).toBe(true);
    }
    expect(renderToStaticMarkup(pending)).toContain('Salvando sua escolha');
  });

  it('preserva os vínculos ao escolher uma oferta e desmarca filhos ao remover categoria', () => {
    expect([...updateDemoSelection(items, new Set(), 'o1', true)].sort()).toEqual(['c1', 'o1', 'p1']);
    expect([...updateDemoSelection(items, new Set(['c1', 'p1', 'o1']), 'c1', false)]).toEqual([]);
  });
});
