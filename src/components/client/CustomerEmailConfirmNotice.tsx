import React, { useState } from 'react';
import { MailCheck, Loader2, RefreshCw } from 'lucide-react';

export type CustomerEmailNoticeKind = 'signup' | 'unconfirmed';

interface Props {
  email: string;
  kind: CustomerEmailNoticeKind;
  onResend: (email: string) => Promise<{ success: boolean; error?: string }>;
  /** "Já confirmei, entrar" — volta ao formulário de login com o e-mail preenchido. */
  onBackToLogin?: () => void;
  /** Texto sobre o que acontece depois de confirmar (padrão: volta para a loja para finalizar o pedido). */
  afterConfirmHint?: string;
}

/**
 * Aviso persistente da confirmação de e-mail do cliente na vitrine (não some como um toast).
 * - signup: conta criada, falta tocar no link enviado;
 * - unconfirmed: tentativa de login com e-mail ainda não confirmado (aviso amigável, não erro).
 */
export const CustomerEmailConfirmNotice: React.FC<Props> = ({ email, kind, onResend, onBackToLogin, afterConfirmHint }) => {
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const resend = async () => {
    if (sending) return;
    setSending(true);
    setFeedback(null);
    try {
      const res = await onResend(email);
      setFeedback(res.success
        ? { ok: true, text: `Novo link enviado para ${email}. Confira também a caixa de spam.` }
        : { ok: false, text: res.error || 'Não foi possível reenviar agora. Tente novamente em alguns minutos.' });
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Não foi possível reenviar agora. Tente novamente em alguns minutos.' });
    } finally {
      setSending(false);
    }
  };

  const tone = kind === 'signup'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
    : 'bg-amber-50 border-amber-200 text-amber-950';

  return (
    <div data-testid="customer-email-confirm-notice" data-kind={kind} role="status" aria-live="polite"
      className={`p-3.5 rounded-2xl border text-xs space-y-2.5 ${tone}`}>
      <div className="flex items-start gap-2.5">
        <MailCheck className={`w-5 h-5 shrink-0 mt-0.5 ${kind === 'signup' ? 'text-emerald-700' : 'text-amber-700'}`} />
        <div className="space-y-1 min-w-0">
          <p className="font-bold text-sm">{kind === 'signup' ? 'Confirme seu e-mail' : 'Falta confirmar seu e-mail'}</p>
          <p className="leading-relaxed break-words">
            {kind === 'signup' ? 'Enviamos' : 'Já enviamos'} um link de confirmação para <strong>{email}</strong>. Abra seu e-mail e toque no link para ativar sua conta.
          </p>
          <p className="text-[11px] opacity-80">{afterConfirmHint || 'Depois de confirmar, você volta para esta loja e já pode finalizar o pedido.'}</p>
        </div>
      </div>
      {feedback && (
        <p className={`text-[11px] font-semibold ${feedback.ok ? 'text-emerald-800' : 'text-rose-700'}`}>{feedback.text}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={resend} disabled={sending} data-testid="resend-confirmation"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-black/10 font-bold text-[11px] cursor-pointer disabled:opacity-60">
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Reenviar e-mail
        </button>
        {onBackToLogin && (
          <button type="button" onClick={onBackToLogin}
            className="px-3 py-1.5 rounded-lg font-bold text-[11px] underline cursor-pointer">
            Já confirmei, entrar
          </button>
        )}
      </div>
    </div>
  );
};
