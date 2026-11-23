import { useEffect, useState } from 'react';
import { BadgeCheck, TriangleAlert } from 'lucide-react';
import { useThemeEditorContext } from '../ThemeEditorContext';
import { isDraftLogoConfirmed, logoChangedAfterConfirmation } from '../../../../lib/pwa/logoConfirmation';

const safeGet = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
/** Mesmo texto para todas as lojas (pedido do David, 19/11/2026). */
export const LOGO_CHANGE_WARNING_TEXT = 'Sua nova logo já aparece dentro do app na hora e para todos os novos clientes. Clientes antigos verão um botão para atualizar o ícone da tela inicial.';
export const logoWarningKey = (tenantId: string, logoUrl: string) => `dc:logo-change-warning:${tenantId}:${logoUrl}`;

/**
 * "Confirmar logo definitiva": o convite "Instalar app" só aparece para os clientes depois da confirmação
 * (salva junto com o design). Trocar a logo depois mostra um aviso uma vez.
 */
export function LogoConfirmation() {
  const { activeTenant, draftTheme, updateTokens } = useThemeEditorContext();
  const saved = activeTenant.theme;
  const logo = (draftTheme.logoUrl || '').trim();
  const confirmed = isDraftLogoConfirmed(draftTheme, saved);
  const changed = logoChangedAfterConfirmation(draftTheme, saved);
  const warnKey = logoWarningKey(activeTenant.id, logo);
  const [warnSeen, setWarnSeen] = useState(() => !!safeGet(warnKey));
  useEffect(() => { setWarnSeen(!!safeGet(warnKey)); }, [warnKey]);

  const confirm = () => updateTokens((prev) => ({ ...prev, meta: { ...prev.meta, logoConfirmedUrl: logo } }));

  return (
    <div className="mt-2 space-y-2">
      {changed && !warnSeen && (
        <div data-testid="logo-change-warning" role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          <p className="flex items-center gap-1.5 font-bold"><TriangleAlert className="h-3.5 w-3.5" /> Você trocou a logo</p>
          <p className="mt-0.5">{LOGO_CHANGE_WARNING_TEXT}</p>
          <button type="button" className="mt-1.5 font-bold underline" onClick={() => { safeSet(warnKey, '1'); setWarnSeen(true); }}>Entendi</button>
        </div>
      )}
      {!logo ? (
        <p data-testid="logo-missing" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
          Envie a <b>logo definitiva</b> da loja. O botão <b>Instalar app</b> aparece para os clientes depois que você confirmar a logo.
        </p>
      ) : confirmed ? (
        <p data-testid="logo-confirmed" className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
          <BadgeCheck className="h-3.5 w-3.5 shrink-0" /> Logo definitiva confirmada. O botão Instalar app está liberado para os clientes.
        </p>
      ) : (
        <div data-testid="logo-unconfirmed" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
          <p><b>Esta é a logo que vai ficar?</b> Ela vira o ícone do app no celular dos clientes. O botão <b>Instalar app</b> só aparece para eles depois da confirmação.</p>
          <button type="button" data-testid="logo-confirm" onClick={confirm}
            className="mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-800">
            Confirmar logo definitiva
          </button>
          <p className="mt-1 text-[10px] text-slate-500">Depois de confirmar, salve o design.</p>
        </div>
      )}
    </div>
  );
}
