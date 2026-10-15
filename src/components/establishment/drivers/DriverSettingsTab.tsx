import React, { useState } from 'react';
import { 
  Settings, 
  Bike, 
  DollarSign, 
  ShieldCheck, 
  Bell, 
  Check, 
  Save 
} from 'lucide-react';
import { Tenant } from '../../../types';
import { useToast } from '../../../context/ToastContext';

interface DriverSettingsTabProps {
  tenant: Tenant;
}

export const DriverSettingsTab: React.FC<DriverSettingsTabProps> = ({ tenant }) => {
  const { showToast } = useToast();
  const [fee, setFee] = useState(tenant.settings?.deliveryFee || 6.5);
  const [driverPayout, setDriverPayout] = useState(5.0);
  const [maxRadiusKm, setMaxRadiusKm] = useState(7);
  const [autoAssign, setAutoAssign] = useState(false);
  const [whatsappNotify, setWhatsappNotify] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      showToast({
        type: 'success',
        title: 'Configurações Salvas',
        message: 'Regras da frota de entregadores atualizadas com sucesso.',
      });
    }, 400);
  };

  return (
    <form onSubmit={handleSave} className="max-w-3xl space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-5 space-y-4">
        <div>
          <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            Taxas e Repasses de Entrega
          </h4>
          <p className="text-xs text-gray-500">Defina os valores cobrados do cliente e repassados aos entregadores</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="font-semibold text-gray-700 block mb-1">Taxa de Entrega Padrão (R$)</label>
            <input
              type="number"
              step="0.5"
              value={fee}
              onChange={(e) => setFee(parseFloat(e.target.value) || 0)}
              className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs text-gray-900 focus:outline-none focus:border-emerald-600"
            />
            <p className="text-[10px] text-gray-400 mt-1">Valor cobrado do cliente no checkout.</p>
          </div>

          <div>
            <label className="font-semibold text-gray-700 block mb-1">Repasse ao Entregador (R$)</label>
            <input
              type="number"
              step="0.5"
              value={driverPayout}
              onChange={(e) => setDriverPayout(parseFloat(e.target.value) || 0)}
              className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs text-gray-900 focus:outline-none focus:border-emerald-600"
            />
            <p className="text-[10px] text-gray-400 mt-1">Valor fixo pago por entrega concluída.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs p-5 space-y-4">
        <div>
          <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
            <Bike className="w-4 h-4 text-emerald-600" />
            Regras de Despacho & Raio
          </h4>
          <p className="text-xs text-gray-500">Parâmetros operacionais para a equipe de entrega</p>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-gray-700 block mb-1">Raio Máximo de Atendimento (km)</label>
            <input
              type="number"
              value={maxRadiusKm}
              onChange={(e) => setMaxRadiusKm(parseInt(e.target.value) || 1)}
              className="w-full max-w-xs bg-white border border-gray-200 rounded-xl p-2.5 text-xs text-gray-900 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
            <div>
              <span className="font-semibold text-gray-800 block">Notificar Entregador via WhatsApp</span>
              <span className="text-[11px] text-gray-500">
                Gera link de envio rápido com os dados da ordem para o motoboy.
              </span>
            </div>
            <input
              type="checkbox"
              checked={whatsappNotify}
              onChange={(e) => setWhatsappNotify(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded cursor-pointer"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSaving}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </div>
    </form>
  );
};
