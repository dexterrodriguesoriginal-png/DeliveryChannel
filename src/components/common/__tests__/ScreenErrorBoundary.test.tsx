// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScreenErrorBoundary } from '../ScreenErrorBoundary';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('erro de render mantém recuperação, oculta detalhes e permite voltar ao atendimento',()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{});
  let fail=true;
  const Page=()=>{if(fail)throw new Error('Detalhe interno confidencial');return <p>Atendimento recuperado</p>;};
  render(<ScreenErrorBoundary><Page/></ScreenErrorBoundary>);
  expect(screen.getByRole('alert').textContent).toContain('Não foi possível abrir esta tela');
  expect(screen.queryByText('Detalhe interno confidencial')).toBeNull();
  expect(screen.getByRole('link',{name:'Voltar ao início'}).getAttribute('href')).toBe('/');
  fail=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
  expect(screen.getByText('Atendimento recuperado')).toBeTruthy();
});

