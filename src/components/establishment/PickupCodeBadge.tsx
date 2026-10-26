import React, { useCallback, useEffect, useState } from 'react';
import { handoffRepository } from '../../repositories/handoffRepository';
import { HandoffCodeForm } from '../driver/HandoffCodeForm';
import { useAuth } from '../../context/AuthContext';
/** Store validates the assigned partner's code. No pickup code is disclosed to staff. */
export const PickupCodeBadge: React.FC<{ orderId: string; status: string; onDone?: () => void | Promise<void> }> = ({ orderId, status, onDone }) => {
  const { activeRole } = useAuth();
  const canReset = activeRole === 'OWNER' || activeRole === 'MANAGER';
  const [info, setInfo] = useState<{ pickupLocked: boolean; deliveryLocked: boolean; confirmed: boolean } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [version, setVersion] = useState(0);
  const load = useCallback(async () => { setInfo(await handoffRepository.getStatus(orderId)); }, [orderId]);
  useEffect(() => { let alive = true; const refresh = () => handoffRepository.getStatus(orderId).then(r => { if (alive) setInfo(r); }).catch(() => { if (alive) setError('Não foi possível consultar o código.'); }); void refresh(); const t = window.setInterval(refresh, 5000); return () => { alive = false; window.clearInterval(t); }; }, [orderId, status]);
  const kind = status === 'OUT_FOR_DELIVERY' ? 'delivery' : 'pickup';
  const locked = kind === 'pickup' ? info?.pickupLocked : info?.deliveryLocked;
  return <section className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2" data-testid="pickup-code">
    {kind === 'pickup' && !info?.confirmed && <><p className="font-bold">Peça o código ao entregador</p>{['READY','WAITING_FOR_DRIVER'].includes(status) && <HandoffCodeForm key={version} orderId={orderId} kind="pickup" onDone={async () => { await load(); await onDone?.(); }} />}</>}
    {info?.confirmed && <p>Retirada confirmada ✓</p>}
    {locked && <p role="status">Código bloqueado após 5 tentativas.</p>}
    {locked && canReset && <button disabled={busy} className="underline font-semibold" onClick={async () => { setBusy(true); setError(''); try { await handoffRepository.reset(orderId, kind); await load(); setVersion(v => v + 1); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>Desbloquear e gerar novo código</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
};
