import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bike, CalendarClock, Check, ChefHat, ConciergeBell, CreditCard, ExternalLink, FileText, Gauge, Gift, LayoutGrid, LoaderCircle,
  PlusCircle, Percent, Printer, QrCode, Repeat, Scale, ScanBarcode, Shirt, SlidersHorizontal, Smartphone, Store, UserPlus, Utensils, Wallet,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { BUSINESS_TYPES, BusinessType, MODULES, ModuleKey, presetModuleKeys, TOOL_CATEGORIES, toolPlanBadge, visibleToolShortcuts, type ToolCategory } from '../../lib/modules';
import { tenantModuleRepository } from '../../repositories/tenantModuleRepository';
import { useModules } from '../../hooks/useModules';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { WaiterAccessBlock } from '../../components/establishment/WaiterAccessBlock';
import { SalonSetupPanel } from '../../components/establishment/SalonSetupPanel';
import { salonPermissions } from '../../components/establishment/salonSetup';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Bike, CalendarClock, ChefHat, ConciergeBell, CreditCard, FileText, Gauge, Gift, LayoutGrid, PlusCircle, Percent, Printer, QrCode, Repeat, Scale,
  ScanBarcode, Shirt, Store, Utensils, Wallet,
};
const ToolIcon: React.FC<{ name?: string | null }> = ({ name }) => {
  const Icon = (name && ICONS[name]) || SlidersHorizontal;
  return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Icon className="h-5 w-5" /></span>;
};
/** Espaço reservado para o selo de plano. Nada é cobrado hoje: sem plano/preço o selo não aparece. */
const PlanBadge: React.FC<{ tool: Parameters<typeof toolPlanBadge>[0] }> = ({ tool }) => {
  const badge = toolPlanBadge(tool);
  return badge ? <span data-testid="tool-plan-badge" className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge === 'Adicional' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{badge}</span> : null;
};

export const ModulesPage: React.FC<{ onNavigate?: (tab: string) => void }> = ({ onNavigate }) => {
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
      showToast({ type: 'error', title: 'Falha ao carregar ferramentas', message: error.message || 'Tente novamente.' });
    });
    return () => { mounted = false; };
  }, [activeTenant?.id, available, showToast]);

  const enabled = useMemo(() => new Set(modules || []), [modules]);
  const shortcuts = useMemo(() => visibleToolShortcuts(modules, activeRole), [modules, activeRole]);
  const garcom = shortcuts.find(tool => tool.id === 'garcom');
  const openShortcut = (tool: (typeof shortcuts)[number]) => {
    if (tool.action.kind === 'path') window.location.assign(tool.action.path);
    else onNavigate?.(tool.action.tab);
  };
  const selectedPreset = presetModuleKeys(businessType);
  const hasPresetChanges = savedBusinessType !== businessType;

  const handleToggle = async (key: ModuleKey) => {
    if (!activeTenant || !canChange || savingKey) return;
    const currentlyEnabled = enabled.has(key);
    setSavingKey(key);
    try {
      if (currentlyEnabled) {
        const check = await checkCanDisable(key, activeTenant.id);
        if (!check.allowed) throw new Error(check.message || 'Feche os itens em aberto antes de desativar esta ferramenta.');
      }
      await tenantModuleRepository.setEnabled(activeTenant.id, key, !currentlyEnabled);
      await refresh();
      showToast({
        type: 'success',
        title: 'Ferramenta atualizada',
        message: `${MODULES.find(module => module.key === key)?.label || key} ${currentlyEnabled ? 'desativado' : 'ativado'}. Seus dados e histórico foram preservados.`,
      });
    } catch (error) {
      showToast({ type: 'error', title: 'Não foi possível alterar a ferramenta', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setSavingKey(null);
    }
  };

  const handleApplyPreset = async () => {
    if (!activeTenant || !canChange || !hasPresetChanges || savingPreset) return;
    const label = BUSINESS_TYPES.find(type => type.key === businessType)?.label || businessType;
    if (!window.confirm(`Aplicar a sugestão de ferramentas para ${label}? As ferramentas existentes não serão desativadas.`)) return;
    setSavingPreset(true);
    try {
      await tenantModuleRepository.applyPreset(activeTenant.id, businessType);
      setSavedBusinessType(businessType);
      await refresh();
      showToast({ type: 'success', title: 'Predefinição aplicada', message: 'As ferramentas sugeridas foram ligadas. Nenhuma ferramenta existente foi desativada.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Falha ao aplicar a predefinição', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setSavingPreset(false);
    }
  };

  if (!activeTenant || !available) return null;

  const cards = (category: ToolCategory) => ({
    shortcuts: shortcuts.filter(tool => tool.category === category),
    modules: MODULES.filter(module => (module.category || 'Operação') === category),
  });

  return (
    <div className="max-w-5xl space-y-6" data-testid="tools-page">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-black text-gray-900">
          <SlidersHorizontal className="h-5 w-5 text-emerald-700" /> Ferramentas
        </h1>
        <p className="mt-1 text-sm text-gray-500">Ligue e acesse tudo o que o seu negócio usa, em um só lugar.</p>
      </header>

      {!canChange && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Modo somente leitura. Apenas o proprietário pode ligar ou desligar as ferramentas.</span>
        </div>
      )}

      {garcom && (
        <section data-testid="waiter-app-card" className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-900 p-5 text-white shadow-lg sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20"><ConciergeBell className="h-6 w-6" /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black">Aplicativo do Garçom</h2><span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200">Novo</span><PlanBadge tool={garcom} /></div>
                <p className="mt-1 max-w-xl text-sm text-slate-300">O garçom entra com a conta da equipe, vê o mapa do salão, libera quem leu o QR com som e aviso, atende chamados, abre mesa e lança pedidos. Funciona no celular, como um aplicativo.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openShortcut(garcom)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950 shadow-sm transition hover:bg-emerald-400"><ExternalLink className="h-4 w-4" />Acessar Garçom</button>
            </div>
          </div>
          <ol className="mt-5 grid gap-3 text-sm sm:grid-cols-3" aria-label="Como adicionar garçons">
            <li className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10"><p className="flex items-center gap-2 font-bold"><span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400 text-xs font-black text-slate-950">1</span>Convide o garçom</p><p className="mt-1 text-xs text-slate-300">Em <b>Equipe & Permissões</b> → <b>Convidar Colaborador</b>, escolha o cargo <b>Garçom</b> e informe o e-mail dele.</p>{onNavigate && <button type="button" onClick={() => onNavigate('est-team')} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20"><UserPlus className="h-3.5 w-3.5" />Convidar garçom</button>}</li>
            <li className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10"><p className="flex items-center gap-2 font-bold"><span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400 text-xs font-black text-slate-950">2</span>Ele entra no celular</p><p className="mt-1 text-xs text-slate-300">O garçom lê o QR abaixo no celular e entra (ou cria a conta) com o e-mail do convite.</p></li>
            <li className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10"><p className="flex items-center gap-2 font-bold"><span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400 text-xs font-black text-slate-950">3</span>Instale como app</p><p className="mt-1 text-xs text-slate-300 flex items-start gap-1.5"><Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />Dentro do Garçom toque em <b>Instalar</b> (ou, no navegador, “Adicionar à tela inicial”). Fica com ícone próprio.</p></li>
          </ol>
          <div className="mt-4"><WaiterAccessBlock storeName={activeTenant?.name} /></div>
        </section>
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
          Mudar o tipo não desativa ferramentas; confirme para ligar as sugeridas.
        </p>
      </Card>

      {TOOL_CATEGORIES.map(category => {
        const group = cards(category);
        if (!group.shortcuts.length && !group.modules.length) return null;
        return (
          <section key={category} aria-labelledby={`tools-${category}`} data-testid={`tools-group-${category}`}>
            <h2 id={`tools-${category}`} className="mb-2 text-xs font-black uppercase tracking-wider text-gray-500">{category}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.shortcuts.map(tool => (
                <Card key={tool.id} className="flex flex-col justify-between gap-3 p-4 transition hover:shadow-md" data-testid={`tool-${tool.id}`}>
                  <div className="flex items-start gap-3">
                    <ToolIcon name={tool.icon} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold text-gray-900">{tool.label}</h3><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Disponível</span><PlanBadge tool={tool} /></div>
                      <p className="mt-1 text-xs text-gray-600">{tool.description}</p>
                    </div>
                  </div>
                  <div><button type="button" onClick={() => openShortcut(tool)} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">{tool.action.cta}</button></div>
                </Card>
              ))}
              {group.modules.map(module => {
                const isEnabled = enabled.has(module.key);
                const isSaving = savingKey === module.key;
                return (
                  <Card key={module.key} className="flex flex-col justify-between gap-3 p-4 transition hover:shadow-md" data-testid={`tool-module-${module.key}`}>
                    <div className="flex items-start gap-3">
                      <ToolIcon name={module.icon} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-gray-900">{module.label}</h3>
                          {!module.implemented && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Em breve</span>}
                          {isEnabled && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Ativo</span>}
                          <PlanBadge tool={module} />
                        </div>
                        <p className="mt-1 text-xs text-gray-600">{module.description}</p>
                        <p className="mt-1 text-xs text-gray-500"><strong>O que muda no seu painel:</strong> {module.changes}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>{module.key === 'dine_in' && isEnabled && salonAccess.canManageSalon && (
                        <Button type="button" variant="outline" size="sm" onClick={() => setShowSalonSetup(value => !value)}>
                          {showSalonSetup ? 'Fechar configuração' : 'Configurar'}
                        </Button>
                      )}</div>
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
          </section>
        );
      })}

      {showSalonSetup && activeTenant && (
        <SalonSetupPanel
          tenantId={activeTenant.id}
          tenantName={activeTenant.name}
          tenantSlug={activeTenant.slug}
          canManageTables={salonAccess.canManageSalon}
          canConfigure={salonAccess.canManageSalon}
          canManageServiceFeeModule={salonAccess.canManageServiceFeeModule}
          canRegenerateQr={salonAccess.canRegenerateQr}
          onConfigSaved={refresh}
        />
      )}

      <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        Desativar uma ferramenta não apaga dados: o recurso some dos menus e do catálogo público, mas o histórico continua nos relatórios. Ao reativar, os dados voltam a ficar disponíveis.
      </p>
    </div>
  );
};
