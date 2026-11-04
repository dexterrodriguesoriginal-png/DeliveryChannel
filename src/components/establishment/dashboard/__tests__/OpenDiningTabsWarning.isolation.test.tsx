// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
const h = vi.hoisted(() => ({tenant:'A', delay:false, finish:null as null | ((v: unknown) => void)}));
vi.mock('../../../../context/AuthContext', () => ({useAuth:()=>({activeTenant:{id:h.tenant}})}));
vi.mock('../../../../hooks/useModules', () => ({useModules:()=>({available:true,isModuleEnabled:()=>true})}));
vi.mock('../../../../lib/supabase', () => ({supabase:{
  from:(table:string)=>{
    let tenant='';
    const b:any={select:()=>b,eq:(key:string,value:string)=>{if(key==='tenant_id')tenant=value;return b;},in:()=>b,order:()=>b};
    b.then=(resolve:(v:unknown)=>void)=>{
      const data=tenant==='A'?(table==='dining_tabs'?[{id:'tabA',table_id:'mesaA',status:'BILL_REQUESTED',opened_at:new Date().toISOString()}]:[{id:'mesaA',label:'Mesa exclusiva A'}]):[];
      return table==='dining_tabs' && tenant==='A' && h.delay
        ? new Promise(r=>{h.finish=r;}).then(resolve)
        : Promise.resolve({data,error:null}).then(resolve);
    };
    return b;
  },
  channel:()=>{const c:any={on:()=>c,subscribe:()=>c};return c;},removeChannel:vi.fn(),
}}));
import { OpenDiningTabsWarning } from '../OpenDiningTabsWarning';
beforeEach(()=>{h.tenant='A';h.delay=false;h.finish=null;});
afterEach(cleanup);
it('oculta os avisos da loja anterior imediatamente ao trocar de loja', async()=>{
  const view=render(<OpenDiningTabsWarning/>);
  await screen.findByText(/Mesa exclusiva A/);
  h.tenant='B';view.rerender(<OpenDiningTabsWarning/>);
  expect(screen.queryByText(/Mesa exclusiva A/)).toBeNull();
});
it('ignora resposta atrasada de outra loja',async()=>{
  h.delay=true;const view=render(<OpenDiningTabsWarning/>);
  await waitFor(()=>expect(h.finish).not.toBeNull());
  h.tenant='B';view.rerender(<OpenDiningTabsWarning/>);
  await act(async()=>{h.finish!({data:[{id:'tabA',table_id:'mesaA',status:'BILL_REQUESTED',opened_at:new Date().toISOString()}],error:null});});
  expect(screen.queryByText(/Mesa exclusiva A/)).toBeNull();
  expect(screen.queryByTestId('open-dining-tabs-warning')).toBeNull();
});
