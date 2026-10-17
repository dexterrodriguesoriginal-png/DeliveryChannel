/** Barra "Vitrine do Cliente • Visualização em Tempo Real" só para equipe autenticada do próprio tenant. */
export function isStaffPreview(authenticated: boolean, activeTenantId: string | null | undefined, storeTenantId: string | null | undefined): boolean {
  return authenticated && !!activeTenantId && !!storeTenantId && activeTenantId === storeTenantId;
}
