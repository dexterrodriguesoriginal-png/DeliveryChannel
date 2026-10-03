import React, { useState, useEffect } from 'react';
import { Mail, CheckCircle2, ArrowLeft, RefreshCw, Clock, Sparkles } from 'lucide-react';
import { Button } from '../ui/Button';

export interface EmailConfirmationScreenProps {
  email: string;
  onResend: () => Promise<{ success: boolean; error?: string }>;
  onBackToLogin: () => void;
  onCheckSession?: () => Promise<void>;
}

export const EmailConfirmationScreen: React.FC<EmailConfirmationScreenProps> = ({
  email,
  onResend,
  onBackToLogin,
  onCheckSession,
}) => {
  const [isResending, setIsResending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [cooldown, setCooldown] = useState<number>(0);
  const [isChecking, setIsChecking] = useState(false);

  // Timer decrescente de cooldown para prevenir cliques repetidos
  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    setFeedback(null);

    try {
      const res = await onResend();
      if (res.success) {
        setFeedback({
          type: 'success',
          message: 'Link de confirmação reenviado com sucesso! Verifique sua caixa de entrada.',
        });
        setCooldown(60); // 60s de intervalo amigável
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'Não foi possível reenviar o link agora. Tente novamente em instantes.',
        });
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleCheck = async () => {
    if (!onCheckSession || isChecking) return;
    setIsChecking(true);
    try {
      await onCheckSession();
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-emerald-50/60 via-slate-50 to-white flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 sm:p-10 shadow-2xl shadow-emerald-950/5 border border-emerald-100 text-center space-y-6">
        {/* Badge do AdegaFood */}
        <div className="mx-auto flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-700 text-white flex items-center justify-center text-2xl font-black shadow-lg shadow-emerald-700/25 mb-4">
            AF
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/60 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            AdegaFood
          </span>
        </div>

        {/* Ícone de Email Destacado */}
        <div className="relative mx-auto w-20 h-20 rounded-full bg-emerald-100/70 border border-emerald-200 flex items-center justify-center text-emerald-700">
          <Mail className="w-10 h-10" />
          <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-md">
            <CheckCircle2 className="w-4 h-4" />
          </span>
        </div>

        {/* Título Oficial */}
        <div>
          <h1 className="text-2xl font-extrabold text-gray-950">
            Confirme seu e-mail
          </h1>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            Enviamos um link de confirmação para seu e-mail.
          </p>
        </div>

        {/* E-mail Utilizado */}
        {email && (
          <div className="p-3.5 bg-gray-50/80 rounded-2xl border border-gray-200/80 text-xs font-semibold text-gray-800 break-all flex items-center justify-center gap-2">
            <Mail className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{email}</span>
          </div>
        )}

        {/* Texto Orientativo Oficial */}
        <div className="bg-emerald-50/50 rounded-2xl p-4 border border-emerald-100/80 text-xs text-gray-700 leading-relaxed text-left space-y-2">
          <p className="font-semibold text-emerald-950 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            Próximo passo:
          </p>
          <p>
            Abra seu e-mail e clique no link de confirmação para ativar sua conta.
          </p>
          <p className="text-[11px] text-gray-500 pt-1 border-t border-emerald-100/60">
            Não encontrou a mensagem? Lembre-se de conferir sua pasta de spam ou lixo eletrônico.
          </p>
        </div>

        {/* Mensagem de Feedback */}
        {feedback && (
          <div
            className={`p-3.5 rounded-2xl text-xs font-medium text-left ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                : 'bg-rose-50 text-rose-900 border border-rose-200'
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* Botões Oficiais */}
        <div className="space-y-3 pt-2">
          <Button
            type="button"
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer transition-all shadow-md shadow-emerald-700/20 disabled:opacity-60"
            disabled={isResending || cooldown > 0}
            onClick={handleResend}
          >
            {isResending ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Reenviando...
              </>
            ) : cooldown > 0 ? (
              <>
                <Clock className="w-4 h-4 mr-2" />
                Aguarde {cooldown}s para reenviar
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Reenviar e-mail
              </>
            )}
          </Button>

          {onCheckSession && (
            <Button
              type="button"
              variant="outline"
              className="w-full py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
              disabled={isChecking}
              onClick={handleCheck}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-2 ${isChecking ? 'animate-spin' : ''}`} />
              Já confirmou no e-mail? Verificar ativação
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            className="w-full py-2.5 text-xs text-gray-600 hover:text-gray-900 cursor-pointer"
            onClick={onBackToLogin}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar para entrar
          </Button>
        </div>
      </div>
    </div>
  );
};
