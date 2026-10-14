/**
 * Gating da PRÉVIA da sacola/checkout sem login (somente modo demonstração local).
 *
 * Retorna true SOMENTE quando o Supabase NÃO está configurado E
 * VITE_ENABLE_DEMO_MODE === 'true'. Em qualquer build com Supabase real
 * (isSupabaseConfigured === true) retorna false, mantendo a barreira de login.
 *
 * Isto NÃO autentica ninguém e NÃO permite criar pedidos: handleFinishOrder
 * continua exigindo supabaseUser. Apenas a visualização (modalidade + totais)
 * é liberada no demo.
 */
export function canPreviewCheckoutWithoutLogin(
  supabaseConfigured: boolean,
  demoModeFlag: string | boolean | undefined
): boolean {
  return supabaseConfigured === false && (demoModeFlag === 'true' || demoModeFlag === true);
}
