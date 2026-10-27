import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { canDisableModule, DisableCheck, isModuleEnabled, ModuleKey } from '../lib/modules';
import { tenantModuleRepository } from '../repositories/tenantModuleRepository';

export function useModules() {
  const { activeTenant, activeRole } = useAuth();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modules, setModules] = useState<ReadonlySet<ModuleKey> | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!activeTenant?.id) {
      setAvailable(false);
      setModules(null);
      return;
    }
    setAvailable(false);
    setModules(null);
    setLoading(true);
    try {
      const snapshot = await tenantModuleRepository.getForTenant(activeTenant.id);
      // Ignora resposta de uma loja anterior (troca de loja rápida) para não sobrescrever o estado atual.
      if (requestId !== requestRef.current) return;
      setAvailable(snapshot.available);
      setModules(snapshot.available ? new Set(snapshot.modules.filter(module => module.enabled).map(module => module.key)) : null);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeTenant?.id]);

  useEffect(() => {
    void refresh().catch(error => {
      console.error('[useModules] Falha ao carregar os módulos do estabelecimento:', error);
    });
  }, [refresh]);

  const enabled = useCallback((key: ModuleKey) => isModuleEnabled(modules, key), [modules]);
  const checkCanDisable = useCallback((key: ModuleKey, tenantId: string): Promise<DisableCheck> =>
    canDisableModule(key, tenantId), []);

  return {
    available,
    loading,
    modules,
    activeRole,
    isModuleEnabled: enabled,
    checkCanDisable,
    refresh,
  };
}
