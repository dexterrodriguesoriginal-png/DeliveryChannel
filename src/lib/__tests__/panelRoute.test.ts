import { describe, expect, it } from 'vitest';
import { isPanelPathname, panelRouteHash, readPanelRoute, toolsPathRedirect } from '../panelRoute';

describe('panel routes', () => {
  it('reads pages and sub-tabs from the panel hash', () => {
    expect(readPanelRoute('#/painel/est-marketing?tab=pickup-qr')).toEqual({
      page: 'est-marketing',
      tab: 'pickup-qr',
    });
    expect(readPanelRoute('#/painel/est-orders?tab=PENDING')).toEqual({
      page: 'est-orders',
      tab: 'PENDING',
    });
    expect(readPanelRoute('#/painel/driver?tab=history')).toEqual({
      page: 'driver',
      tab: 'history',
    });
  });

  it('writes page and sub-tab routes in the expected hash format', () => {
    expect(panelRouteHash({ page: 'est-marketing', tab: 'pickup-qr' }))
      .toBe('#/painel/est-marketing?tab=pickup-qr');
    expect(panelRouteHash({ page: 'est-dashboard' })).toBe('#/painel/est-dashboard');
  });

  it('ignores unrelated hashes and unknown panel routes', () => {
    expect(readPanelRoute('#access_token=secret')).toBeNull();
    expect(readPanelRoute('#/painel/not-a-panel-page')).toBeNull();
  });

  it('limits URL persistence to panel entry paths', () => {
    expect(isPanelPathname('/')).toBe(true);
    expect(isPanelPathname('/garcom')).toBe(true);
    expect(isPanelPathname('/entregador')).toBe(true);
    for (const pathname of ['/mesa/token', '/cozinha', '/chegada/code', '/app/store']) {
      expect(isPanelPathname(pathname)).toBe(false);
    }
  });
});

describe('Ferramentas (antigo Módulos)', () => {
  it('endereço novo e antigos abrem a mesma página; o hash escrito é o novo', () => {
    expect(readPanelRoute('#/painel/ferramentas')).toEqual({ page: 'est-modules', tab: undefined });
    expect(readPanelRoute('#/painel/modulos')).toEqual({ page: 'est-modules', tab: undefined });
    expect(readPanelRoute('#/painel/est-modules')).toEqual({ page: 'est-modules', tab: undefined });
    expect(panelRouteHash({ page: 'est-modules' })).toBe('#/painel/ferramentas');
  });
  it('/modulos e /ferramentas redirecionam para dentro do painel; outros caminhos não', () => {
    expect(toolsPathRedirect('/modulos')).toBe('/#/painel/ferramentas');
    expect(toolsPathRedirect('/ferramentas/')).toBe('/#/painel/ferramentas');
    expect(toolsPathRedirect('/app/modulos')).toBeNull();
    expect(toolsPathRedirect('/')).toBeNull();
    expect(toolsPathRedirect('/garcom')).toBeNull();
  });
});

