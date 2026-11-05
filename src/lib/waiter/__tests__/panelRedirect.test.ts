import { expect, it } from 'vitest';
import { waiterPanelTarget } from '../panelRedirect';
it.each([
  ['/', '#/painel/est-salon'], ['/painel/est-orders', ''], ['/painel', ''], ['/', ''], ['/garcom/loja', '#/painel/est-dashboard'],
])('redireciona garçom sem renderizar painel em %s%s', (pathname, hash) => {
  expect(waiterPanelTarget('WAITER', 'loja com espaço', {pathname,hash})).toBe('/garcom/loja%20com%20espa%C3%A7o');
});
it.each(['/app/loja','/mesa/token','/equipe/convite','/garcom/loja','/garcom'])('preserva área pública/dedicada %s',(pathname)=>{
  expect(waiterPanelTarget('WAITER','loja',{pathname,hash:''})).toBeNull();
});
it('aguarda slug e respeita o papel resolvido',()=>{
  expect(waiterPanelTarget('OWNER','loja',{pathname:'/',hash:'#/painel/est-salon'})).toBeNull();
  expect(waiterPanelTarget('WAITER',undefined,{pathname:'/',hash:''})).toBeNull();
});

