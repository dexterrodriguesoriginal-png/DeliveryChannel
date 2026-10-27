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

/**
 * Lado do botão flutuante de notificações. Por padrão fica à direita; telas com uma coluna fixa à direita
 * (ex.: celular de prévia do Design do App) publicam o X (px) onde o botão deve ficar, à esquerda da área de conteúdo.
 */
export const FLOAT_LEFT_VAR = '--dc-float-left';
export const FLOAT_RIGHT_VAR = '--dc-float-right';
export const FLOAT_ALIGN_VAR = '--dc-float-align';

export function setFloatingLeft(root: HTMLElement, px: number | null) {
  if (px == null) {
    root.style.removeProperty(FLOAT_LEFT_VAR);
    root.style.removeProperty(FLOAT_RIGHT_VAR);
    root.style.removeProperty(FLOAT_ALIGN_VAR);
  } else {
    root.style.setProperty(FLOAT_LEFT_VAR, `${Math.max(0, Math.round(px))}px`);
    root.style.setProperty(FLOAT_RIGHT_VAR, 'auto');
    root.style.setProperty(FLOAT_ALIGN_VAR, 'flex-start');
  }
}

/** Enquanto montado, move as notificações para o canto inferior ESQUERDO da área de conteúdo `ref`. */
export function useFloatingLeftOf(ref: RefObject<HTMLElement | null>, gap = 12) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;
    const update = () => setFloatingLeft(root, el.getBoundingClientRect().left + gap);
    update();
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); setFloatingLeft(root, null); };
  }, [ref, gap]);
}

/** Posição horizontal do botão: à esquerda quando `--dc-float-left` existe, senão 12px da borda direita. */
export const floatingSideStyle = {
  left: `var(${FLOAT_LEFT_VAR}, auto)`,
  right: `var(${FLOAT_RIGHT_VAR}, 12px)`,
} as const;

/** Alinhamento do botão dentro da coluna flutuante (direita por padrão, esquerda quando movido). */
export const floatingButtonAlignStyle = { alignSelf: `var(${FLOAT_ALIGN_VAR}, flex-end)` } as const;
