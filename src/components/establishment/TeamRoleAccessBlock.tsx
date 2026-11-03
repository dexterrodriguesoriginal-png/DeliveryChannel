import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check } from 'lucide-react';
import type { RoleId } from '../../types';
import { TEAM_ROLE_LABELS, teamRolePath } from '../../lib/teamAccess';

/** Os links nunca contêm dados pessoais nem tokens de sessão. O convite é validado no destino. */
export const TeamRoleAccessBlock: React.FC<{ slug: string; role: RoleId }> = ({ slug, role }) => {
  const [copied, setCopied] = useState(false);
  const path = teamRolePath(slug, role);
  const url = `${window.location.origin}${path}`;
  const label = TEAM_ROLE_LABELS[role] || role;
  return <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3" data-testid={`team-access-${role}`}>
    <QRCodeSVG value={url} size={112} level="M" aria-label={`QR Code de acesso: ${label}`} />
    <div className="min-w-0 flex-1 space-y-2 text-xs">
      <p className="font-semibold text-gray-800">Acesso: {label}</p>
      <p className="text-gray-600">{role === 'OWNER' ? 'Entre com sua conta de dono.' : 'Use o e-mail convidado para criar a conta e entrar na sua área.'}</p>
      {role === 'WAITER' && <p className="text-gray-600">Quem já recebeu usuário e senha entra em <a href={teamRolePath(slug, role, false)} className="font-semibold underline">Entrar como garçom</a>.</p>}
      <a className="block break-all font-mono text-[11px] text-emerald-800 underline" href={path}>{url}</a>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }} className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 font-semibold">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Link copiado' : `Copiar link de ${label}`}</button>
    </div>
  </div>;
};
