import type { HomeAction, StoreHomeDesign } from './storeHome.model';

export interface HomeVisibilityContext {
  /** Módulo salão / mesas ativo. */
  dineIn: boolean;
  delivery: boolean;
  pickup: boolean;
  /** Totem em tela cheia: esconde fluxo de app/delivery. */
  kiosk: boolean;
}

/**
 * Esconde ações que não se aplicam ao contexto (módulo desligado / totem).
 * MENU nunca some. Sessão/garçom afetam disponibilidade, não a lista do design.
 */
export function visibleHomeActions(
  design: StoreHomeDesign,
  ctx: HomeVisibilityContext,
): HomeAction[] {
  return design.actions.filter(action => {
    switch (action) {
      case 'MENU':
        return true;
      case 'TABLE':
      case 'WAITER':
      case 'BILL':
        return ctx.dineIn && !ctx.kiosk;
      case 'DELIVERY':
        return ctx.delivery && !ctx.kiosk;
      case 'PICKUP':
        return ctx.pickup && !ctx.kiosk;
      case 'ACCOUNT':
        return !ctx.kiosk;
      default:
        return false;
    }
  });
}

export interface HomeAvailabilityContext {
  hasSession: boolean;
  waiterEnabled: boolean;
  billEnabled: boolean;
}

/** Disponibilidade (disabled) sem remover o tile do grid. */
export function homeActionAvailability(
  actions: HomeAction[],
  ctx: HomeAvailabilityContext,
): Partial<Record<HomeAction, boolean>> {
  const out: Partial<Record<HomeAction, boolean>> = {};
  for (const action of actions) {
    switch (action) {
      case 'MENU':
      case 'TABLE':
      case 'PICKUP':
      case 'DELIVERY':
        out[action] = true;
        break;
      case 'ACCOUNT':
        out[action] = ctx.hasSession;
        break;
      case 'WAITER':
        out[action] = ctx.hasSession && ctx.waiterEnabled;
        break;
      case 'BILL':
        out[action] = ctx.hasSession && ctx.billEnabled;
        break;
      default:
        break;
    }
  }
  return out;
}
