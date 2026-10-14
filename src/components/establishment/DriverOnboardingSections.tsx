import React from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Phone, CheckCircle2, XCircle, Ban, RefreshCw, Trash2, Clock, Link2 } from 'lucide-react';
import type { Driver } from '../../types';
import type { DriverInviteLink } from '../../repositories/driverRepository';
import { linkActionsFor, DriverLinkAction } from '../../lib/driverAdmin';

/** Seção "Pendentes de aprovação" (só OWNER/MANAGER). */
export const PendingApplicationsSection: React.FC<{
  drivers: Driver[];
  busyId?: string | null;
  onApprove: (d: Driver) => void;
  onReject: (d: Driver) => void;
}> = ({ drivers, busyId, onApprove, onReject }) => {
  if (drivers.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
        <Clock className="w-4 h-4 text-amber-600" />
        Pendentes de aprovação ({drivers.length})
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {drivers.map(d => (
          <Card key={d.id} className="p-4 border-amber-200 bg-amber-50/20 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-gray-900">{d.name}</h4>
              <p className="text-xs text-gray-500 font-mono flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {d.phone || 'Sem telefone'}
              </p>
              <p className="text-[11px] text-gray-500">Cadastro em {d.createdAt ? d.createdAt.split('T')[0] : 'N/A'}</p>
            </div>
            <div className="pt-2 border-t border-amber-100 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={busyId === d.id} onClick={() => onReject(d)}
                leftIcon={<XCircle className="w-3 h-3 text-rose-500" />} className="text-xs text-rose-600 hover:bg-rose-50">
                Rejeitar
              </Button>
              <Button variant="primary" size="sm" disabled={busyId === d.id} onClick={() => onApprove(d)}
                leftIcon={<CheckCircle2 className="w-3 h-3" />} className="text-xs">
                Aprovar
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

const ACTION_LABEL: Record<DriverLinkAction, string> = { SUSPEND: 'Suspender', REACTIVATE: 'Reativar', REMOVE: 'Remover' };

/** Ações de vínculo no card do entregador (só OWNER/MANAGER). */
export const DriverLinkActions: React.FC<{
  driver: Driver;
  canReview: boolean;
  onAction: (d: Driver, action: DriverLinkAction) => void;
}> = ({ driver, canReview, onAction }) => {
  const approval = driver.approvalStatus ?? 'UNKNOWN';
  if (approval === 'REJECTED' || approval === 'REMOVED') {
    return <span className="text-[11px] text-gray-500">Para readmitir, envie um convite por e-mail</span>;
  }
  if (!canReview) return null;
  return (
    <div className="flex items-center gap-1">
      {linkActionsFor(approval).map(a => (
        <Button key={a} variant="ghost" size="sm" onClick={() => onAction(driver, a)}
          leftIcon={a === 'REACTIVATE' ? <RefreshCw className="w-3 h-3 text-emerald-600" /> : a === 'REMOVE' ? <Trash2 className="w-3 h-3 text-rose-500" /> : <Ban className="w-3 h-3 text-rose-500" />}
          className={a === 'REACTIVATE' ? 'text-xs text-emerald-700 hover:bg-emerald-50' : 'text-xs text-rose-600 hover:bg-rose-50'}>
          {ACTION_LABEL[a]}
        </Button>
      ))}
    </div>
  );
};

const LINK_STATE_BADGE = {
  ACTIVE: { label: 'Ativo', variant: 'success' },
  EXPIRED: { label: 'Expirado', variant: 'neutral' },
  REVOKED: { label: 'Revogado', variant: 'danger' },
} as const;

/** Lista "Convites por link" (OWNER/MANAGER/DELIVERY_MANAGER). Nunca mostra token (a listagem não o tem). */
export const InviteLinksSection: React.FC<{
  links: DriverInviteLink[];
  error?: string | null;
  busyId?: string | null;
  onRenew: (l: DriverInviteLink) => void;
  onRevoke: (l: DriverInviteLink) => void;
}> = ({ links, error, busyId, onRenew, onRevoke }) => (
  <div className="space-y-3 pt-4 border-t border-gray-200">
    <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
      <Link2 className="w-4 h-4 text-emerald-700" />
      Convites por link ({links.length})
    </h3>
    {error ? (
      <p className="text-xs text-gray-500">{error}</p>
    ) : links.length === 0 ? (
      <p className="text-xs text-gray-500">Nenhum link de convite gerado.</p>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {links.map(l => {
          const b = LINK_STATE_BADGE[l.state];
          return (
            <Card key={l.id} className="p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-bold text-xs text-gray-900">{l.label || 'Link de convite'}</h4>
                  <p className="text-[11px] text-gray-500">Usos: {l.uses}{l.maxUses ? ` / ${l.maxUses}` : ''}</p>
                  <p className="text-[11px] text-gray-500">Validade: {new Date(l.expiresAt).toLocaleString('pt-BR')}</p>
                </div>
                <Badge variant={b.variant} size="sm">{b.label}</Badge>
              </div>
              <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" disabled={busyId === l.id} onClick={() => onRenew(l)} className="text-xs">
                  Renovar
                </Button>
                {l.state === 'ACTIVE' && (
                  <Button variant="ghost" size="sm" disabled={busyId === l.id} onClick={() => onRevoke(l)} className="text-xs text-rose-600 hover:bg-rose-50">
                    Revogar
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    )}
  </div>
);
