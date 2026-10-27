import React, { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { WaiterAccessBlock } from './WaiterAccessBlock';
import { waiterEntryUrl } from '../../lib/waiter/waiterAccess';

export { waiterEntryUrl };

export const WaiterPhonePairingCard: React.FC = () => {
  const [expanded, setExpanded] = useState(true);
  const { activeTenant } = useAuth();
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="waiter-phone-pairing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-gray-900"><Smartphone className="h-4 w-4" />Acesso do garçom pelo celular</h3>
          <p className="mt-1 text-xs text-gray-600">Leia o QR no celular do colaborador. Depois de entrar com a conta convidada como Garçom, abre o Aplicativo do Garçom: mapa do salão, liberações, chamados e pedidos.</p>
        </div>
        <button type="button" onClick={() => setExpanded(value => !value)} className="rounded-xl border px-3 py-2 text-sm font-bold">
          {expanded ? 'Ocultar QR' : 'Conectar celular'}
        </button>
      </div>
      {expanded && <div className="mt-4"><WaiterAccessBlock storeName={activeTenant?.name} /></div>}
    </section>
  );
};
