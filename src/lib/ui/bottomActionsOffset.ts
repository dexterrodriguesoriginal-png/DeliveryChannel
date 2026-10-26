import { useEffect, RefObject } from 'react';

/** Variável CSS global com a altura da barra de ações fixa no rodapé (ex.: Salvar do Design do App). */
export const BOTTOM_ACTIONS_VAR = '--dc-bottom-actions-offset';

export function setBottomActionsOffset(root: HTMLElement, px: number) {
  if (px > 0) root.style.setProperty(BOTTOM_ACTIONS_VAR, `${Math.ceil(px)}px`);
  else root.style.removeProperty(BOTTOM_ACTIONS_VAR);
}

/** Publica a altura da barra enquanto ela estiver montada; elementos flutuantes sobem acima dela. */
export function useBottomActionsOffset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    const update = () => setBottomActionsOffset(root, el.getBoundingClientRect().height);
    update();
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); setBottomActionsOffset(root, 0); };
  }, [ref]);
}

/** Posição do botão flutuante de notificações: 12px acima da barra de ações (ou da borda). */
export const floatingAboveActionsStyle = { bottom: `calc(var(${BOTTOM_ACTIONS_VAR}, 0px) + 12px)` } as const;
