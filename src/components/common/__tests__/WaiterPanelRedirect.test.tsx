// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WaiterPanelRedirect } from '../WaiterPanelRedirect';
import { waiterPanelTarget } from '../../../lib/waiter/panelRedirect';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('link administrativo de garçom navega ao app da própria loja com recuperação visível',()=>{
  const replace=vi.spyOn(window.location,'replace').mockImplementation(()=>{});
  const target=waiterPanelTarget('WAITER','minha-loja',{pathname:'/',hash:'#/painel/est-salon'})!;
  render(<WaiterPanelRedirect target={target}/>);
  expect(replace).toHaveBeenCalledWith('/garcom/minha-loja');
  expect(screen.getByRole('status').textContent).toContain('Abrindo o app do garçom');
  expect(screen.getByRole('link',{name:'Continuar atendimento'}).getAttribute('href')).toBe('/garcom/minha-loja');
});
