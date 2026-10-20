import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, LoaderCircle, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { BUSINESS_TYPES, BusinessType, MODULES, ModuleKey, presetModuleKeys } from '../../lib/modules';
import { tenantModuleRepository } from '../../repositories/tenantModuleRepository';
import { useModules } from '../../hooks/useModules';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SalonSetupPanel } from '../../components/establishment/SalonSetupPanel';
import { salonPermissions } from '../../components/establishment/salonSetup';

export const ModulesPage: React.FC = () => {
  const { activeTenant, activeRole } = useAuth();
  const { showToast } = useToast();
  const { available, loading, modules, refresh, checkCanDisable } = useModules();
  const [businessType, setBusinessType] = useState<BusinessType>('OUTRO');
  const [savedBusinessType, setSavedBusinessType] = useState<BusinessType | null>(null);
  const [savingKey, setSavingKey] = useState<ModuleKey | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [showSalonSetup, setShowSalonSetup] = useState(false);
  const canChange = activeRole === 'OWNER';
  const salonAccess = salonPermissions(activeRole);

  useEffect(() => {
    let mounted = true;
    if (!activeTenant?.id || !available) return;
    tenantModuleRepository.getForTenant(activeTenant.id).then(snapshot => {
      if (!mounted) return;
      setSavedBusinessType(snapshot.businessType);
      setBusinessType(snapshot.businessType || 'OUTRO');
    }).catch(error => {
      showToast({ type: 'error', title: 'Falha ao carregar módulos', message: error.message || 'Tente novamente.' });
    });
    return () => { mounted = false; };
  }, [activeTenant?.id, available, showToast]);

  const enabled = useMemo(() => new Set(modules || []), [modules]);
  const selectedPreset = presetModuleKeys(businessType);
  const hasPresetChanges = savedBusinessType !== businessType;

  const handleToggle = async (key: ModuleKey) => {
    if (!activeTenant || !canChange || savingKey) return;
    const currentlyEnabled = enabled.has(key);
    setSavingKey(key);
    try {
      if (currentlyEnabled) {
        const check = await checkCanDisable(key, activeTenant.id);
        if (!check.allowed) throw new Error(check.message || 'Feche os itens em aberto antes de desativar este módulo.');
      }
      await tenantModuleRepository.setEnabled(activeTenant.id, key, !currentlyEnabled);
      await refresh();
      showToast({
        type: 'success',
        title: 'Módulo atualizado',
        message: `${MODULES.find(module => module.key === key)?.label || key} ${currentlyEnabled ? 'desativado' : 'ativado'}. Seus dados e histórico foram preservados.`,
      });
    } catch (error) {
      showToast({ type: 'error', title: 'Não foi possível alterar o módulo', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setSavingKey(null);
    }
  };

  const handleApplyPreset = async () => {
    if (!activeTenant || !canChange || !hasPresetChanges || savingPreset) return;
    const label = BUSINESS_TYPES.find(type => type.key === businessType)?.label || businessType;
    if (!window.confirm(`Aplicar a sugestão de módulos para ${label}? Os módulos existentes não serão desativados.`)) return;
    setSavingPreset(true);
    try {
      await tenantModuleRepository.applyPreset(activeTenant.id, businessType);
      setSavedBusinessType(businessType);
      await refresh();
      showToast({ type: 'success', title: 'Predefinição aplicada', message: 'Os módulos sugeridos foram ligados. Nenhum módulo existente foi desativado.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Falha ao aplicar a predefinição', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setSavingPreset(false);
    }
  };

  if (!activeTenant || !available) return null;

  return (
    <div className="max-w-4xl space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <SlidersHorizontal className="h-5 w-5 text-emerald-700" /> Módulos
        </h1>
        <p className="mt-1 text-sm text-gray-500">Escolha os recursos que fazem sentido para o seu negócio.</p>
      </header>

      {!canChange && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Modo somente leitura. Apenas o proprietário pode alterar os módulos.</span>
        </div>
      )}

      <Card className="space-y-3 p-4">
        <label htmlFor="modules-business-type" className="block text-sm font-semibold text-gray-900">Tipo de negócio</label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            id="modules-business-type"
            value={businessType}
            disabled={!canChange || savingPreset}
            onChange={event => setBusinessType(event.target.value as BusinessType)}
            className="min-h-10 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm disabled:bg-gray-100"
          >
            {BUSINESS_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
          </select>
          {canChange && (
            <Button type="button" variant="primary" size="sm" disabled={!hasPresetChanges || savingPreset} isLoading={savingPreset} onClick={handleApplyPreset}>
              Confirmar sugestão
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          Sugestão: {selectedPreset.map(key => MODULES.find(module => module.key === key)?.label).join(', ')}.
          Mudar o tipo não desativa módulos; confirme para ligar os sugeridos.
        </p>
      </Card>

      <div className="space-y-3">
        {MODULES.map(module => {
          const isEnabled = enabled.has(module.key);
          const isSaving = savingKey === module.key;
          return (
            <Card key={module.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-gray-900">{module.label}</h2>
                  {!module.implemented && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Em breve</span>}
                  {isEnabled && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Ativo</span>}
                </div>
                <p className="mt-1 text-xs text-gray-600">{module.description}</p>
                <p className="mt-1 text-xs text-gray-500"><strong>O que muda no seu painel:</strong> {module.changes}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
              {module.key === 'dine_in' && isEnabled && salonAccess.canManageSalon && (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSalonSetup(value => !value)}>
                  {showSalonSetup ? 'Fechar configuração' : 'Configurar'}
                </Button>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={isEnabled}
                aria-label={`${isEnabled ? 'Desativar' : 'Ativar'} ${module.label}`}
                disabled={!canChange || !module.implemented || loading || Boolean(savingKey) || isSaving}
                onClick={() => void handleToggle(module.key)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isEnabled ? 'bg-emerald-600' : 'bg-gray-300'
                }`}
              >
                {isSaving
                  ? <LoaderCircle className="absolute left-1/2 h-4 w-4 -translate-x-1/2 animate-spin text-white" />
                  : <span className={`inline-flex h-4 w-4 transform items-center justify-center rounded-full bg-white transition-transform ${isEnabled ? 'translate-x-6' : 'translate-x-1'}`}>
                      {isEnabled && <Check className="h-3 w-3 text-emerald-700" />}
                    </span>}
              </button>
              </div>
            </Card>
          );
        })}
      </div>

      {showSalonSetup && activeTenant && (
        <SalonSetupPanel
          tenantId={activeTenant.id}
          tenantName={activeTenant.name}
          canManageTables={salonAccess.canManageSalon}
          canConfigure={salonAccess.canManageSalon}
          canManageServiceFeeModule={salonAccess.canManageServiceFeeModule}
          canRegenerateQr={salonAccess.canRegenerateQr}
          onConfigSaved={refresh}
        />
      )}

      <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        Desativar um módulo não apaga dados: o recurso some dos menus e do catálogo público, mas o histórico continua nos relatórios. Ao reativar, os dados voltam a ficar disponíveis.
      </p>
    </div>
  );
};
