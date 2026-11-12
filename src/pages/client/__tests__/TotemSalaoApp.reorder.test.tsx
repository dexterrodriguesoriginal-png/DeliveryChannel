// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_MENU_THEME } from '../../../lib/theme/menuTheme';
import { DEFAULT_TOTEM_DESIGN } from '../../../lib/menu/totemDesign';
import { DEFAULT_TOTEM_WELCOME } from '../../../lib/menu/totemWelcome';
const h=vi.hoisted(()=>({create:vi.fn(),product:vi.fn(),status:vi.fn(),session:vi.fn()}));
vi.mock('../../../lib/supabase',()=>({isSupabaseConfigured:true,supabase:{rpc:vi.fn()}}));
vi.mock('../../../repositories/totemAccessRepository',()=>({totemAccessRepository:{
 loadLogin:async()=>null,readSession:h.session,loadStore:async()=>({status:'ok',store:{design:DEFAULT_TOTEM_DESIGN,welcome:DEFAULT_TOTEM_WELCOME,data:{tenant:{id:'t',name:'Loja'},products:[product],categories:[],offers:[],menuTheme:DEFAULT_MENU_THEME}}}),
 createOrder:h.create,getPaymentStatus:h.status,
}}));
vi.mock('../../../repositories/reorderRepository',()=>({reorderRepository:{product:h.product}}));
vi.mock('../../../repositories/tenantModuleRepository',()=>({tenantModuleRepository:{getPublicEnabled:async()=>new Set()}}));
vi.mock('../../../repositories/menuHeaderRepository',()=>({menuHeaderRepository:{loadPublic:async()=>({})}}));
vi.mock('../../../repositories/totemWelcomeRepository',()=>({totemWelcomeRepository:{loadPublic:async()=>DEFAULT_TOTEM_WELCOME}}));
vi.mock('../../../repositories/menuOutdoorRepository',()=>({menuOutdoorRepository:{getPublicSlides:async()=>[]}}));
vi.mock('../../../components/client/totem/TotemInstallOverlay',()=>({TotemInstallOverlay:()=>null}));
vi.mock('../../../components/client/totem/TotemCapaScreen',()=>({TotemCapaScreen:({onStart}:any)=><button onClick={onStart}>Começar</button>}));
vi.mock('../../../components/client/totem/TotemKioskLayer',()=>({TotemKioskLayer:({enabled,onIdle}:any)=>enabled?<button onClick={onIdle}>Inatividade</button>:null}));
vi.mock('../../../components/client/totem/DineInPremiumMenu',()=>({DineInPremiumMenu:({reorderItems,onRepeat,onAddProduct,onCheckoutOrder,cartCount}:any)=><div>
 <span data-testid="cart-count">{cartCount}</span><button onClick={()=>onAddProduct(product)}>Adicionar</button><button onClick={onCheckoutOrder}>Revisar</button>
 {reorderItems.map((item:any)=><button key={item.id} onClick={()=>onRepeat(item)}>Repetir</button>)}
 </div>}));
import { TotemSalaoApp } from '../TotemSalaoApp';
const product={id:'p',tenantId:'t',name:'Produto',price:10,isActive:true,isAvailable:true,stockQuantity:100};
beforeEach(()=>{
 h.session.mockReturnValue({token:'device-a'});
 h.create.mockReset().mockResolvedValue({orderId:'o',paymentStatus:'PAID',pickupCode:'123',autoPrint:false});
 h.product.mockReset().mockResolvedValue(product);
 h.status.mockReset().mockResolvedValue({orderId:'o',paymentStatus:'PAID',pickupCode:'123'});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
async function start(){fireEvent.click(await screen.findByText('Começar'));await screen.findByText('Adicionar');}
async function pay(){
 fireEvent.click(screen.getByText('Adicionar'));fireEvent.click(screen.getByText('Revisar'));
 fireEvent.click(screen.getByTestId('totem-checkout-confirm'));
 await screen.findByText('Continuar pedindo');
}
it('repete somente no atendimento atual, confirma no carrinho e limpa ao iniciar novo pedido',async()=>{
 render(<TotemSalaoApp slug="loja"/>);await start();await pay();
 fireEvent.click(screen.getByText('Continuar pedindo'));fireEvent.click(screen.getByText('Repetir'));
 await screen.findByTestId('totem-checkout-review');
 expect(h.product).toHaveBeenCalledWith('loja','t','p');
 expect(h.create).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByTestId('totem-checkout-confirm'));await screen.findByText('Continuar pedindo');
 fireEvent.click(screen.getByTestId('totem-new-order'));await start();
 expect(screen.queryByText('Repetir')).toBeNull();expect(screen.getByTestId('cart-count').textContent).toBe('0');
});
it('inatividade limpa o histórico inclusive durante a revisão do carrinho',async()=>{
 render(<TotemSalaoApp slug="loja"/>);await start();await pay();
 fireEvent.click(screen.getByText('Continuar pedindo'));fireEvent.click(screen.getByText('Repetir'));
 await screen.findByTestId('totem-checkout-review');fireEvent.click(screen.getByText('Inatividade'));await start();
 expect(screen.queryByText('Repetir')).toBeNull();expect(screen.queryByTestId('totem-checkout-review')).toBeNull();
});
it('ignora repetição pendente quando muda loja/dispositivo e limpa o carrinho anterior',async()=>{
 let finish!:(value:unknown)=>void;h.product.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(<TotemSalaoApp slug="loja"/>);await start();await pay();
 fireEvent.click(screen.getByText('Continuar pedindo'));fireEvent.click(screen.getByText('Repetir'));
 h.session.mockReturnValue({token:'device-b'});rerender(<TotemSalaoApp slug="outra"/>);await start();
 await act(async()=>finish(product));
 await waitFor(()=>expect(screen.getByTestId('cart-count').textContent).toBe('0'));
 expect(screen.queryByText('Repetir')).toBeNull();expect(screen.queryByTestId('totem-checkout-review')).toBeNull();
});
it('protege o envio e a espera de pagamento contra inatividade; só libera continuação após pagar',async()=>{
 let finish!:(value:unknown)=>void;
 h.create.mockResolvedValue({orderId:'o',paymentStatus:'PENDING'});
 h.status.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<TotemSalaoApp slug="loja"/>);await start();
 fireEvent.click(screen.getByText('Adicionar'));fireEvent.click(screen.getByText('Revisar'));
 fireEvent.click(screen.getByTestId('totem-checkout-confirm'));
 await screen.findByTestId('totem-payment-wait');
 expect(screen.queryByText('Inatividade')).toBeNull();
 expect(screen.queryByText('Continuar pedindo')).toBeNull();
 await act(async()=>finish({orderId:'o',paymentStatus:'PAID',pickupCode:'123'}));
 await screen.findByText('Continuar pedindo');
 fireEvent.click(screen.getByText('Continuar pedindo'));
 expect(screen.getByText('Repetir')).toBeTruthy();
});
