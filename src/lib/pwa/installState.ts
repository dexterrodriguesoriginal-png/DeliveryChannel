/** Estado de instalação do PWA por loja (localStorage) + detecção de plataforma. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;
const safe = <T,>(fn: () => T, fb: T): T => { try { return fn(); } catch { return fb; } };

export const installKeys = (tenantId: string) => ({
  modalSeen: `deliverychannel_pwa_modal_seen_${tenantId}`,
  installed: `deliverychannel_pwa_installed_${tenantId}`,
});

export function hasSeenInstallModal(s: KV, tenantId: string) { return safe(() => s.getItem(installKeys(tenantId).modalSeen) === '1', false); }
/** Fechar/recusar só marca o modal como visto — NUNCA como instalado. */
export function markInstallModalSeen(s: KV, tenantId: string) { safe(() => s.setItem(installKeys(tenantId).modalSeen, '1'), undefined); }
export function isMarkedInstalled(s: KV, tenantId: string) { return safe(() => s.getItem(installKeys(tenantId).installed) === '1', false); }
/** Chamar somente após appinstalled ou userChoice 'accepted' ou execução em modo standalone. */
export function markInstalled(s: KV, tenantId: string) { safe(() => s.setItem(installKeys(tenantId).installed, '1'), undefined); }

export type Platform = 'android-chrome' | 'android-other' | 'ios-safari' | 'ios-other' | 'desktop';
export function detectPlatform(ua: string): Platform {
  const ios = /iphone|ipad|ipod/i.test(ua);
  if (ios) return /crios|fxios|edgios|opios|gsa\//i.test(ua) || !/safari/i.test(ua) ? 'ios-other' : 'ios-safari';
  if (/android/i.test(ua)) return /chrome\//i.test(ua) && !/samsungbrowser|opr\/|firefox|edga?\//i.test(ua) ? 'android-chrome' : 'android-other';
  return 'desktop';
}

export function isStandalone(w: { matchMedia?: (q: string) => { matches: boolean }; navigator?: unknown }): boolean {
  const mm = (q: string) => safe(() => !!w.matchMedia?.(q).matches, false);
  return mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || mm('(display-mode: minimal-ui)')
    || (w.navigator as { standalone?: boolean } | undefined)?.standalone === true;
}

export type PromoVisibility = 'none' | 'modal' | 'banner';
export function promoVisibility(o: { installed: boolean; standalone: boolean; modalSeen: boolean; checkoutOpen: boolean }): PromoVisibility {
  if (o.installed || o.standalone || o.checkoutOpen) return 'none';
  return o.modalSeen ? 'banner' : 'modal';
}

// --- Captura precoce do beforeinstallprompt (registrada em main.tsx) ---
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let installedFlag = false;
export function getDeferredPrompt() { return deferred; }
export function wasAppInstalledEvent() { return installedFlag; }
export function clearDeferredPrompt() { deferred = null; listeners.forEach(l => l()); }
export function subscribeInstall(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function captureInstallEvents(w: Window) {
  w.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; listeners.forEach(l => l()); });
  w.addEventListener('appinstalled', () => { installedFlag = true; deferred = null; listeners.forEach(l => l()); });
}

// --- Convite inteligente e persistente (por loja e por dispositivo; nunca no cadastro do dono) ---
export type InviteTrigger = 'visit' | 'active' | 'product' | 'cart' | 'order';
export type InviteKind = 'modal' | 'sheet';
export const INVITE_MIN_GAP_MS = 2 * 60 * 1000;
export const INVITE_ACTIVE_MS = 3 * 60 * 1000;

const inviteKey = (tenantId: string) => `deliverychannel_pwa_invite_${tenantId}`;
export interface InviteRecord { lastInviteAt: number; count: number; acceptedAt?: number; }

export function readInvite(s: KV, tenantId: string): InviteRecord {
  return safe(() => {
    const r = JSON.parse(s.getItem(inviteKey(tenantId)) || 'null');
    if (r && typeof r.lastInviteAt === 'number') return r as InviteRecord;
    // migração: quem já viu o modal antigo conta como 1 convite antigo (permite convidar já no próximo momento-chave)
    return { lastInviteAt: hasSeenInstallModal(s, tenantId) ? 1 : 0, count: hasSeenInstallModal(s, tenantId) ? 1 : 0 };
  }, { lastInviteAt: 0, count: 0 });
}
export function recordInvite(s: KV, tenantId: string, now: number): InviteRecord {
  const r = { ...readInvite(s, tenantId), lastInviteAt: now };
  r.count += 1;
  safe(() => s.setItem(inviteKey(tenantId), JSON.stringify(r)), undefined);
  markInstallModalSeen(s, tenantId);
  return r;
}
/** userChoice 'accepted' NÃO é instalação confirmada: só registra pendência (confirmação via appinstalled/standalone). */
export function recordAccepted(s: KV, tenantId: string, now: number) {
  const r = { ...readInvite(s, tenantId), acceptedAt: now };
  safe(() => s.setItem(inviteKey(tenantId), JSON.stringify(r)), undefined);
}

export interface InviteContext {
  now: number; trigger: InviteTrigger; record: InviteRecord;
  installed: boolean; standalone: boolean;
  /** checkout, pagamento, checkout promocional ou campo de formulário em foco */
  busy: boolean;
}
/** Decide se e como convidar. Persiste até instalar; nunca durante checkout/formulário; respeita intervalo mínimo. */
export function decideInvite(c: InviteContext): InviteKind | null {
  if (c.installed || c.standalone || c.busy) return null;
  const first = c.record.count === 0;
  if (first) return c.trigger === 'cart' || c.trigger === 'order' ? 'sheet' : 'modal';
  if (c.trigger === 'visit') return null; // visitas futuras: convida no primeiro momento-chave
  if (acceptedRecently(c)) return null;
  if (c.now - c.record.lastInviteAt < INVITE_MIN_GAP_MS) return null;
  return c.trigger === 'active' ? 'modal' : 'sheet';
}
/** Após aceitar a confirmação nativa, aguarda 10 min o appinstalled antes de voltar a convidar. */
export const acceptedRecently = (c: InviteContext) => typeof c.record.acceptedAt === 'number' && c.now - c.record.acceptedAt < 10 * 60 * 1000;

export function isEditableFocused(d: Document): boolean {
  const el = d.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

// Gatilhos disparados pela vitrine (produto aberto, item na sacola, pedido concluído).
const triggerListeners = new Set<(t: InviteTrigger) => void>();
export function emitInviteTrigger(t: InviteTrigger) { triggerListeners.forEach(l => l(t)); }
export function onInviteTrigger(l: (t: InviteTrigger) => void) { triggerListeners.add(l); return () => { triggerListeners.delete(l); }; }

/** Tempo ativo acumulado na sessão (aba visível + interação recente), por loja. */
export const activeKey = (tenantId: string) => `deliverychannel_pwa_active_ms_${tenantId}`;
