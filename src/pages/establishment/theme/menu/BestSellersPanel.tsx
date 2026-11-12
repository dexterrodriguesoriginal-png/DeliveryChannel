import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import { productRepository } from '../../../../repositories/productRepository';
import { canManageMenuTheme } from '../../../../repositories/menuThemeRepository';
import type { SecurityContext } from '../../../../services/securityEngine';
import type { Product } from '../../../../types';
export function BestSellersPanel({tenantId,securityContext}:{tenantId:string;securityContext:SecurityContext}) {
 const [products,setProducts]=useState<Product[]>([]);
 const [enabled,setEnabled]=useState(true);
 const [pins,setPins]=useState<string[]>([]);
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const scope=`${tenantId}:${securityContext.userId}:${securityContext.userRole}:${securityContext.tenantId}`;
 const current=useRef(scope);current.current=scope;
 useEffect(()=>{
  let alive=true;setBusy(false);setReady(false);setMessage('');setPins([]);setProducts([]);
  if(!canManageMenuTheme(securityContext,tenantId)) return;
  void Promise.all([productRepository.getProducts(securityContext,tenantId),supabase.rpc('get_menu_best_seller_settings',{p_tenant:tenantId})]).then(([list,result])=>{
   if(!alive)return;
   if(result.error) throw result.error;
   setProducts(list);setEnabled(result.data.enabled);setPins(result.data.productIds);setReady(true);
  }).catch(()=>{if(alive)setMessage('Não foi possível carregar os destaques.');});
  return()=>{alive=false;};
 },[scope]);
 async function save(){
  if(!ready || busy || !canManageMenuTheme(securityContext,tenantId))return;
  const captured=scope;setBusy(true);setMessage('');
  try{
   const {error}=await supabase.rpc('set_menu_best_seller_settings',{p_tenant:tenantId,p_enabled:enabled,p_products:pins});
   if(error)throw error;
   if(current.current===captured)setMessage('Destaques salvos.');
  }catch{if(current.current===captured)setMessage('Não foi possível salvar os destaques. Tente novamente.');}
  finally{if(current.current===captured)setBusy(false);}
 }
 if(!canManageMenuTheme(securityContext,tenantId))return null;
 return <section className="rounded-xl border p-4"><h3>Mais pedido da casa</h3>
 <p>Top 3 por quantidade nos últimos 30 dias, em pedidos pagos ou concluídos. Sem seleção manual, o destaque é automático.</p>
 <label><input type="checkbox" checked={enabled} disabled={!ready||busy} onChange={e=>setEnabled(e.target.checked)}/> Exibir selo no cardápio da mesa e no totem</label>
 <fieldset disabled={!ready||busy}><legend>Fixar produtos manualmente (até 3, na ordem de seleção)</legend>
 {products.map(p=><label key={p.id} className="block"><input type="checkbox" checked={pins.includes(p.id)} disabled={!pins.includes(p.id)&&pins.length===3} onChange={e=>setPins(old=>e.target.checked?[...old,p.id]:old.filter(id=>id!==p.id))}/> {p.name}</label>)}</fieldset>
 <button type="button" disabled={!ready||busy} onClick={()=>void save()}>Salvar destaques</button>
 {message&&<p role="status">{message}</p>}</section>;
}
