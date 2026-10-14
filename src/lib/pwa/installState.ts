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
/** Validade da marca "instalado" vista do navegador comum; cada abertura pelo ícone renova. */
export const INSTALLED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Marca persistida com data. O valor legado '1' (sem data) não é mais confiável: não há como saber se o app
 * ainda existe no aparelho, e sem beforeinstallprompt o convite ficava oculto para sempre.
 */
export function isMarkedInstalled(s: KV, tenantId: string, now = Date.now()) {
  return safe(() => {
    const ts = Number(s.getItem(installKeys(tenantId).installed));
    return ts > 1 && now - ts < INSTALLED_TTL_MS;
  }, false);
}
/** Chamar somente após appinstalled ou execução em modo standalone. */
export function markInstalled(s: KV, tenantId: string, now = Date.now()) { safe(() => s.setItem(installKeys(tenantId).installed, String(now)), undefined); }

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
/**
 * 1ª ocorrência por sessão/página da loja: NÃO chama preventDefault, para que o Chrome possa mostrar o
 * card nativo (mini-infobar). Ocorrências seguintes na mesma sessão: preventDefault (evita repetir o card nativo).
 * Em ambos os casos o evento é guardado e prompt() funciona após clique real (web.dev/articles/customize-install).
 */
export const nativeOfferedKey = (path: string) => `deliverychannel_pwa_native_offered_${path.replace(/\/+$/, '') || '/'}`;
/** Nunca suprime o card nativo do Chrome: ele decide quando mostrar; o evento é guardado para o botão. */
export function shouldSuppressNativeInfobar(_alreadyOfferedThisSession: boolean) { return false; }
export function captureInstallEvents(w: Window) {
  w.addEventListener('beforeinstallprompt', (e) => {
    const key = nativeOfferedKey(safe(() => w.location.pathname, '/'));
    const offered = safe(() => w.sessionStorage.getItem(key) === '1', false);
    if (shouldSuppressNativeInfobar(offered)) e.preventDefault();
    else safe(() => w.sessionStorage.setItem(key, '1'), undefined);
    deferred = e as BeforeInstallPromptEvent; listeners.forEach(l => l());
  });
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
  if (acceptedRecently(c)) return null;
  // Até a instalação real, toda nova visita/recarga volta a mostrar o convite (sem intervalo mínimo).
  if (c.trigger === 'visit') return 'modal';
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

/**
 * Superfície do convite. Com evento nativo disponível: nada fixo (o Chrome controla seu card nativo);
 * nos momentos-chave, só um card escuro compacto cujo botão chama prompt(). Sem evento: card escuro
 * próprio (convite) ou barra escura compacta persistente (dispensável na sessão).
 */
export type InviteSurface = 'none' | 'native-card' | 'fallback-card' | 'fallback-bar';
export function inviteSurface(o: { installed: boolean; standalone: boolean; hidden: boolean; inviteOpen: boolean; nativeAvailable: boolean; barDismissed: boolean }): InviteSurface {
  if (o.installed || o.standalone || o.hidden) return 'none';
  if (o.inviteOpen) return o.nativeAvailable ? 'native-card' : 'fallback-card';
  // Barra compacta "Instalar app" sempre visível até instalar (com ou sem evento nativo).
  return 'fallback-bar';
}

// --- Acompanhamento após aceitar a instalação nativa (sem porcentagem e sem conclusão simulada) ---
export type InstallPhase = 'idle' | 'installing' | 'slow' | 'finishing' | 'done';
/** Sem appinstalled após este tempo: só orienta conferir a tela inicial (não marca instalado). */
export const INSTALL_SLOW_MS = 3 * 60 * 1000;
export const INSTALL_DONE_HIDE_MS = 8000;
export function installPhaseCopy(phase: InstallPhase, storeName: string): { title: string; subtitle: string } | null {
  if (phase === 'installing') return { title: `Instalando o app ${storeName}…`, subtitle: 'Isso pode levar até 2 minutos. Pode continuar comprando.' };
  if (phase === 'slow') return { title: storeName, subtitle: 'Confira sua tela inicial — o ícone deve aparecer em instantes' };
  if (phase === 'done') return { title: `Pronto! O app ${storeName} está na sua tela inicial`, subtitle: '' };
  if (phase === 'finishing') return { title: `Pronto! O app ${storeName} está na sua tela inicial`, subtitle: 'Finalizando no seu celular…' };
  return null;
}
/** Próxima fase a partir dos sinais reais: aceite nativo → instalando; appinstalled → pronto; recusa → normal. */
export function nextInstallPhase(cur: InstallPhase, signal: 'accepted' | 'dismissed' | 'appinstalled' | 'slow-timeout'): InstallPhase {
  if (signal === 'appinstalled') return 'done';
  if (signal === 'accepted') return 'installing';
  if (signal === 'dismissed') return cur === 'done' ? 'done' : 'idle';
  return cur === 'installing' ? 'slow' : cur;
}

/**
 * Porcentagem exibida enquanto o Chrome instala, em estilo "player": arranque rápido (~40% em 8 s),
 * desacelera, acelera de novo, desacelera e se aproxima de 90% perto dos 75 s. Sem confirmação real
 * (appinstalled / app detectado) nunca passa de 90%.
 * Com confirmação: acelera até 100% em ~3 s, mas nunca antes de 20 s desde o aceite
 * (o appinstalled do Chrome chega antes do ícone existir).
 * `installedAtMs` = tempo decorrido (desde o aceite) em que a confirmação chegou, ou null.
 */
export const INSTALL_MIN_MS = 75 * 1000;
/** Duração da aceleração final após a confirmação. */
export const INSTALL_FINISH_MIN_MS = 3 * 1000;
/** Mínimo absoluto, desde o aceite, para chegar a 100%. */
export const INSTALL_DONE_MIN_MS = 20 * 1000;
export const INSTALL_EST_MS = INSTALL_MIN_MS;
const INSTALL_CAP = 90;
// [tempo ms, %, easing do trecho]: 'out' = rápido→lento, 'in' = lento→rápido.
const KEYS: [number, number, 'out' | 'in'][] = [
  [0, 0, 'out'], [8_000, 40, 'out'], [28_000, 55, 'in'], [45_000, 76, 'out'], [INSTALL_MIN_MS, 89, 'out'],
];
export function baseCurve(elapsedMs: number): number {
  const e = Math.max(0, elapsedMs);
  for (let i = 1; i < KEYS.length; i++) {
    const [t1, p1, ease] = KEYS[i]; const [t0, p0] = KEYS[i - 1];
    if (e <= t1) {
      const u = (e - t0) / (t1 - t0);
      const k = ease === 'out' ? 1 - (1 - u) * (1 - u) : u * u;
      return p0 + (p1 - p0) * k;
    }
  }
  // Depois de 75 s: aproxima lentamente de 90% sem ultrapassar.
  const last = KEYS[KEYS.length - 1][1];
  return last + (INSTALL_CAP - last) * Math.min(1, (e - INSTALL_MIN_MS) / 60_000);
}
export function estimatedInstallPercent(elapsedMs: number, installedAtMs: number | null): number {
  const e = Math.max(0, elapsedMs);
  if (installedAtMs == null) return Math.min(INSTALL_CAP, Math.floor(baseCurve(e)));
  const tI = Math.max(0, Math.min(installedAtMs, e));
  const rampStart = Math.max(tI, INSTALL_DONE_MIN_MS - INSTALL_FINISH_MIN_MS);
  const end = rampStart + INSTALL_FINISH_MIN_MS;
  if (e >= end) return 100;
  const capped = (t: number) => Math.min(INSTALL_CAP, baseCurve(t));
  if (e <= rampStart) return Math.floor(capped(e));
  const p0 = capped(rampStart);
  const u = (e - rampStart) / INSTALL_FINISH_MIN_MS;
  return Math.min(99, Math.floor(p0 + (100 - p0) * u));
}
