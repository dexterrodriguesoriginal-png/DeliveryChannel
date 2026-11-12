// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SecurityContext } from '../../../../../services/securityEngine';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),products:vi.fn()}));
vi.mock('../../../../../lib/supabase',()=>({isSupabaseConfigured:true,supabase:{rpc:mocks.rpc}}));
vi.mock('../../../../../repositories/productRepository',()=>({productRepository:{getProducts:mocks.products}}));
import { BestSellersPanel } from '../BestSellersPanel';
const context={userId:'owner',userRole:'OWNER',tenantId:'shop'} as SecurityContext;
beforeEach(()=>{
 mocks.rpc.mockReset().mockResolvedValue({data:{enabled:true,productIds:[]},error:null});
 mocks.products.mockReset().mockResolvedValue([1,2,3,4].map(n=>({id:`p${n}`,name:`Produto ${n}`})));
});
afterEach(cleanup);
it('salva somente a loja autorizada e limita os pinos a três na ordem de seleção',async()=>{
 render(<BestSellersPanel tenantId="shop" securityContext={context}/>);
 await screen.findByText('Produto 1');
 fireEvent.click(screen.getByLabelText('Produto 3'));
 fireEvent.click(screen.getByLabelText('Produto 1'));
 fireEvent.click(screen.getByLabelText('Produto 2'));
 expect((screen.getByLabelText('Produto 4') as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(screen.getByLabelText('Exibir selo no cardápio da mesa e no totem'));
 fireEvent.click(screen.getByText('Salvar destaques'));
 await screen.findByText('Destaques salvos.');
 expect(mocks.rpc).toHaveBeenLastCalledWith('set_menu_best_seller_settings',{p_tenant:'shop',p_enabled:false,p_products:['p3','p1','p2']});
});
it('não consulta nem edita destaques de outra loja ou papel sem permissão',()=>{
 const {rerender}=render(<BestSellersPanel tenantId="other" securityContext={context}/>);
 rerender(<BestSellersPanel tenantId="shop" securityContext={{...context,userRole:'CASHIER'}}/>);
 expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.products).not.toHaveBeenCalled();
});
it('impede salvar configuração desconhecida quando a leitura falha',async()=>{
 mocks.rpc.mockResolvedValue({error:new Error('falha')});
 render(<BestSellersPanel tenantId="shop" securityContext={context}/>);
 await screen.findByText('Não foi possível carregar os destaques.');
 expect((screen.getByText('Salvar destaques') as HTMLButtonElement).disabled).toBe(true);
});
it('ignora leitura atrasada da loja anterior',async()=>{
 let finish!:(value:unknown)=>void;
 mocks.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(<BestSellersPanel tenantId="shop" securityContext={context}/>);
 rerender(<BestSellersPanel tenantId="other" securityContext={{...context,tenantId:'other'}}/>);
 await screen.findByText('Produto 1');
 finish({data:{enabled:false,productIds:['p4']},error:null});
 await waitFor(()=>expect((screen.getByLabelText('Produto 4') as HTMLInputElement).checked).toBe(false));
 expect((screen.getByLabelText('Exibir selo no cardápio da mesa e no totem') as HTMLInputElement).checked).toBe(true);
});
