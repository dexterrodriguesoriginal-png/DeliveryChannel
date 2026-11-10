/** Limpeza compartilhada do logout oficial, inclusive status pendente/recusado do entregador. */
export function clearDeviceSessionStorage(
  local: Pick<Storage, 'length' | 'key' | 'removeItem'>,
  session: Pick<Storage, 'clear'>,
): void {
  const keys: string[] = [];
  for (let i = 0; i < local.length; i++) {
    const key = local.key(i);
    if (key && (key.startsWith('adegafood_') || key.startsWith('deliverychannel_') || key.startsWith('sb-'))) keys.push(key);
  }
  keys.forEach(key => local.removeItem(key));
  session.clear();
}

type SignOutScope = 'global' | 'local';
export async function signOutSupabaseSession(
  auth: { signOut: (options: { scope: SignOutScope }) => Promise<unknown> },
  scope: SignOutScope,
): Promise<void> {
  await auth.signOut({ scope });
}
