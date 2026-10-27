import React from 'react';
import { PowerOff, SlidersHorizontal } from 'lucide-react';
import { moduleLabel, type ModuleKey } from '../../lib/modules';

interface Props {
  moduleKey: ModuleKey;
  canManageModules: boolean;
  onOpenModules?: () => void;
}

export const ModuleDisabledScreen: React.FC<Props> = ({ moduleKey, canManageModules, onOpenModules }) => (
  <div className="mx-auto mt-12 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" data-testid="module-disabled">
    <PowerOff className="mx-auto h-10 w-10 text-slate-400" />
    <h2 className="mt-4 text-lg font-black text-slate-900">Ferramenta desligada — ative em Ferramentas</h2>
    <p className="mt-2 text-sm text-slate-600">
      A ferramenta <strong>{moduleLabel(moduleKey)}</strong> não está ativa nesta loja.
      {canManageModules ? '' : ' Peça ao responsável pela loja para ativá-lo.'}
    </p>
    {canManageModules && onOpenModules && (
      <button type="button" onClick={onOpenModules} data-testid="open-modules"
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">
        <SlidersHorizontal className="h-4 w-4" /> Abrir Ferramentas
      </button>
    )}
  </div>
);
