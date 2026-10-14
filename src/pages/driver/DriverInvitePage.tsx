import React, { useEffect, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Bike, AlertCircle, LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { RoleTenantSwitcher } from '../../components/layout/RoleTenantSwitcher';
import { driverInviteRepository, DriverInvitePreview } from '../../repositories/driverRepository';
import { redeemOutcome, storeInitials, rememberInviteToken, clearInviteToken } from '../../lib/driverInviteFlow';
import { DriverStatusScreen } from './DriverStatusScreen';
import type { DriverScreenVariant } from '../../lib/membershipResolution';

export const INVALID_INVITE_MESSAGE = 'Convite inválido ou expirado. Peça um novo link à loja.';

/** Logo da loja ou placeholder com as iniciais, nas cores do app do entregador. */
export const StoreLogo: React.FC<{ name?: string; logo?: string | null }> = ({ name, logo }) => {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return <img src={logo} alt={name || 'Loja'} onError={() => setFailed(true)} className="w-16 h-16 rounded-2xl object-cover mx-auto" />;
  }
  return (
    <div data-testid="store-logo-placeholder" className="w-16 h-16 rounded-2xl bg-amber-500 text-black flex items-center justify-center font-bold text-xl mx-auto">
      {storeInitials(name)}
    </div>
  );
};

const Header: React.FC = () => (
  <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30 flex items-center gap-2.5 shadow-xs">
    <div className="w-9 h-9 rounded-xl bg-amber-500 text-black flex items-center justify-center font-bold">
      <Bike className="w-5 h-5" />
    </div>
    <h1 className="text-sm font-bold text-gray-900 leading-tight">AdegaFood Entregador</h1>
  </div>
);

export interface DriverInviteViewProps {
  state: 'LOADING' | 'INVALID' | 'VALID';
  preview?: DriverInvitePreview | null;
  hasSession: boolean;
  isRedeeming?: boolean;
  error?: string | null;
  onJoin?: () => void;
  onSignUp?: () => void;
  onLogin?: () => void;
}

/** Parte visual da página do convite (testável sem rede). */
export const DriverInviteView: React.FC<DriverInviteViewProps> = ({ state, preview, hasSession, isRedeeming, error, onJoin, onSignUp, onLogin }) => (
  <div className="min-h-screen bg-gray-50 pb-24 text-gray-900 font-sans">
    <Header />
    <div className="max-w-lg mx-auto p-4">
      <Card className="p-6 text-center space-y-3">
        {state === 'LOADING' && <p className="text-xs text-gray-500">Carregando convite...</p>}
        {state === 'INVALID' && (
          <>
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>
            <p className="text-sm font-semibold text-gray-800">{INVALID_INVITE_MESSAGE}</p>
          </>
        )}
        {state === 'VALID' && preview && (
          <>
            <StoreLogo name={preview.storeName} logo={preview.storeLogo} />
            <h2 className="text-lg font-bold text-gray-900">{preview.storeName}</h2>
            <p className="text-xs text-gray-500">Convite para se cadastrar como entregador desta loja.</p>
            {preview.expiresAt && (
              <p className="text-[11px] text-gray-500">Válido até {new Date(preview.expiresAt).toLocaleString('pt-BR')}</p>
            )}
            {error && <p className="text-xs text-rose-700">{error}</p>}
            {hasSession ? (
              <Button onClick={onJoin} disabled={isRedeeming} className="w-full cursor-pointer">
                {isRedeeming ? 'Entrando...' : 'Entrar na equipe'}
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <Button onClick={onSignUp} leftIcon={<UserPlus className="w-4 h-4" />} className="w-full cursor-pointer">Criar conta</Button>
                <Button variant="outline" onClick={onLogin} leftIcon={<LogIn className="w-4 h-4" />} className="w-full cursor-pointer">Já tenho conta</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  </div>
);

/** Página pública /entregador/convite/:token (F7). O token nunca vai para console, analytics ou localStorage. */
export const DriverInvitePage: React.FC<{ token: string }> = ({ token }) => {
  const { supabaseUser, retryAuthResolution, signOut, currentUser } = useAuth();
  const [state, setState] = useState<'LOADING' | 'INVALID' | 'VALID'>('LOADING');
  const [preview, setPreview] = useState<DriverInvitePreview | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<DriverScreenVariant | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    driverInviteRepository.previewInvite(token)
      .then(p => { if (alive) { setPreview(p); setState(p.valid ? 'VALID' : 'INVALID'); } })
      .catch(() => { if (alive) setState('INVALID'); });
    return () => { alive = false; };
  }, [token]);

  const goToAuth = () => {
    rememberInviteToken(sessionStorage, token);
    sessionStorage.setItem('adegafood_auth_return_to', window.location.pathname);
    setAuthOpen(true);
  };

  const handleJoin = async () => {
    setIsRedeeming(true);
    setError(null);
    try {
      const result = await driverInviteRepository.redeemInvite(token);
      clearInviteToken(sessionStorage, window.history);
      const outcome = redeemOutcome(result);
      if (outcome.kind === 'INVALID') { setState('INVALID'); return; }
      if (outcome.kind === 'GO_APP') { window.location.replace('/entregador'); return; }
      if (outcome.kind === 'STATUS') { setStatusVariant(outcome.variant); return; }
      // PENDING: recarrega vínculos; o App passa a mostrar "Aguardando aprovação".
      setStatusVariant('PENDING');
      await retryAuthResolution();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível concluir a ação. Tente novamente.');
    } finally {
      setIsRedeeming(false);
    }
  };

  if (statusVariant) {
    return (
      <DriverStatusScreen
        variant={statusVariant}
        storeName={preview?.storeName}
        userName={currentUser?.name}
        onRefresh={statusVariant === 'PENDING' ? async () => { await retryAuthResolution(); window.location.replace('/entregador'); } : undefined}
        onSignOut={async () => { await signOut(); window.location.replace('/'); }}
      />
    );
  }

  return (
    <>
      <DriverInviteView
        state={state}
        preview={preview}
        hasSession={!!supabaseUser}
        isRedeeming={isRedeeming}
        error={error}
        onJoin={handleJoin}
        onSignUp={goToAuth}
        onLogin={goToAuth}
      />
      <RoleTenantSwitcher isOpen={authOpen} onClose={() => setAuthOpen(false)} onStartOnboarding={() => setAuthOpen(false)} />
    </>
  );
};
