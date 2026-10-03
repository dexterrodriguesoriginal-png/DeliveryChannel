import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { 
  Mail, 
  Lock, 
  LogIn, 
  RefreshCw, 
  AlertCircle, 
  Check, 
  ArrowRight, 
  User, 
  Phone,
  ShieldCheck,
  Store,
  Sparkles,
  Zap
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export interface LoginCardProps {
  onSuccess?: () => void;
  initialMode?: 'LOGIN' | 'SIGNUP';
  returnTo?: string;
  intent?: 'owner' | 'customer';
}

export const LoginCard: React.FC<LoginCardProps> = ({
  onSuccess,
  initialMode = 'LOGIN',
  returnTo = '/',
  intent = 'owner',
}) => {
  const { 
    signInWithPassword, 
    signUp, 
    signInWithGoogle, 
    resetPassword,
    bypassLoginAsOwner
  } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<'LOGIN' | 'SIGNUP' | 'FORGOT'>(initialMode);
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
      onSuccess?.();
    } catch (err: any) {
      setFormError(err?.message || 'Não foi possível acessar o painel diretamente.');
    } finally {
      setBypassLoading(false);
    }
  };

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

  const handleGoogleLogin = async () => {
    setFormError(null);
    try {
      await signInWithGoogle({ returnTo, intent });
    } catch {
      setFormError('Não foi possível conectar com o Google no momento.');
    }
  };

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
        onSuccess?.();
      } else {
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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!fullName.trim()) {
      setFormError('Informe seu nome completo.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setFormError('Informe um e-mail válido.');
      return;
    }
    const rawDigits = phone.replace(/\D/g, '');
    if (!rawDigits || rawDigits.length < 10) {
      setFormError('Informe um telefone com DDD válido.');
      return;
    }
    if (!password || password.length < 6) {
      setFormError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('As senhas não conferem.');
      return;
    }

    setLoading(true);
    try {
      const res = await signUp(email.trim(), password, fullName.trim(), phone.trim());
      if (res.success) {
        if (res.requiresEmailConfirmation) {
          showToast('Cadastro realizado! Enviamos um link de confirmação para o seu e-mail.', 'info');
          onSuccess?.();
        } else {
          setFormSuccess('Conta criada com sucesso! Você já pode entrar.');
          showToast('Conta criada com sucesso!', 'success');
          setTimeout(() => {
            setMode('LOGIN');
            setPassword('');
            setConfirmPassword('');
          }, 1200);
        }
      } else {
        const err = res.error || '';
        if (err.toLowerCase().includes('already registered') || err.toLowerCase().includes('já está cadastrado')) {
          setFormError('Este e-mail já está cadastrado. Faça login para continuar.');
        } else {
          setFormError(res.error || 'Não foi possível concluir o cadastro.');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!email.trim()) {
      setFormError('Informe seu e-mail cadastrado.');
      return;
    }

    setLoading(true);
    try {
      const res = await resetPassword(email.trim());
      if (res.success) {
        setFormSuccess('Enviamos as instruções para o seu e-mail.');
      } else {
        setFormError(res.error || 'Não foi possível solicitar redefinição.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 shadow-xl border border-gray-200/80 text-left transition-all">
      {/* Brand Header */}
      <div className="text-center pb-5 border-b border-gray-100">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-700 text-white font-black text-lg shadow-sm shadow-emerald-700/20 mb-3 tracking-wider">
          AF
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-gray-950 tracking-tight">
          {mode === 'LOGIN' && 'Bem-vindo de volta'}
          {mode === 'SIGNUP' && 'Crie sua conta no AdegaFood'}
          {mode === 'FORGOT' && 'Recuperar acesso'}
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 mt-1 leading-relaxed">
          {mode === 'LOGIN' && 'Acesse o painel do seu estabelecimento para gerenciar pedidos.'}
          {mode === 'SIGNUP' && 'Cadastre-se para começar a vender online sem intermediários.'}
          {mode === 'FORGOT' && 'Digite seu e-mail para receber as instruções de nova senha.'}
        </p>
      </div>

      {/* Botão Temporário de Acesso Direto para Programação / Dono de Estabelecimento */}
      <div className="mt-5 mb-2 p-3.5 bg-amber-500/10 border-2 border-amber-400 rounded-2xl">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
            <span>Acesso Rápido de Programação</span>
          </div>
          <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-amber-200 text-amber-950 rounded-full tracking-wider shadow-2xs">
            Temporário
          </span>
        </div>
        <p className="text-[11.5px] text-amber-950/85 mb-2.5 leading-snug">
          Acesse o <strong>Painel do Dono</strong> diretamente sem precisar fazer login toda vez enquanto configura o sistema:
        </p>
        <button
          type="button"
          onClick={handleDevBypass}
          disabled={bypassLoading}
          className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-black text-xs sm:text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer border border-amber-600/30"
        >
          <Zap className="w-4 h-4 fill-slate-950" />
          <span>{bypassLoading ? 'Acessando painel...' : '⚡ Acessar Painel sem Fazer Login'}</span>
        </button>
      </div>

      {/* Toggle entre Login e Cadastro */}
      {mode !== 'FORGOT' && (
        <div className="flex items-center p-1 bg-gray-100 rounded-xl my-5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setMode('LOGIN');
              setFormError(null);
              setFormSuccess(null);
            }}
            className={`flex-1 py-2 rounded-lg transition-all text-center cursor-pointer ${
              mode === 'LOGIN'
                ? 'bg-white text-gray-950 shadow-xs font-bold'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('SIGNUP');
              setFormError(null);
              setFormSuccess(null);
            }}
            className={`flex-1 py-2 rounded-lg transition-all text-center cursor-pointer ${
              mode === 'SIGNUP'
                ? 'bg-white text-gray-950 shadow-xs font-bold'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Criar conta
          </button>
        </div>
      )}

      {/* Botão Google OAuth oficial */}
      {mode !== 'FORGOT' && (
        <div className="space-y-4 pt-1">
          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white hover:bg-gray-50/90 border border-gray-300 rounded-xl text-xs sm:text-sm font-bold text-gray-800 shadow-2xs transition-all cursor-pointer hover:border-gray-400"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
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
            <span>Continuar com Google</span>
          </button>

          <div className="relative flex py-1 items-center">
            <div className="grow border-t border-gray-200"></div>
            <span className="shrink mx-3 text-[11px] text-gray-400 font-medium uppercase tracking-wider select-none">
              ou com e-mail
            </span>
            <div className="grow border-t border-gray-200"></div>
          </div>
        </div>
      )}

      {/* Alerta de Erro */}
      {formError && (
        <div className="my-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2 animate-in fade-in duration-150">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      {/* Alerta de Sucesso */}
      {formSuccess && (
        <div className="my-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2 animate-in fade-in duration-150">
          <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{formSuccess}</span>
        </div>
      )}

      {/* Formulário: LOGIN */}
      {mode === 'LOGIN' && (
        <form onSubmit={handleLogin} className="space-y-3.5 mt-2">
          <Input
            label="E-mail"
            type="email"
            placeholder="ex: contato@suaadega.com.br"
            value={email}
            onChange={e => setEmail(e.target.value)}
            leftIcon={<Mail className="w-4 h-4" />}
            required
          />

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-700">Senha</label>
              <button
                type="button"
                onClick={() => {
                  setMode('FORGOT');
                  setFormError(null);
                  setFormSuccess(null);
                }}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-medium cursor-pointer"
              >
                Esqueci a senha
              </button>
            </div>
            <Input
              type="password"
              placeholder="Digite sua senha"
              value={password}
              onChange={e => setPassword(e.target.value)}
              leftIcon={<Lock className="w-4 h-4" />}
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full py-2.5 text-xs sm:text-sm font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs cursor-pointer mt-1"
            disabled={loading}
          >
            {loading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                <span>Entrando no painel...</span>
              </span>
            ) : (
              <span className="inline-flex items-center justify-center gap-2">
                <ArrowRight className="w-4 h-4 shrink-0" />
                <span>Entrar no Estabelecimento</span>
              </span>
            )}
          </Button>
        </form>
      )}

      {/* Formulário: CADASTRO */}
      {mode === 'SIGNUP' && (
        <form onSubmit={handleSignUp} className="space-y-3 mt-2">
          <Input
            label="Nome Completo *"
            placeholder="Ex: Carlos Oliveira"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            leftIcon={<User className="w-4 h-4" />}
            required
          />

          <Input
            label="E-mail Pessoal ou da Conta *"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            leftIcon={<Mail className="w-4 h-4" />}
            required
          />

          <Input
            label="Telefone com WhatsApp *"
            type="tel"
            placeholder="(11) 98765-4321"
            value={phone}
            onChange={handlePhoneChange}
            leftIcon={<Phone className="w-4 h-4" />}
            required
          />

          <Input
            label="Criar Senha *"
            type="password"
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={e => setPassword(e.target.value)}
            leftIcon={<Lock className="w-4 h-4" />}
            required
          />

          <Input
            label="Confirmar Senha *"
            type="password"
            placeholder="Repita sua senha"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            leftIcon={<Lock className="w-4 h-4" />}
            required
          />

          <Button
            type="submit"
            className="w-full py-2.5 text-xs sm:text-sm font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs cursor-pointer mt-2"
            disabled={loading}
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                <span>Criando conta...</span>
              </>
            ) : (
              <>
                <span>Cadastrar e Criar Loja</span>
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </>
            )}
          </Button>
        </form>
      )}

      {/* Formulário: ESQUECI A SENHA */}
      {mode === 'FORGOT' && (
        <form onSubmit={handleForgotPassword} className="space-y-3 mt-4">
          <Input
            label="E-mail da sua conta"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            leftIcon={<Mail className="w-4 h-4" />}
            required
          />

          <Button
            type="submit"
            className="w-full py-2.5 text-xs sm:text-sm font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs cursor-pointer"
            disabled={loading}
          >
            {loading ? 'Enviando link...' : 'Enviar link de recuperação'}
          </Button>

          <div className="text-center pt-3">
            <button
              type="button"
              onClick={() => {
                setMode('LOGIN');
                setFormError(null);
                setFormSuccess(null);
              }}
              className="text-xs text-emerald-700 hover:underline font-semibold cursor-pointer"
            >
              ← Voltar para o login
            </button>
          </div>
        </form>
      )}

      {/* Footer com Garantia de Segurança */}
      <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
          <span>Segurança SSL & RLS Multi-Tenant</span>
        </div>
        <a 
          href="/app/adega-premium" 
          target="_blank" 
          rel="noreferrer"
          className="text-emerald-700 hover:underline font-semibold"
        >
          Catálogo Demo →
        </a>
      </div>
    </div>
  );
};
