import React, { useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Bike, Clock, AlertCircle, RefreshCw, LogOut } from 'lucide-react';
import type { DriverScreenVariant } from '../../lib/membershipResolution';

/** Textos neutros (sem prometer reabertura). Exportado para os testes. */
export const DRIVER_STATUS_COPY: Record<DriverScreenVariant, { title: string; message: string }> = {
  PENDING: { title: 'Aguardando aprovação', message: 'Seu cadastro foi enviado e está aguardando aprovação da loja.' },
  REJECTED: { title: 'Cadastro não aprovado', message: 'A loja não aprovou este cadastro.' },
  SUSPENDED: { title: 'Acesso suspenso pela loja', message: 'Seu acesso a esta loja está suspenso no momento.' },
  REMOVED: { title: 'Acesso removido', message: 'Seu acesso como entregador desta loja foi removido.' },
  INACTIVE: { title: 'Sem acesso a esta loja', message: 'Esta conta não tem acesso ativo a esta loja.' },
  UNAVAILABLE: { title: 'Indisponível no momento', message: 'Não foi possível confirmar seu cadastro agora. Verifique a conexão e tente novamente.' },
};

export interface DriverStatusScreenProps {
  variant: DriverScreenVariant;
  storeName?: string | null;
  userName?: string | null;
  /** PENDING (Atualizar) e UNAVAILABLE (Tentar novamente): refaz a resolução de vínculos. */
  onRefresh?: () => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
}

/** Tela neutra do entregador (F5). Mesmo cabeçalho, cores e botão "Sair" do DriverApp. */
export const DriverStatusScreen: React.FC<DriverStatusScreenProps> = ({ variant, storeName, userName, onRefresh, onSignOut }) => {
  const [refreshing, setRefreshing] = useState(false);
  const copy = DRIVER_STATUS_COPY[variant];
  const isPending = variant === 'PENDING';
  const canRetry = isPending || variant === 'UNAVAILABLE';

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24 text-gray-900 font-sans">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500 text-black flex items-center justify-center font-bold">
            <Bike className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">AdegaFood Entregador</h1>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span>{userName || 'Entregador'}</span>
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSignOut()}
          leftIcon={<LogOut className="w-3.5 h-3.5" />}
          className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
        >
          Sair
        </Button>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        <Card className="p-6 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            {isPending ? <Clock className="w-7 h-7" /> : <AlertCircle className="w-7 h-7" />}
          </div>
          <h2 className="text-lg font-bold text-gray-900">{copy.title}</h2>
          {storeName && <p className="text-sm font-semibold text-gray-700">{isPending ? `Loja ${storeName}` : storeName}</p>}
          <p className="text-xs text-gray-500 leading-relaxed">{copy.message}</p>
          {canRetry && onRefresh && (
            <Button
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              leftIcon={<RefreshCw className={refreshing ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />}
              className="cursor-pointer"
            >
              {isPending ? 'Atualizar' : 'Tentar novamente'}
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
};
