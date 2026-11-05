import { useEffect, useSyncExternalStore } from 'react';

/** Entrega 1.5: o Dashboard já mostra "Alertas de pedidos"; com ele aberto, não duplicamos o popup verde de pedido novo. */
let mounted = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function useMarkDashboardOpen(): void {
  useEffect(() => { mounted += 1; emit(); return () => { mounted -= 1; emit(); }; }, []);
}

export function useIsDashboardOpen(): boolean {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => mounted > 0, () => false);
}

