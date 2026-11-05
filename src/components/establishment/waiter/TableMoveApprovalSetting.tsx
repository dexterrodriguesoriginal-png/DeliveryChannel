import React, { useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../../../lib/supabase';

interface TableMoveApprovalSettingProps {
  tenantId: string;
  userId: string;
  isOwner: boolean;
}

/** A troca de loja, usuário ou papel descarta inclusive respostas ainda em voo. */
export const TableMoveApprovalSetting: React.FC<TableMoveApprovalSettingProps> = ({ tenantId, userId, isOwner }) => (
  isOwner && tenantId && userId
    ? <OwnerTableMoveApprovalSetting key={`${tenantId}:${userId}`} tenantId={tenantId} />
    : null
);

const OwnerTableMoveApprovalSetting: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const mounted = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let current = true;
    const load = async () => {
      try {
        if (!isSupabaseConfigured) throw new Error('unconfigured');
        const { data, error: queryError } = await supabase.from('waiter_service_settings')
          .select('allow_waiter_table_move_approval').eq('tenant_id', tenantId).maybeSingle();
        if (queryError) throw queryError;
        if (current) setEnabled(data?.allow_waiter_table_move_approval === true);
      } catch {
        if (current) setError('Não foi possível carregar a permissão de mudança de mesa. Atualize a página para tentar novamente.');
      } finally {
        if (current) setLoading(false);
      }
    };
    void load();
    return () => { current = false; mounted.current = false; };
  }, [tenantId]);

  const toggle = async () => {
    if (loading || savingRef.current || error) return;
    const next = !enabled;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    try {
      const { error: saveError } = await supabase.rpc('set_waiter_table_move_approval', {
        p_tenant: tenantId,
        p_enabled: next,
      });
      if (saveError) throw saveError;
      if (!mounted.current) return;
      setEnabled(next);
      setSaved(true);
    } catch {
      if (mounted.current) setError('Não foi possível salvar a permissão. Atualize a página e tente novamente.');
    } finally {
      if (mounted.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs">
      <label className="flex items-center justify-between gap-3 font-semibold text-gray-800">
        <span>Garçom pode autorizar mudança de mesa</span>
        <input type="checkbox" role="switch" checked={enabled} disabled={loading || saving || !!error}
          onChange={() => void toggle()} aria-describedby="table-move-approval-hint" />
      </label>
      <p id="table-move-approval-hint" className="mt-1 text-gray-600">Desligada por padrão. Ao habilitar, garçons com acesso à mesa podem autorizar ou recusar a solicitação do cliente.</p>
      {loading && <p role="status" className="mt-2 text-gray-600">Carregando permissão…</p>}
      {saving && <p role="status" className="mt-2 text-gray-600">Salvando permissão…</p>}
      {saved && <p role="status" className="mt-2 text-emerald-800">Permissão salva.</p>}
      {error && <p role="alert" className="mt-2 text-rose-800">{error}</p>}
    </div>
  );
};

