// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DineInPremiumMenu } from '../DineInPremiumMenu';
import { repeatItem, type ReorderItem } from '../../../../lib/customer/dineInReorder';
import type { Product } from '../../../../types';
const state=vi.hoisted(()=>({ids:['p']}));
vi.mock('../../../../hooks/useMenuBestSellers',()=>({useMenuBestSellers:()=>state.ids}));
afterEach(()=>{cleanup();state.ids=['p'];});
const product:Product={id:'p',tenantId:'t',categoryId:'c',name:'Hambúrguer',description:'',price:18,imageUrl:'',isActive:true,isAvailable:true,stockQuantity:10,unit:'un'};
const item:ReorderItem={id:'i',productId:'p',name:'Hambúrguer',quantity:2,notes:'Sem cebola',options:[]};
function props(){return {tenantId:'t',storeName:'Loja',categories:[{id:'c',tenantId:'t',name:'Lanches',order:0,isActive:true}],products:[product],cartCount:0,orderingDisabled:false,onGoHome:vi.fn(),onOpenCart:vi.fn(),onOpenTable:vi.fn(),onOpenExpenses:vi.fn(),onAddProduct:vi.fn(),onOpenProduct:vi.fn()};}
describe('Pedir de novo e destaque',()=>{
 it.each(['MESA','TOTEM'] as const)('mostra selo e repete do card e de Seus pedidos em %s',variant=>{
  const onRepeat=vi.fn();render(<DineInPremiumMenu {...props()} variant={variant} reorderItems={[item]} onRepeat={onRepeat}/>);
  expect(screen.getByText('Mais pedido da casa')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Pedir de novo Hambúrguer'}));
  fireEvent.click(screen.getByRole('button',{name:/^Pedir de novo$/}));
  expect(onRepeat).toHaveBeenNthCalledWith(1,item);expect(onRepeat).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('kiosk-products-grid').getAttribute('data-columns')).toBe('3');
 });
 it('oculta selo desligado e ações sem histórico da sessão',()=>{
  state.ids=[];render(<DineInPremiumMenu {...props()}/>);
  expect(screen.queryByText('Mais pedido da casa')).toBeNull();expect(screen.queryByText('Pedir de novo')).toBeNull();
 });
 it('adiciona para confirmar, preserva observações e usa preço atual',()=>{
  const result=repeatItem([],item,{...product,price:22});
  expect(result[0]).toMatchObject({quantity:2,notes:'Sem cebola',product:{price:22}});
  expect(repeatItem(result,{...item,notes:'Bem passado'},product)).toHaveLength(2);
 });
 it('não adiciona produto ausente, indisponível ou estoque insuficiente',()=>{
  for(const p of [undefined,{...product,isAvailable:false},{...product,isActive:false},{...product,stockQuantity:1}])expect(()=>repeatItem([],item,p)).toThrow(/disponível/);
  const cart=repeatItem([],{...item,quantity:9},product);
  expect(()=>repeatItem(cart,item,product)).toThrow(/disponível/);expect(cart[0].quantity).toBe(9);
 });
 it('preserva adicionais e rejeita adicional esgotado',()=>{
  const option={id:'o',tenantId:'t',groupId:'g',name:'Queijo',extraPriceCents:200,active:true,soldOut:false,sort:0};
  const group={id:'g',tenantId:'t',name:'Adicionais',type:'STANDARD' as const,minSelect:0,maxSelect:2,allowRepeat:true,pricingRule:'SUM' as const,active:true,sort:0,options:[option]};
  const selected={...item,options:[{groupId:'g',optionId:'o',qty:2}]};
  expect(repeatItem([],selected,{...product,optionGroups:[group]})[0].options).toEqual(selected.options);
  expect(()=>repeatItem([],selected,{...product,optionGroups:[{...group,options:[{...option,soldOut:true}]}]})).toThrow(/adicionais/);
 });
});
