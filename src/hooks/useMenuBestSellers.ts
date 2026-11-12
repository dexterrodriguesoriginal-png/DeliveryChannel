import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
export function useMenuBestSellers(tenantId: string) {
 const [result,setResult]=useState<{tenant:string;ids:string[]}>({tenant:'',ids:[]});
 useEffect(()=>{
  let alive=true;
  async function load() {
   if (!tenantId || !isSupabaseConfigured) return;
   try {
    const {data,error}=await supabase.rpc('get_menu_best_sellers',{p_tenant:tenantId});
    if(alive) setResult({tenant:tenantId,ids:error?[]:(data||[]).map((r:{product_id:string})=>r.product_id)});
   } catch { if(alive) setResult({tenant:tenantId,ids:[]}); }
  }
  void load(); const timer=setInterval(()=>void load(),60000);
  return ()=>{alive=false;clearInterval(timer);};
 },[tenantId]);
 return result.tenant===tenantId?result.ids:[];
}
