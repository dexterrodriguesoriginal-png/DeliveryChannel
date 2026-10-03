import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { CeoSupportBanner } from './components/common/CeoSupportBanner';
import { TenantIsolationTester } from './components/common/TenantIsolationTester';
import { RoleTenantSwitcher } from './components/layout/RoleTenantSwitcher';
import { OnboardingCreateTenant } from './components/onboarding/OnboardingCreateTenant';
import { EmailConfirmationScreen } from './components/auth/EmailConfirmationScreen';
import { TenantEmailConfirmationScreen } from './components/auth/TenantEmailConfirmationScreen';
import { LoginCard } from './components/auth/LoginCard';

// CEO Pages
import { CeoDashboard } from './pages/ceo/CeoDashboard';
import { CeoTenantsPage } from './pages/ceo/CeoTenantsPage';
import { CeoSponsorsPage } from './pages/ceo/CeoSponsorsPage';
import { CeoFinancePage } from './pages/ceo/CeoFinancePage';
import { CeoAuditPage } from './pages/ceo/CeoAuditPage';
import { CeoSupportPage } from './pages/ceo/CeoSupportPage';

// Establishment Pages
import { EstablishmentDashboard } from './pages/establishment/EstablishmentDashboard';
import { OrdersPage } from './pages/establishment/OrdersPage';
import { ProductsPage } from './pages/establishment/ProductsPage';
import { CategoriesPage } from './pages/establishment/CategoriesPage';
import { OffersPage } from './pages/establishment/OffersPage';
import { CustomersPage } from './pages/establishment/CustomersPage';
import { MarketingPage } from './pages/establishment/MarketingPage';
import { ThemePage } from './pages/establishment/ThemePage';
import { DriversPage } from './pages/establishment/DriversPage';
import { InventoryPage } from './pages/establishment/InventoryPage';
import { FinancePage } from './pages/establishment/FinancePage';
import { ReportsPage } from './pages/establishment/ReportsPage';
import { TeamPage } from './pages/establishment/TeamPage';
import { SettingsPage } from './pages/establishment/SettingsPage';

// Mobile / Apps
import { ClientApp } from './pages/client/ClientApp';
import { DriverApp } from './pages/driver/DriverApp';

// Icons & UI
import { ShieldAlert, Store, LogIn, Lock, RefreshCw, AlertTriangle, ShoppingBag } from 'lucide-react';
import { Button } from './components/ui/Button';
import { cn } from './utils/cn';

function AppContent() {
  const { 
    currentUser, 
    activeRole, 
    activeTenant, 
    isLoadingAuth, 
    isMembershipLoading,
    membershipStatus,
    membershipError,
    retryAuthResolution,
    isSupabaseAuth, 
    hasTenantMembership, 
    isAccountSuspended,
    availableTenants,
    authState,
    pendingConfirmationEmail,
    resendConfirmationEmail,
    clearEmailConfirmation,
    pendingConfirmationTenant,
    tenantConfirmationError,
    confirmPendingTenantAfterEmail,
    resendTenantConfirmationEmail,
    clearTenantEmailConfirmation,
    refreshSession,
    supabaseUser,
    signOut,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<string>('est-dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [wantsMerchantOnboarding, setWantsMerchantOnboarding] = useState(false);

  // Fecha automaticamente modal de login/conta após sucesso na autenticação
  // - Usuário novo: modal fecha para OnboardingCreateTenant assumir a tela principal
  // - Usuário existente: modal fecha para o Dashboard assumir a tela principal
  // - Confirmação de e-mail: modal fecha para exibir tela "Confirme seu e-mail"
  useEffect(() => {
    if (
      authState === 'AUTHENTICATED_WITHOUT_MEMBERSHIP' || 
      authState === 'AUTHENTICATED_WITH_MEMBERSHIP' ||
      authState === 'EMAIL_CONFIRMATION_REQUIRED' ||
      authState === 'EMAIL_CONFIRMATION_REQUIRED_FOR_TENANT'
    ) {
      setAuthModalOpen(false);
    }
  }, [authState]);

  // Sincroniza a aba padrão conforme o papel ativo
  useEffect(() => {
    if ((activeRole === 'CEO' || activeRole === 'SUPER_ADMIN') && !activeTab.startsWith('ceo-') && activeTab !== 'security-lab') {
      setActiveTab('ceo-dashboard');
    } else if (activeRole && activeRole !== 'CEO' && activeRole !== 'SUPER_ADMIN' && activeTab.startsWith('ceo-')) {
      setActiveTab('est-dashboard');
    }
  }, [activeRole, activeTab]);

  // Restaura navegação de retorno se o login com Google veio de uma loja pública (/app/:slug)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedReturnTo = sessionStorage.getItem('adegafood_auth_return_to');
      if (savedReturnTo && savedReturnTo.startsWith('/app/') && !window.location.pathname.startsWith('/app/')) {
        sessionStorage.removeItem('adegafood_auth_return_to');
        window.location.replace(savedReturnTo);
      }
    }
  }, []);

  // Rotas públicas ou dedicadas verificadas antes do gate administrativo
  const pathname = window.location.pathname;

  // 1. Catálogo Público PWA da Adega/Loja: /app/:slug
  if (pathname.startsWith('/app/')) {
    const slug = pathname.replace('/app/', '').split('/')[0];
    return <ClientApp forcedSlug={slug} />;
  }

  // 2. Rota para aplicativo do entregador: /entregador
  if (pathname === '/entregador' || activeRole === 'DRIVER') {
    return <DriverApp />;
  }

  // 3. Confirmação de E-mail Obrigatória (Comando 38: EMAIL_CONFIRMATION_REQUIRED)
  // Regra Estrita: NUNCA abrir Onboarding ou Dashboard antes da confirmação real de e-mail
  if (authState === 'EMAIL_CONFIRMATION_REQUIRED') {
    return (
      <>
        <EmailConfirmationScreen
          email={pendingConfirmationEmail || ''}
          onResend={() => resendConfirmationEmail(pendingConfirmationEmail || '')}
          onBackToLogin={() => {
            clearEmailConfirmation();
            setAuthModalOpen(true);
          }}
          onCheckSession={async () => {
            await retryAuthResolution();
          }}
        />
        <RoleTenantSwitcher 
          isOpen={authModalOpen} 
          onClose={() => setAuthModalOpen(false)} 
          onStartOnboarding={() => setAuthModalOpen(false)}
        />
      </>
    );
  }

  // 3b. Confirmação de E-mail Obrigatória do Primeiro Estabelecimento (Comando 42 & 43: Magic Link & AMR)
  // Rota oficial /confirmar-estabelecimento ou Estado EMAIL_CONFIRMATION_REQUIRED_FOR_TENANT
  // Regra Estrita: NUNCA abrir Dashboard antes da confirmação do primeiro estabelecimento
  if (pathname === '/confirmar-estabelecimento' || authState === 'EMAIL_CONFIRMATION_REQUIRED_FOR_TENANT') {
    return (
      <>
        <TenantEmailConfirmationScreen
          tenantName={pendingConfirmationTenant?.name || 'Seu Estabelecimento'}
          email={pendingConfirmationTenant?.email || pendingConfirmationEmail || currentUser?.email || ''}
          commercialEmail={pendingConfirmationTenant?.commercialEmail}
          tenantId={pendingConfirmationTenant?.id}
          initialError={tenantConfirmationError || undefined}
          onResend={() => resendTenantConfirmationEmail()}
          onCheckActivation={async () => {
            const res = await confirmPendingTenantAfterEmail();
            if (!res.success) {
              throw new Error(res.error || 'Ainda não identificamos a confirmação. Por favor, acesse o link enviado para seu e-mail.');
            }
            await refreshSession();
          }}
          onBackToAccount={() => {
            clearTenantEmailConfirmation();
            setAuthModalOpen(true);
          }}
        />
        <RoleTenantSwitcher 
          isOpen={authModalOpen} 
          onClose={() => setAuthModalOpen(false)} 
          onStartOnboarding={() => setAuthModalOpen(false)}
        />
      </>
    );
  }

  // 4. Estado de Carregamento da Sessão e Resolução de Permissões (AUTHENTICATING / AUTHENTICATED_RESOLVING_MEMBERSHIP)
  if (authState === 'AUTHENTICATING' || authState === 'AUTHENTICATED_RESOLVING_MEMBERSHIP') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-700 flex items-center justify-center text-white font-black text-xl shadow-md animate-pulse mb-4">
          AF
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-700" />
          <span>Carregando sua sessão e permissões...</span>
        </div>
        <p className="text-xs text-gray-400 mt-1 font-medium">AdegaFood SaaS</p>
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            onClick={() => {
              window.location.reload();
            }}
            className="text-xs text-emerald-700 hover:text-emerald-800 underline font-medium cursor-pointer"
          >
            Demorando para carregar? Recarregar página
          </button>
        </div>
      </div>
    );
  }

  // 4. Falha na Leitura dos Vínculos (CASO B: Erro de Rede ou RLS - NUNCA enviar para Onboarding)
  if (authState === 'AUTH_ERROR') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-amber-200 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-gray-950">Falha ao Conectar com o Estabelecimento</h2>
          <p className="text-xs text-gray-600 leading-relaxed">
            {membershipError || 'Não foi possível carregar as permissões do seu estabelecimento no momento. Verifique sua conexão e tente novamente.'}
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <Button 
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
              onClick={() => retryAuthResolution()}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Tentar Novamente
            </Button>
            <Button 
              variant="outline" 
              onClick={() => setAuthModalOpen(true)}
            >
              Minha Conta / Trocar Usuário
            </Button>
          </div>
        </div>
        <RoleTenantSwitcher 
          isOpen={authModalOpen} 
          onClose={() => setAuthModalOpen(false)} 
          onStartOnboarding={() => setAuthModalOpen(false)}
        />
      </div>
    );
  }

  // 5. Conta com Vínculo Suspenso
  if (isAccountSuspended) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-rose-200 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-gray-950">Acesso Administrativo Suspenso</h2>
          <p className="text-xs text-gray-600 leading-relaxed">
            O acesso deste estabelecimento está temporariamente indisponível. Para reativar, entre em contato com nosso suporte.
          </p>
          <div className="pt-2">
            <Button variant="outline" onClick={() => setAuthModalOpen(true)}>
              Minha Conta / Sair
            </Button>
          </div>
        </div>
        <RoleTenantSwitcher 
          isOpen={authModalOpen} 
          onClose={() => setAuthModalOpen(false)} 
          onStartOnboarding={() => setAuthModalOpen(false)}
        />
      </div>
    );
  }

  // 6. Usuário Não Autenticado (NOT_AUTHENTICATED) — Tela de Entrada Premium
  if (authState === 'NOT_AUTHENTICATED' || !isSupabaseAuth || !currentUser) {
    return (
      <div className="min-h-screen bg-slate-900/98 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(21,128,61,0.25),rgba(255,255,255,0))] flex flex-col items-center justify-center p-4 sm:p-6">
        {/* Card de Login Premium com abas integradas de Entrar e Criar Conta */}
        <LoginCard 
          onSuccess={() => {
            setAuthModalOpen(false);
          }} 
        />

        <RoleTenantSwitcher 
          isOpen={authModalOpen} 
          onClose={() => setAuthModalOpen(false)} 
          onStartOnboarding={() => setAuthModalOpen(false)}
        />
      </div>
    );
  }

  // 7. Usuário Autenticado sem Estabelecimento Vinculado (CASO 1: Novo Usuário / Onboarding em Tela Própria)
  // Regra Estrita Comando 70: Apenas usuários explicitamente cadastrados como clientes no checkout público são bloqueados na raiz
  if (authState === 'AUTHENTICATED_WITHOUT_MEMBERSHIP') {
    const isCustomerUser = supabaseUser?.user_metadata?.user_type === 'customer';
    if (isCustomerUser && !wantsMerchantOnboarding) {
      return (
        <div className="min-h-screen bg-slate-900/98 flex flex-col items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <ShoppingBag className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-gray-950">Conta de Cliente Conectada</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              Olá, <strong>{currentUser?.name || currentUser?.email}</strong>! Sua conta está conectada para realizar pedidos nas adegas e estabelecimentos parceiros.
            </p>
            <div className="p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl text-left text-xs text-emerald-950 space-y-1">
              <p className="font-bold">Como fazer seu pedido:</p>
              <p className="text-[11px] text-emerald-800">
                Acesse o catálogo da sua loja favorita pelo link direto ou QR Code (ex: <code>/app/nome-da-loja</code>) para navegar no cardápio e fazer seu pedido.
              </p>
            </div>
            <div className="pt-2 flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  await signOut();
                }}
                className="w-full text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
              >
                Sair da Conta
              </Button>
              <button
                onClick={() => setWantsMerchantOnboarding(true)}
                className="text-[11px] text-gray-400 hover:text-gray-600 underline pt-1 cursor-pointer"
              >
                É dono de adega ou restaurante? Cadastre seu estabelecimento aqui
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        <OnboardingCreateTenant onOpenAccountModal={() => setAuthModalOpen(true)} />
        <RoleTenantSwitcher 
          isOpen={authModalOpen} 
          onClose={() => setAuthModalOpen(false)} 
          onStartOnboarding={() => setAuthModalOpen(false)}
        />
      </>
    );
  }

  // 8. Usuário com Vínculo Ativo mas Estabelecimento em Carregamento de Dados (CASO 2 em transição)
  if (authState === 'AUTHENTICATED_WITH_MEMBERSHIP' && !activeTenant && activeRole !== 'CEO' && activeRole !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-700 flex items-center justify-center text-white font-black text-xl shadow-md animate-pulse mb-4">
          AF
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-700" />
          <span>Carregando dados do estabelecimento...</span>
        </div>
        <p className="text-xs text-gray-400 mt-1 font-medium">AdegaFood SaaS</p>
      </div>
    );
  }

  // 10. Área Administrativa Liberada (CEO ou Usuário com Vínculo Ativo)
  const renderMainView = () => {
    switch (activeTab) {
      // Security Lab (área estritamente técnica/CEO)
      case 'security-lab': {
        const isLabAllowed = (activeRole === 'CEO' || activeRole === 'SUPER_ADMIN') || import.meta.env.VITE_ENABLE_SECURITY_LAB === 'true';
        if (!isLabAllowed) {
          return <EstablishmentDashboard onNavigate={setActiveTab} />;
        }
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Segurança & Validação Anti-Hacker</h2>
              <p className="text-xs text-gray-500">
                Auditoria de isolamento multitenant, RLS (Row-Level Security) e matriz RBAC
              </p>
            </div>
            <TenantIsolationTester />
          </div>
        );
      }

      // CEO Views
      case 'ceo-dashboard':
        return <CeoDashboard onNavigate={setActiveTab} />;
      case 'ceo-tenants':
        return <CeoTenantsPage onNavigateToStore={() => setActiveTab('est-dashboard')} />;
      case 'ceo-sponsors':
        return <CeoSponsorsPage />;
      case 'ceo-finance':
        return <CeoFinancePage />;
      case 'ceo-audit':
        return <CeoAuditPage />;
      case 'ceo-support':
        return <CeoSupportPage onNavigateToStore={() => setActiveTab('est-dashboard')} />;

      // Establishment Views - 15 Official Items
      case 'est-dashboard':
        return <EstablishmentDashboard onNavigate={setActiveTab} />;
      case 'est-orders':
        return <OrdersPage />;
      case 'est-products':
        return <ProductsPage />;
      case 'est-categories':
        return <CategoriesPage />;
      case 'est-offers':
        return <OffersPage />;
      case 'est-customers':
        return <CustomersPage />;
      case 'est-marketing':
      case 'est-qrcodes':
        return <MarketingPage />;
      case 'est-theme':
        return <ThemePage />;
      case 'est-drivers':
        return <DriversPage />;
      case 'est-inventory':
        return <InventoryPage />;
      case 'est-finance':
        return <FinancePage />;
      case 'est-reports':
        return <ReportsPage />;
      case 'est-team':
        return <TeamPage />;
      case 'est-settings':
        return <SettingsPage />;

      default:
        return (activeRole === 'CEO' || activeRole === 'SUPER_ADMIN') 
          ? <CeoDashboard onNavigate={setActiveTab} /> 
          : <EstablishmentDashboard onNavigate={setActiveTab} />;
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col font-sans text-gray-900 overflow-hidden">
      {/* CEO Support Banner if active */}
      <CeoSupportBanner />

      {/* Global Header */}
      <Header
        activeNavTab={activeTab}
        onToggleSidebar={() => setMobileSidebarOpen(prev => !prev)}
      />

      {/* AppShell Global: Header Fixo + Menu Fixo à Esquerda + Conteúdo Flexível (COMANDO 131: 100% da altura da janela) */}
      <div className="flex-1 min-h-0 flex w-full max-w-none overflow-hidden">
        <Sidebar
          currentTab={activeTab}
          onSelectTab={setActiveTab}
          isOpenMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <main className={cn(
          "flex-1 min-w-0 h-full flex flex-col bg-slate-50/70",
          activeTab === 'est-orders' 
            ? "p-0 overflow-hidden" 
            : "p-1.5 sm:p-2 overflow-y-auto"
        )}>
          {renderMainView()}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}
