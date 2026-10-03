import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { tenantRepository } from '../../repositories/tenantRepository';
import { dataStore } from '../../services/dataStore';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { TenantSettings } from '../../types';
import { Settings, Save, Check, Clock, AlertCircle, ShieldAlert } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

const PREP_TIME_PRESETS = [15, 20, 25, 30, 40, 50, 60];

export const SettingsPage: React.FC = () => {
  const { activeTenant, securityContext, setActiveTenant, activeRole } = useAuth();
  const { showToast } = useToast();

  if (!activeTenant) return null;

  // RBAC: Somente OWNER, MANAGER ou administradores executivos podem editar configurações
  const canEdit = activeRole === 'OWNER' || activeRole === 'MANAGER' || activeRole === 'CEO' || activeRole === 'SUPER_ADMIN';

  const [form, setForm] = useState<TenantSettings>({
    ...activeTenant.settings,
    defaultPrepTimeMinutes: activeTenant.settings?.defaultPrepTimeMinutes ?? 30,
  });

  const [prepTimeInput, setPrepTimeInput] = useState<string>(
    String(activeTenant.settings?.defaultPrepTimeMinutes ?? 30)
  );
  const [prepTimeError, setPrepTimeError] = useState<string | null>(null);
  const [savingPrep, setSavingPrep] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [prepSuccessMessage, setPrepSuccessMessage] = useState<string | null>(null);

  // Sincroniza estado e busca fonte oficial diretamente no Supabase ao montar/recarregar
  useEffect(() => {
    let isSubscribed = true;
    if (activeTenant?.id) {
      // 1. Inicializa imediatamente com os dados locais
      const minutes = activeTenant.settings?.defaultPrepTimeMinutes ?? 30;
      setForm({
        ...activeTenant.settings,
        defaultPrepTimeMinutes: minutes,
      });
      setPrepTimeInput(String(minutes));
      setPrepTimeError(null);

      // 2. Consulta direta à fonte da verdade no Supabase (garantia de reload e dados frescos)
      tenantRepository.getSettings(securityContext, activeTenant.id).then(freshSettings => {
        if (isSubscribed && freshSettings) {
          const freshMinutes = freshSettings.defaultPrepTimeMinutes ?? 30;
          setForm(freshSettings);
          setPrepTimeInput(String(freshMinutes));
          if (setActiveTenant) {
            setActiveTenant({
              ...activeTenant,
              settings: freshSettings,
            });
          }
        }
      }).catch(err => {
        console.warn('[SettingsPage] Aviso ao recarregar configurações do Supabase:', err);
      });
    }
    return () => {
      isSubscribed = false;
    };
  }, [activeTenant?.id]);

  // Validação estrita: somente número inteiro entre 1 e 240 minutos
  const validatePrepMinutes = (valueStr: string): { valid: boolean; value?: number; error?: string } => {
    const trimmed = valueStr.trim();
    if (!trimmed) {
      return { valid: false, error: 'O tempo de preparo é obrigatório.' };
    }
    // Rejeita decimais, letras, sinais negativos ou formatações inválidas
    if (!/^\d+$/.test(trimmed)) {
      return { valid: false, error: 'Informe apenas números inteiros (sem letras, sinais ou decimais).' };
    }
    const intVal = parseInt(trimmed, 10);
    if (intVal < 1) {
      return { valid: false, error: 'O tempo de preparo mínimo é de 1 minuto.' };
    }
    if (intVal > 240) {
      return { valid: false, error: 'O tempo de preparo máximo permitido é de 240 minutos (4 horas).' };
    }
    return { valid: true, value: intVal };
  };

  // Salvar apenas a seção de Tempo de Preparo
  const handleSavePrepTime = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canEdit) {
      showToast({
        type: 'error',
        title: 'Permissão Negada',
        message: 'Apenas proprietários e gerentes podem alterar configurações da loja.',
      });
      return;
    }

    const validation = validatePrepMinutes(prepTimeInput);
    if (!validation.valid || validation.value === undefined) {
      setPrepTimeError(validation.error || 'Valor inválido.');
      return;
    }

    setPrepTimeError(null);
    setSavingPrep(true);
    setPrepSuccessMessage(null);

    const newPrepMinutes = validation.value;

    try {
      const updatedSettings: Partial<TenantSettings> = {
        defaultPrepTimeMinutes: newPrepMinutes,
      };

      await tenantRepository.updateSettings(securityContext, activeTenant.id, updatedSettings);
      dataStore.updateTenantSettings(securityContext, activeTenant.id, updatedSettings);

      const newFullSettings: TenantSettings = {
        ...form,
        defaultPrepTimeMinutes: newPrepMinutes,
      };
      setForm(newFullSettings);

      if (setActiveTenant) {
        setActiveTenant({
          ...activeTenant,
          settings: newFullSettings,
        });
      }

      setPrepSuccessMessage(`✅ Tempo de preparo atualizado para ${newPrepMinutes} minutos.`);
      showToast({
        type: 'success',
        title: 'Tempo de Preparo Salvo',
        message: `✅ Tempo de preparo atualizado para ${newPrepMinutes} minutos.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Salvar',
        message: err.message || 'Falha ao salvar tempo de preparo no servidor.',
      });
    } finally {
      setSavingPrep(false);
    }
  };

  // Salvar todas as configurações
  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      showToast({
        type: 'error',
        title: 'Permissão Negada',
        message: 'Apenas proprietários e gerentes podem alterar configurações da loja.',
      });
      return;
    }

    const validation = validatePrepMinutes(prepTimeInput);
    if (!validation.valid || validation.value === undefined) {
      setPrepTimeError(validation.error || 'Valor de tempo de preparo inválido.');
      return;
    }
    setPrepTimeError(null);

    setSavingGlobal(true);
    const newPrepMinutes = validation.value;
    const finalForm: TenantSettings = {
      ...form,
      defaultPrepTimeMinutes: newPrepMinutes,
    };

    try {
      await tenantRepository.updateSettings(securityContext, activeTenant.id, finalForm);
      dataStore.updateTenantSettings(securityContext, activeTenant.id, finalForm);
      if (setActiveTenant) {
        setActiveTenant({
          ...activeTenant,
          settings: finalForm,
        });
      }
      setPrepSuccessMessage(`✅ Tempo de preparo atualizado para ${newPrepMinutes} minutos.`);
      showToast({
        type: 'success',
        title: 'Configurações Atualizadas',
        message: 'Configurações e tempo de preparo salvos no banco de dados.',
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Salvar',
        message: err.message || 'Falha ao salvar configurações.',
      });
    } finally {
      setSavingGlobal(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Configurações Operacionais da Loja</h2>
        <p className="text-xs text-gray-500">
          Ajuste tempo de preparo, regras de frete, pedido mínimo, endereço e chave Pix para recebimento
        </p>
      </div>

      {!canEdit && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2.5 text-xs text-amber-800">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Modo somente leitura. Apenas Proprietários (Owner) e Gerentes (Manager) possuem permissão para salvar alterações.</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SEÇÃO PRINCIPAL: TEMPO DE PREPARO E ENTREGA                               */}
      {/* ========================================================================= */}
      <Card className="p-5 space-y-4 border-2 border-emerald-100 bg-white shadow-xs">
        <div className="pb-2 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-700" />
            TEMPO DE PREPARO E ENTREGA
          </h3>
          <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            {activeTenant.name}
          </span>
        </div>

        <div>
          <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wide">Tempo de preparo padrão</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Defina quanto tempo seu estabelecimento normalmente precisa para preparar um pedido.
          </p>
        </div>

        {/* Atalhos de Minutos Rápidos */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-gray-600">Opções rápidas:</label>
          <div className="flex flex-wrap gap-2">
            {PREP_TIME_PRESETS.map((preset) => {
              const isSelected = prepTimeInput === String(preset);
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => {
                    setPrepTimeInput(String(preset));
                    setPrepTimeError(null);
                    setPrepSuccessMessage(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-700 text-white shadow-xs ring-2 ring-emerald-600/30'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
                  } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {preset} min
                </button>
              );
            })}
          </div>
        </div>

        {/* Campo numérico de entrada com validação */}
        <div className="max-w-xs space-y-1.5">
          <label className="text-xs font-bold text-gray-700 flex items-center gap-1">
            <span>Tempo de preparo (minutos)</span>
            <span className="text-emerald-700">*</span>
          </label>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                min={1}
                max={240}
                step={1}
                disabled={!canEdit}
                value={prepTimeInput}
                onChange={(e) => {
                  setPrepTimeInput(e.target.value);
                  setPrepTimeError(null);
                  setPrepSuccessMessage(null);
                }}
                className={`w-full px-3 py-2 text-sm font-semibold rounded-lg border focus:outline-none focus:ring-2 transition-all ${
                  prepTimeError
                    ? 'border-rose-400 focus:ring-rose-200 text-rose-900 bg-rose-50/30'
                    : 'border-gray-300 focus:ring-emerald-200 focus:border-emerald-600 text-gray-900 bg-white'
                } ${!canEdit ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                placeholder="30"
              />
            </div>
            <span className="text-xs font-bold text-gray-500 shrink-0">minutos</span>
          </div>

          {prepTimeError && (
            <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1 pt-0.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{prepTimeError}</span>
            </p>
          )}

          <p className="text-[11px] text-gray-400">
            Valores aceitos: número inteiro entre 1 e 240 minutos.
          </p>
        </div>

        {/* Feedback visual de sucesso */}
        {prepSuccessMessage && (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs font-bold text-emerald-800">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{prepSuccessMessage}</span>
          </div>
        )}

        <div className="pt-2 flex items-center justify-between border-t border-gray-100">
          <span className="text-[11px] text-gray-500">
            Valor atual salvo: <strong className="text-gray-800">{form.defaultPrepTimeMinutes ?? 30} min</strong>
          </span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canEdit}
            isLoading={savingPrep}
            onClick={() => handleSavePrepTime()}
            leftIcon={<Save className="w-3.5 h-3.5" />}
          >
            Salvar alterações
          </Button>
        </div>
      </Card>

      {/* Formulário complementar de regras operacionais */}
      <form onSubmit={handleSaveAll} className="space-y-5">
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-900 pb-2 border-b border-gray-100 flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-700" />
            Regras de Delivery & Pedidos
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Pedido Mínimo (R$)"
              type="number"
              step="0.01"
              disabled={!canEdit}
              value={form.minOrderValue}
              onChange={(e) => setForm({ ...form, minOrderValue: parseFloat(e.target.value) || 0 })}
            />
            <Input
              label="Taxa de Entrega Padrão (R$)"
              type="number"
              step="0.01"
              disabled={!canEdit}
              value={form.deliveryFee}
              onChange={(e) => setForm({ ...form, deliveryFee: parseFloat(e.target.value) || 0 })}
            />
            <Input
              label="Frete Grátis Acima de (R$)"
              type="number"
              step="0.01"
              disabled={!canEdit}
              value={form.freeDeliveryThreshold || ''}
              onChange={(e) => setForm({ ...form, freeDeliveryThreshold: parseFloat(e.target.value) || undefined })}
              helperText="Deixe em branco se não oferecer frete grátis"
            />
            <Input
              label="Estimativa Textual de Entrega"
              disabled={!canEdit}
              value={form.estimatedDeliveryTime}
              onChange={(e) => setForm({ ...form, estimatedDeliveryTime: e.target.value })}
              placeholder="Ex: 30-45 min"
            />
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-900 pb-2 border-b border-gray-100">
            Endereço & Contato
          </h3>

          <div className="space-y-4">
            <Input
              label="Endereço Físico do Estabelecimento"
              disabled={!canEdit}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="WhatsApp para Notificações"
                disabled={!canEdit}
                value={form.phoneWhatsApp}
                onChange={(e) => setForm({ ...form, phoneWhatsApp: e.target.value })}
              />
              <Input
                label="Chave PIX da Empresa"
                disabled={!canEdit}
                value={form.pixKey || ''}
                onChange={(e) => setForm({ ...form, pixKey: e.target.value })}
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            disabled={!canEdit}
            isLoading={savingGlobal}
            leftIcon={<Save className="w-4 h-4" />}
          >
            Salvar Todas as Configurações
          </Button>
        </div>
      </form>
    </div>
  );
};
