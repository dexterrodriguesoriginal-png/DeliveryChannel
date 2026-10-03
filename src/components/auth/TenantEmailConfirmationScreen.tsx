import React, { useState, useEffect } from 'react';
import { Mail, CheckCircle2, ArrowLeft, RefreshCw, Clock, Sparkles, Store, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button';

export interface TenantEmailConfirmationScreenProps {
  tenantName: string;
  email: string;
  commercialEmail?: string;
  tenantId?: string;
  isActivated?: boolean;
  initialError?: string;
  onResend: () => Promise<{ success: boolean; error?: string }>;
  onCheckActivation: () => Promise<void>;
  onBackToAccount: () => void;
}

export const TenantEmailConfirmationScreen: React.FC<TenantEmailConfirmationScreenProps> = ({
  tenantName,
  email,
  commercialEmail,
  tenantId,
  isActivated = false,
  initialError,
  onResend,
  onCheckActivation,
  onBackToAccount,
}) => {
  const [isResending, setIsResending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    initialError ? { type: 'error', message: initialError } : null
  );
  const [cooldown, setCooldown] = useState<number>(0);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (initialError) {
      setFeedback({ type: 'error', message: initialError });
    }
  }, [initialError]);

  // Timer decrescente de cooldown para reenvio (60 segundos)
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
          message: 'Novo link de confirmação enviado para seu e-mail. Verifique sua caixa de entrada.',
        });
        setCooldown(60);
      } else {
        setFeedback({
          type: 'error',
          message: res.error || 'Não foi possível reenviar o link agora. Aguarde alguns instantes.',
        });
      }
    } finally {
      setIsResending(false);
    }
  };

  const handleCheckActivation = async () => {
    if (isChecking) return;
    setIsChecking(true);
    setFeedback(null);
    try {
      await onCheckActivation();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Ainda não identificamos a confirmação. Por favor, acesse o link enviado para seu e-mail.',
      });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-emerald-50/70 via-slate-50 to-white flex flex-col items-center justify-center p-4 sm:p-6 font-sans">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 sm:p-10 shadow-2xl shadow-emerald-950/10 border border-emerald-100/80 text-center space-y-6 relative overflow-hidden">
        
        {/* Faixa decorativa no topo */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-linear-to-r from-emerald-600 via-emerald-500 to-teal-500" />

        {/* Badge Oficial da Marca */}
        <div className="mx-auto flex flex-col items-center pt-2">
          <div className="w-16 h-16 rounded-2xl bg-emerald-700 text-white flex items-center justify-center text-2xl font-black shadow-lg shadow-emerald-700/25 mb-3">
            AF
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-3.5 py-1 rounded-full border border-emerald-200/80 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            AdegaFood
          </span>
        </div>

        {/* Ícone de Email + Loja */}
        <div className="relative mx-auto w-20 h-20 rounded-full bg-emerald-100/80 border border-emerald-200 flex items-center justify-center text-emerald-700">
          <Mail className="w-10 h-10" />
          <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-md">
            {isActivated ? <CheckCircle2 className="w-4 h-4" /> : <Store className="w-4 h-4" />}
          </span>
        </div>

        {/* Título e Subtítulo Conforme Seção 28 e Comando 45 */}
        <div>
          <h1 className="text-2xl font-extrabold text-gray-950">
            Confirme seu e-mail
          </h1>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            {feedback?.type === 'error' && (feedback.message.includes('Não foi possível') || feedback.message.includes('limite'))
              ? feedback.message
              : 'Enviaremos o link de confirmação para o e-mail da sua conta.'}
          </p>
        </div>

        {/* Card do Estabelecimento & E-mail */}
        <div className="bg-gray-50/90 rounded-2xl p-4 border border-gray-200/80 text-left space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-gray-900 border-b border-gray-200/60 pb-2">
            <Store className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="truncate">{tenantName || 'Meu Estabelecimento'}</span>
            <span className={`ml-auto text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full border ${
              isActivated 
                ? 'bg-emerald-100 text-emerald-800 border-emerald-200' 
                : 'bg-amber-100 text-amber-800 border-amber-200'
            }`}>
              {isActivated ? 'Ativo' : 'Pendente'}
            </span>
          </div>
          
          <div className="flex items-start gap-2 text-xs text-gray-700 font-medium break-all">
            <Mail className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider">E-mail da sua conta (Magic Link):</span>
              <span className="font-semibold text-gray-900">{email}</span>
            </div>
          </div>

          {commercialEmail && (
            <div className="flex items-start gap-2 text-xs text-gray-600 font-normal break-all border-t border-gray-200/50 pt-2">
              <Store className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">E-mail comercial do estabelecimento:</span>
                <span className="text-gray-700">{commercialEmail}</span>
              </div>
            </div>
          )}
        </div>

        {/* Texto Orientativo Conforme Seção 28 */}
        <div className="bg-emerald-50/50 rounded-2xl p-4 border border-emerald-100 text-xs text-gray-700 leading-relaxed text-left space-y-2">
          <p className="font-bold text-emerald-950 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            Instruções:
          </p>
          <p className="text-gray-800 font-medium">
            Abra sua caixa de entrada e clique no link para ativar seu estabelecimento.
          </p>
          <p className="text-[11px] text-gray-400 pt-1 border-t border-emerald-100/60">
            Não encontrou a mensagem? Lembre-se de verificar sua pasta de spam ou lixo eletrônico.
          </p>
        </div>

        {/* Mensagem de sucesso após retorno ou feedback */}
        {isActivated ? (
          <div className="p-4 rounded-2xl text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>Seu estabelecimento foi ativado com sucesso. Carregando o painel...</span>
          </div>
        ) : feedback && (
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

        {/* Ações Oficiais (Seção 28) */}
        <div className="space-y-3 pt-1">
          {/* Botão [ Reenviar e-mail ] */}
          <Button
            type="button"
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer transition-all shadow-md shadow-emerald-700/20 disabled:opacity-60"
            disabled={isResending || cooldown > 0 || isActivated}
            onClick={handleResend}
          >
            {isResending ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Reenviando e-mail...
              </>
            ) : cooldown > 0 ? (
              <>
                <Clock className="w-4 h-4 mr-2 text-white/80" />
                Aguarde {cooldown}s para reenviar
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Reenviar e-mail
              </>
            )}
          </Button>

          {/* Botão Secundário de Verificação de Ativação */}
          <button
            type="button"
            onClick={handleCheckActivation}
            disabled={isChecking || isActivated}
            className="w-full text-xs text-emerald-700 hover:text-emerald-800 font-semibold py-1.5 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            <span>Já clicou no link do e-mail? Verificar ativação</span>
          </button>

          {/* Botão [ Sair / Trocar conta ] */}
          <Button
            type="button"
            variant="ghost"
            className="w-full py-2 text-xs text-gray-500 hover:text-gray-900 cursor-pointer"
            onClick={onBackToAccount}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Sair / Trocar conta
          </Button>
        </div>

      </div>
    </div>
  );
};
