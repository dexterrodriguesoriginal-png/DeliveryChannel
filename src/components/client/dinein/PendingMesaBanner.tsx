import React, { useState } from 'react';
import { Utensils, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { clearPendingMesa, inviteUrl, readPendingMesaDetails } from '../../../lib/customer/tableAccess';
import { tableAppUrl } from '../../../lib/salon/tableQr';

/**
 * Cliente que criou a conta durante a abertura de uma mesa e voltou pelo link do e-mail (cai na vitrine, sem ?mesa=):
 * oferece voltar para a mesa. Nunca redireciona sozinho.
 */
export const PendingMesaBanner: React.FC<{ slug: string }> = ({ slug }) => {
  const { supabaseUser } = useAuth();
  const [pending, setPending] = useState<{ token: string; inviteCode?: string } | null>(() => (typeof localStorage === 'undefined' ? null : readPendingMesaDetails(localStorage)));
  if (!pending?.token || !supabaseUser || supabaseUser.is_anonymous) return null;
  const href = pending.inviteCode
    ? inviteUrl(window.location.origin, slug, pending.token, pending.inviteCode) || tableAppUrl(window.location.origin, slug, pending.token)
    : tableAppUrl(window.location.origin, slug, pending.token);
  if (!href) return null;
  return (
    <div role="status" data-testid="pending-mesa-banner" className="fixed inset-x-3 top-3 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-emerald-700 p-3 text-white shadow-2xl">
      <Utensils className="h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm font-semibold">{pending.inviteCode ? 'Você tinha um convite de mesa. Quer entrar na mesa?' : 'Você estava abrindo uma mesa. Quer continuar?'}</p>
      <a href={href} className="shrink-0 rounded-xl bg-white px-3 py-2 text-sm font-black text-emerald-800">Continuar</a>
      <button type="button" aria-label="Dispensar" onClick={() => { clearPendingMesa(localStorage); setPending(null); }} className="shrink-0 rounded-full p-1.5 hover:bg-white/10"><X className="h-4 w-4" /></button>
    </div>
  );
};
