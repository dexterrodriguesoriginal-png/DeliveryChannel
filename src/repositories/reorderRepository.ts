import { supabase } from '../lib/supabase';
import { publicStoreRepository } from './publicStoreRepository';
import { productOptionRepository } from './productOptionRepository';
import type { ReorderItem } from '../lib/customer/dineInReorder';
export const reorderRepository = {
 async history(sessionId:string):Promise<ReorderItem[]> {
  const {data,error}=await supabase.rpc('get_session_reorder_items',{p_session:sessionId});
  if(error) throw error;
  return data || [];
 },
 async product(slug:string,tenantId:string,productId:string) {
  const store=await publicStoreRepository.loadPublicStore(slug);
  if(store.status!=='ok' || store.data.tenant.id!==tenantId) throw new Error('Não foi possível verificar a disponibilidade atual.');
  const product=store.data.products.find(p=>p.id===productId && p.tenantId===tenantId);
  if(!product) return undefined;
  const options=await productOptionRepository.getPublicForProducts(tenantId,[productId]);
  return {...product,optionGroups:options.get(productId)||[]};
 }
};
