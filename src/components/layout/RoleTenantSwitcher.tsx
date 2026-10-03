import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { 
  Store, 
  User, 
  Check, 
  Lock, 
  LogIn, 
  LogOut, 
  AlertCircle, 
  RefreshCw,
  Building2,
  Phone,
  Mail,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  Zap
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { RoleId } from '../../types';

// Tradução comercial dos papéis de acesso para o usuário final
const ROLE_LABELS: Record<RoleId, string> = {
  CEO: 'Administração Global',
  SUPER_ADMIN: 'Super Administrador',
  OWNER: 'Proprietário',
  MANAGER: 'Gerente',
  OPERATOR: 'Operador',
  CASHIER: 'Caixa',
  DELIVERY_MANAGER: 'Gestão de Entregas',
  DRIVER: 'Entregador',
  CUSTOMER: 'Cliente',
};

export interface RoleTenantSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  onStartOnboarding?: () => void;
}

export const RoleTenantSwitcher: React.FC<RoleTenantSwitcherProps> = ({
  isOpen,
  onClose,
  onStartOnboarding,
}) => {
  const { 
    currentUser, 
    activeRole, 
    activeTenant, 
    availableTenants,
    switchTenant,
    hasTenantMembership,
    isAccountSuspended,
    supabaseUser,
    isSupabaseAuth,
    authState,
    signInWithPassword,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
    bypassLoginAsOwner,
  } = useAuth();

  const { showToast } = useToast();

  // Estados de visualização do Modal
  // Se logado: 'ACCOUNT'
  // Se deslogado: 'LOGIN' | 'SIGNUP' | 'FORGOT'
  const [viewMode, setViewMode] = useState<'LOGIN' | 'SIGNUP' | 'FORGOT' | 'ACCOUNT'>('LOGIN');

  // Campos do formulário
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const [loading, setLoading] = useState(false);
  const [bypassLoading, setBypassLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const handleDevBypass = async () => {
    setFormError(null);
    setBypassLoading(true);
    try {
      await bypassLoginAsOwner();
      showToast('Acesso de dono ativado (Modo Dev)!', 'success');
      onClose();
    } catch (err: any) {
      setFormError(err?.message || 'Não foi possível acessar o painel diretamente.');
    } finally {
      setBypassLoading(false);
    }
  };

  // Sincroniza visualização ao abrir
  useEffect(() => {
    if (isOpen) {
      setFormError(null);
      setFormSuccess(null);
      if (isSupabaseAuth) {
        setViewMode('ACCOUNT');
      } else {
        setViewMode('LOGIN');
      }
    }
  }, [isOpen, isSupabaseAuth]);

  // Se o usuário estiver no modal de Login/Signup e a autenticação for concluída:
  // - Se já tem estabelecimento (CASO 2): fecha modal e vai para Dashboard
  // - Se não tem estabelecimento (CASO 1): fecha modal para ir direto ao OnboardingCreateTenant na tela principal
  // - Se confirmação de e-mail necessária: fecha modal para exibir a tela "Confirme seu e-mail"
  useEffect(() => {
    if (isOpen && (viewMode === 'LOGIN' || viewMode === 'SIGNUP')) {
      if (authState === 'AUTHENTICATED_WITH_MEMBERSHIP') {
        onClose();
      } else if (authState === 'AUTHENTICATED_WITHOUT_MEMBERSHIP') {
        if (onStartOnboarding) {
          onStartOnboarding();
        }
        onClose();
      } else if (authState === 'EMAIL_CONFIRMATION_REQUIRED') {
        onClose();
      }
    }
  }, [isOpen, viewMode, authState, onClose, onStartOnboarding]);

  // Ativação explícita do fluxo de Onboarding (Comando 36)
  const handleStartOnboarding = () => {
    // 1. Verifica se existe sessão autenticada real
    if (!isSupabaseAuth && !supabaseUser && !currentUser) {
      showToast('Faça login primeiro para continuar.', 'warning');
      setViewMode('LOGIN');
      return;
    }

    // 2. NÃO executa signOut
    // 3. NÃO simplesmente chama onClose
    // 4. Ativa o fluxo de onboarding
    if (onStartOnboarding) {
      onStartOnboarding();
    }

    // 5. Fecha o modal de conta
    // 6. Permite que App.tsx renderize OnboardingCreateTenant como tela principal
    onClose();
  };

  // Formatação amigável de telefone brasileiro (XX) XXXXX-XXXX
  const formatPhone = (value: string) => {
    const raw = value.replace(/\D/g, '').slice(0, 11);
    if (raw.length <= 2) return raw;
    if (raw.length <= 6) return `(${raw.slice(0, 2)}) ${raw.slice(2)}`;
    if (raw.length <= 10) return `(${raw.slice(0, 2)}) ${raw.slice(2, 6)}-${raw.slice(6)}`;
    return `(${raw.slice(0, 2)}) ${raw.slice(2, 7)}-${raw.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  // Submissão do Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!email.trim() || !password) {
      setFormError('Informe seu e-mail e senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await signInWithPassword(email.trim(), password);
      if (res.success) {
        showToast('Login realizado com sucesso!', 'success');
        setViewMode('ACCOUNT');
        onClose();
      } else {
        // Mensagem amigável de erro
        const err = res.error || '';
        if (err.toLowerCase().includes('credential') || err.toLowerCase().includes('incorret')) {
          setFormError('E-mail ou senha incorretos. Verifique suas credenciais.');
        } else {
          setFormError(res.error || 'Não foi possível entrar. Tente novamente.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Submissão do Cadastro
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    // Validações
    if (!fullName.trim()) {
      setFormError('Informe seu nome completo.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setFormError('Informe um endereço de e-mail válido.');
      return;
    }
    const rawDigits = phone.replace(/\D/g, '');
    if (!rawDigits || rawDigits.length < 10) {
      setFormError('Informe um número de telefone com DDD válido.');
      return;
    }
    if (!password || password.length < 6) {
      setFormError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (!confirmPassword) {
      setFormError('Confirme sua senha para continuar.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('As senhas digitadas não coincidem. Verifique a confirmação.');
      return;
    }

    setLoading(true);
    try {
      const res = await signUp(email.trim(), password, fullName.trim(), phone.trim());
      if (res.success) {
        if (res.requiresEmailConfirmation) {
          showToast('Cadastro realizado! Enviamos um link de confirmação para o seu e-mail.', 'info');
          onClose();
        } else {
          setFormSuccess('Conta criada com sucesso! Você já pode entrar.');
          showToast('Conta criada com sucesso!', 'success');
          setTimeout(() => {
            setViewMode('LOGIN');
            setPassword('');
            setConfirmPassword('');
          }, 1200);
        }
      } else {
        const err = res.error || '';
        if (
          err.toLowerCase().includes('already registered') || 
          err.toLowerCase().includes('user already') ||
          err.toLowerCase().includes('já está cadastrado')
        ) {
          setFormError('Este e-mail já está cadastrado. Por favor, acesse a tela de login.');
        } else if (err.toLowerCase().includes('weak') || err.toLowerCase().includes('characters')) {
          setFormError('Senha muito fraca. Utilize pelo menos 6 caracteres.');
        } else {
          setFormError(res.error || 'Não foi possível concluir seu cadastro. Tente novamente.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Submissão de Esqueci Minha Senha
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!email.trim()) {
      setFormError('Informe seu e-mail cadastrado para redefinir a senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await resetPassword(email.trim());
      if (res.success) {
        setFormSuccess('Enviamos um link para o seu e-mail com instruções para criar uma nova senha.');
      } else {
        setFormError(res.error || 'Não foi possível solicitar a redefinição de senha.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Login com Google
  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle({ returnTo: '/', intent: 'owner' });
    } catch (err: any) {
      setFormError('Não foi possível conectar com o Google no momento.');
    }
  };

  // Logout
  const handleSignOut = async () => {
    await signOut();
    showToast('Você saiu da sua conta.', 'info');
    setViewMode('LOGIN');
    onClose();
  };

  // Troca de Estabelecimento
  const handleSelectTenant = async (tenantId: string) => {
    const success = await switchTenant(tenantId);
    if (success) {
      showToast('Estabelecimento selecionado com sucesso.', 'success');
      onClose();
    } else {
      showToast('Não foi possível alternar o estabelecimento.', 'error');
    }
  };

  // Título e Subtítulo dinâmicos conforme tela
  let modalTitle = 'Minha Conta';
  if (!isSupabaseAuth) {
    if (viewMode === 'LOGIN') modalTitle = 'Entre na sua conta';
    if (viewMode === 'SIGNUP') modalTitle = 'Criar minha conta';
    if (viewMode === 'FORGOT') modalTitle = 'Recuperar senha';
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="md"
    >
      <div className="space-y-4 font-sans text-gray-800">
        {/* ========================================================================= */}
        {/* TELA 1: USUÁRIO AUTENTICADO — MINHA CONTA & MEUS ESTABELECIMENTOS        */}
        {/* ========================================================================= */}
        {isSupabaseAuth && viewMode === 'ACCOUNT' && (
          <div className="space-y-5">
            {/* Bloco de Dados da Conta */}
            <div className="flex items-center gap-3.5 p-4 bg-gray-50/80 border border-gray-200/70 rounded-2xl">
              <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white font-black text-lg flex items-center justify-center shadow-xs">
                {currentUser?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-extrabold text-gray-950 truncate">
                  {currentUser?.name || 'Comerciante'}
                </h4>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 truncate mt-0.5">
                  <Mail className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{supabaseUser?.email}</span>
                </div>
                {currentUser?.phone && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 truncate mt-0.5">
                    <Phone className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                    <span>{currentUser.phone}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Aviso amigável caso suspenso */}
            {isAccountSuspended && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-900 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-rose-950">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Acesso Suspenso</span>
                </div>
                <p className="text-rose-800">
                  O acesso ao seu estabelecimento está temporariamente suspenso. Para reativar seu acesso, entre em contato com o suporte da plataforma.
                </p>
              </div>
            )}

            {/* Lista de Estabelecimentos Reais */}
            {availableTenants.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Meus estabelecimentos
                  </h5>
                  <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full">
                    {availableTenants.length} {availableTenants.length === 1 ? 'loja' : 'lojas'}
                  </span>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                  {availableTenants.map((t) => {
                    const isSelected = activeTenant?.id === t.tenantId;
                    return (
                      <div
                        key={t.tenantId}
                        className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-emerald-50/70 border-emerald-400 ring-1 ring-emerald-500/20 shadow-2xs'
                            : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600'
                          }`}>
                            <Store className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-gray-950 truncate">
                              {t.tenantName}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                              <span>{t.category || 'Adega'}</span>
                              <span>•</span>
                              <span className="font-medium text-emerald-800">
                                {ROLE_LABELS[t.roleId] || t.roleId}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          {isSelected ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg">
                              <Check className="w-3.5 h-3.5" />
                              Ativo
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSelectTenant(t.tenantId)}
                              className="text-xs py-1 px-3 border-gray-300 hover:bg-emerald-50 hover:text-emerald-900 hover:border-emerald-300"
                            >
                              Entrar
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Caso: Usuário logado SEM nenhum estabelecimento vinculado */}
            {!hasTenantMembership && !isAccountSuspended && activeRole !== 'CEO' && (
              <div className="p-5 bg-linear-to-br from-emerald-50 to-emerald-100/40 border border-emerald-200/80 rounded-2xl space-y-3">
                <div className="flex items-center gap-2.5 font-bold text-emerald-950 text-sm">
                  <Sparkles className="w-4 h-4 text-emerald-700" />
                  <span>Vamos criar seu estabelecimento</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Seu cadastro está pronto. Agora configure seu negócio para começar a vender online.
                </p>
                <Button
                  className="w-full py-2.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 shadow-xs cursor-pointer"
                  onClick={handleStartOnboarding}
                >
                  <Building2 className="w-4 h-4 mr-2" />
                  Criar estabelecimento
                </Button>
              </div>
            )}

            {/* Ações do Usuário: Sair da Conta */}
            <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-400">AdegaFood SaaS</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSignOut}
                className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Sair da conta
              </Button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TELA 2: LOGIN COM GOOGLE OU E-MAIL                                       */}
        {/* ========================================================================= */}
        {!isSupabaseAuth && viewMode === 'LOGIN' && (
          <div className="space-y-4">
            <div className="text-left">
              <p className="text-xs text-gray-500">
                Acesse seu estabelecimento e gerencie seu negócio.
              </p>
            </div>

            {/* Botão Temporário de Acesso Direto para Programação */}
            <div className="p-3 bg-amber-500/10 border-2 border-amber-400 rounded-2xl text-left">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                  <span>Acesso Rápido de Programação</span>
                </div>
                <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-amber-200 text-amber-950 rounded-full tracking-wider">
                  Temporário
                </span>
              </div>
              <p className="text-[11px] text-amber-950/85 mb-2 leading-tight">
                Acesse o <strong>Painel do Dono</strong> direto sem login enquanto programa o sistema:
              </p>
              <button
                type="button"
                onClick={handleDevBypass}
                disabled={bypassLoading}
                className="w-full py-2.5 px-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-black text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer border border-amber-600/30"
              >
                <Zap className="w-3.5 h-3.5 fill-slate-950" />
                <span>{bypassLoading ? 'Acessando painel...' : '⚡ Acessar Painel sem Fazer Login'}</span>
              </button>
            </div>

            {/* Botão Principal: Google OAuth */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white hover:bg-gray-50 border border-gray-300 rounded-xl text-xs font-bold text-gray-800 shadow-2xs transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              Continuar com Google
            </button>

            <div className="relative flex py-1 items-center">
              <div className="grow border-t border-gray-200"></div>
              <span className="shrink mx-4 text-xs text-gray-400 font-medium">ou entre com e-mail</span>
              <div className="grow border-t border-gray-200"></div>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-3">
              <Input
                label="E-mail"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                required
              />

              <Input
                label="Senha"
                type="password"
                placeholder="Sua senha de acesso"
                value={password}
                onChange={e => setPassword(e.target.value)}
                leftIcon={<Lock className="w-4 h-4" />}
                required
              />

              <Button
                type="submit"
                className="w-full py-2.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 shadow-xs"
                disabled={loading}
              >
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>Entrando...</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center gap-2">
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    <span>Entrar no Estabelecimento</span>
                  </span>
                )}
              </Button>
            </form>

            <div className="flex items-center justify-between pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setViewMode('FORGOT');
                  setFormError(null);
                  setFormSuccess(null);
                }}
                className="text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                Esqueci minha senha
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewMode('SIGNUP');
                  setFormError(null);
                  setFormSuccess(null);
                }}
                className="text-emerald-700 hover:text-emerald-900 font-bold cursor-pointer"
              >
                Criar minha conta
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TELA 3: CADASTRO COM E-MAIL E SENHA                                      */}
        {/* ========================================================================= */}
        {!isSupabaseAuth && viewMode === 'SIGNUP' && (
          <div className="space-y-4">
            <div className="text-left">
              <p className="text-xs text-gray-500">
                Cadastre-se para começar a gerenciar seu estabelecimento.
              </p>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            {formSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{formSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSignUp} className="space-y-3">
              <Input
                label="Nome Completo *"
                placeholder="Ex: Carlos Silva"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                leftIcon={<User className="w-4 h-4" />}
                required
              />

              <Input
                label="E-mail *"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                required
              />

              <Input
                label="Telefone com DDD *"
                type="tel"
                placeholder="(11) 98765-4321"
                value={phone}
                onChange={handlePhoneChange}
                leftIcon={<Phone className="w-4 h-4" />}
                required
              />

              <div className="space-y-1">
                <Input
                  label="Senha *"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  leftIcon={<Lock className="w-4 h-4" />}
                  required
                />
                {password.length > 0 && password.length < 6 && (
                  <p className="text-[11px] text-amber-600">A senha precisa de pelo menos 6 caracteres.</p>
                )}
              </div>

              <div className="space-y-1">
                <Input
                  label="Confirmar Senha *"
                  type="password"
                  placeholder="Digite a mesma senha"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  leftIcon={<Lock className="w-4 h-4" />}
                  required
                />
                {confirmPassword && password && (
                  <p className={`text-[11px] flex items-center gap-1 font-medium ${
                    password === confirmPassword ? 'text-emerald-700' : 'text-rose-600'
                  }`}>
                    {password === confirmPassword ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Senhas coincidem</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3 h-3" />
                        <span>Senhas não conferem</span>
                      </>
                    )}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full py-2.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 shadow-xs"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" />
                    <span>Criando sua conta...</span>
                  </>
                ) : (
                  <>
                    <span>Criar conta</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                  </>
                )}
              </Button>
            </form>

            <div className="text-center pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setViewMode('LOGIN');
                  setFormError(null);
                  setFormSuccess(null);
                }}
                className="text-gray-500 hover:text-gray-800 cursor-pointer"
              >
                Já possui uma conta? <strong className="text-emerald-700">Entrar</strong>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TELA 4: ESQUECI MINHA SENHA                                               */}
        {/* ========================================================================= */}
        {!isSupabaseAuth && viewMode === 'FORGOT' && (
          <div className="space-y-4">
            <div className="text-left">
              <p className="text-xs text-gray-500">
                Digite o e-mail da sua conta para enviarmos as orientações de redefinição de senha.
              </p>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            {formSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{formSuccess}</span>
              </div>
            )}

            <form onSubmit={handleForgotPassword} className="space-y-3">
              <Input
                label="E-mail Cadastrado"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                leftIcon={<Mail className="w-4 h-4" />}
                required
              />

              <Button
                type="submit"
                className="w-full py-2.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 shadow-xs"
                disabled={loading}
              >
                {loading ? 'Enviando...' : 'Enviar link de recuperação'}
              </Button>
            </form>

            <div className="text-center pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setViewMode('LOGIN');
                  setFormError(null);
                  setFormSuccess(null);
                }}
                className="text-emerald-700 hover:text-emerald-900 font-bold cursor-pointer"
              >
                ← Voltar para o Login
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
