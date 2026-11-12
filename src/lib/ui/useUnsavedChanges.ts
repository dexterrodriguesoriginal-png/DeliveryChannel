import { useEffect, useRef } from 'react';
const pending = new Set<symbol>();
export function confirmPendingDesignNavigation(): boolean {
  return pending.size === 0 || window.confirm('Há alterações de design não salvas. Sair e descartar essas alterações?');
}
/** Each independently saved panel owns its registration, including hidden design tabs. */
export function useUnsavedChanges(dirty: boolean) {
  const key = useRef(Symbol('design-draft'));
  useEffect(() => {
    const id = key.current;
    if (dirty) pending.add(id); else pending.delete(id);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { pending.delete(id); window.removeEventListener('beforeunload', warn); };
  }, [dirty]);
}
