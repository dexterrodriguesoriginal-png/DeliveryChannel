import React from 'react';
import { BellRing, Check, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useModules } from '../../../hooks/useModules';
import { usePendingApprovals } from '../../../hooks/usePendingApprovals';
import { mesasQrRepository } from '../../../repositories/mesasQrRepository';
import type { PendingApproval } from '../../../repositories/salonStaffRepository';

/** One pending person: "Mesa 04 · Carlos quer pedir" with one-click Aprovar / Recusar. Shared by the panel alert and the waiter app. */
export const ApprovalRow: React.FC<{
  item: PendingApproval;
  busy: boolean;
  canReject: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onOpenTable?: (tableId: string) => void;
  large?: boolean;
}> = ({ item, busy, canReject, onApprove, onReject, onOpenTable, large }) => (
  <div data-testid={`approval-${item.sessionId}`} className={`flex items-center gap-3 rounded-2xl border border-amber-200 bg-white ${large ? 'p-4' : 'p-3'} shadow-sm`}>
    <button type="button" onClick={() => onOpenTable?.(item.tableId)} className="min-w-0 flex-1 text-left" aria-label={`Abrir ${item.tableLabel}`}>
      <p className={`truncate font-black text-slate-900 ${large ? 'text-base' : 'text-sm'}`}>{item.tableLabel}</p>
      <p className="truncate text-xs text-slate-600">{item.displayName} quer pedir</p>
    </button>
    <div className="flex shrink-0 gap-2">
      {canReject && <button type="button" disabled={busy} onClick={() => onReject(item.sessionId)} aria-label={`Recusar ${item.displayName}`} className={`inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white font-bold text-rose-700 disabled:opacity-50 ${large ? 'px-4 py-3 text-sm' : 'px-2.5 py-2 text-xs'}`}><X className="h-4 w-4" aria-hidden="true" />Recusar</button>}
      <button type="button" disabled={busy} onClick={() => onApprove(item.sessionId)} aria-label={`Aprovar ${item.displayName}`} className={`inline-flex items-center gap-1 rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-50 ${large ? 'px-4 py-3 text-sm' : 'px-3 py-2 text-xs'}`}><Check className="h-4 w-4" aria-hidden="true" />Aprovar</button>
    </div>
  </div>
);

/**
 * Floating alert in the owner panel: a person scanned a table QR and waits for release. Beeps on arrival,
 * reminds every 30 s, one-click Aprovar/Recusar. Renders nothing when nobody is waiting.
 */
export const ApprovalsAlert: React.FC<{
  tenantId?: string;
  enabled: boolean;
  /** Recusar needs the access-model migration; hidden before it. */
  canReject: boolean;
  onOpenTable?: (tableId: string) => void;
}> = ({ tenantId, enabled, canReject, onOpenTable }) => {
  const { pending, busyId, error, approve, reject } = usePendingApprovals(tenantId, enabled);
  if (!enabled || !pending.length) return null;
  return (
    <aside role="alert" aria-live="assertive" data-testid="approvals-alert" className="fixed inset-x-2 bottom-3 z-[70] mx-auto max-w-md rounded-3xl border border-amber-300 bg-amber-50/95 p-3 shadow-2xl backdrop-blur sm:inset-x-auto sm:bottom-5 sm:right-5 sm:mx-0 sm:w-[26rem]">
      <div className="mb-2 flex items-center gap-2 px-1"><BellRing className="h-5 w-5 animate-bounce text-amber-600" aria-hidden="true" /><p className="text-sm font-black text-amber-950">{pending.length === 1 ? '1 mesa aguardando liberação' : `${pending.length} pessoas aguardando liberação`}</p></div>
      <div className="max-h-[50vh] space-y-2 overflow-y-auto">
        {pending.map(item => <ApprovalRow key={item.sessionId} item={item} busy={busyId === item.sessionId} canReject={canReject} onApprove={id => void approve(id)} onReject={id => void reject(id)} onOpenTable={onOpenTable} />)}
      </div>
      {error && <p className="mt-2 px-1 text-xs font-semibold text-rose-700">{error}</p>}
    </aside>
  );
};

export const FOCUS_TABLE_KEY = 'dc:salon-focus-table';

const APPROVER_ROLES = ['OWNER', 'MANAGER', 'WAITER', 'CASHIER'];

/** Mounted once in the owner panel. Self-gated: needs the Salão tool on, a staff role, and a store selected. */
export const PanelApprovalsAlert: React.FC<{ onOpenTable: (tableId: string) => void }> = ({ onOpenTable }) => {
  const { activeTenant, activeRole } = useAuth();
  const { available, isModuleEnabled } = useModules();
  const [canReject, setCanReject] = React.useState(false);
  const enabled = !!activeTenant?.id && available && isModuleEnabled('dine_in') && APPROVER_ROLES.includes(activeRole || '');
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void mesasQrRepository.capabilities().then(caps => { if (alive) setCanReject(caps.tableAccess); });
    return () => { alive = false; };
  }, [enabled, activeTenant?.id]);
  return <ApprovalsAlert tenantId={activeTenant?.id} enabled={enabled} canReject={canReject} onOpenTable={onOpenTable} />;
};
