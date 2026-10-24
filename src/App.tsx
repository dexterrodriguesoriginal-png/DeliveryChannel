import { CallScreen } from './components/pickup/CallScreen';
import { ChegadaPage } from './components/pickup/ChegadaPage';
import { KitchenPage, KitchenPairPage } from './components/kitchen/KitchenPages';
import { KitchenSettingsPage } from './pages/establishment/KitchenSettingsPage';
import { chegadaCodeFromPath } from './lib/pickup/arrival';
import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { CeoSupportBanner } from './components/common/CeoSupportBanner';
import { TenantIsolationTester } from './components/common/TenantIsolationTester';
import { RoleTenantSwitcher } from './components/layout/RoleTenantSwitcher';
import { StoreContextBar } from './components/layout/StoreContextBar';
import { OnboardingCreateTenant } from './components/onboarding/OnboardingCreateTenant';
import { EmailConfirmationScreen } from './components/auth/EmailConfirmationScreen';
import { readLastStoreSlug } from './lib/auth/authRedirect';
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
import { PromotionsPage } from './pages/establishment/PromotionsPage';
import { CustomersPage } from './pages/establishment/CustomersPage';
import { MarketingPage } from './pages/establishment/MarketingPage';
import { ThemePage } from './pages/establishment/ThemePage';
import { DriversPage } from './pages/establishment/DriversPage';
import { InventoryPage } from './pages/establishment/InventoryPage';
import { FinancePage } from './pages/establishment/FinancePage';
import { ReportsPage } from './pages/establishment/ReportsPage';
import { TeamPage } from './pages/establishment/TeamPage';
import { SettingsPage } from './pages/establishment/SettingsPage';
import { ModulesPage } from './pages/establishment/ModulesPage';
import { SalonPage } from './pages/establishment/SalonPage';
import { useModules } from './hooks/useModules';
import { tabRequiredModule } from './lib/modules';
import { ModuleDisabledScreen } from './components/establishment/ModuleDisabledScreen';

// Mobile / Apps
import { ClientApp } from './pages/client/ClientApp';
import { DineInClientApp } from './pages/client/DineInClientApp';
import { DriverApp } from './pages/driver/DriverApp';
import { DriverStatusScreen } from './pages/driver/DriverStatusScreen';
import { DriverInvitePage } from './pages/driver/DriverInvitePage';
import { resolveDriverScreen } from './lib/membershipResolution';
import { inviteTokenFromPath } from './utils/inviteUrl';

// Icons & UI
import { ShieldAlert, Store, LogIn, Lock, RefreshCw, AlertTriangle, ShoppingBag } from 'lucide-react';
import { Button } from './components/ui/Button';
import { cn } from './utils/cn';
import { canAccessEstTab, getDefaultAllowedTab } from './lib/navPermissions';
import { isOwnerPanelTab } from './components/layout/ownerPanel';
import { isPanelPathname, panelRouteHash, readPanelRoute } from './lib/panelRoute';
import { isMarketingTab } from './lib/marketingTabs';

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
    driverApprovalStatus,
    pendingTenantName,
    switchTenant,
    enterPreviewWithoutLogin,
  } = useAuth();
  const { available: modulesAvailable, loading: modulesLoading, isModuleEnabled } = useModules();

  const [activeTab, setActiveTabState] = useState<string>(() => {
    const route = readPanelRoute(window.location.hash);
    return route && route.page !== 'driver' ? route.page : 'est-dashboard';
  });
  const [activeSubTab, setActiveSubTab] = useState<string>(() => (
    readPanelRoute(window.location.hash)?.tab || ''
  ));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [wantsMerchantOnboarding, setWantsMerchantOnboarding] = useState(false);

  const savePanelRoute = (page: string, tab?: string) => {
    if (!isPanelPathname(window.location.pathname)) return;
    const hash = panelRouteHash({ page, tab: tab || undefined });
    if (window.location.hash === hash) return;
    window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  };

  const setActiveTab = (page: string) => {
    setActiveTabState(page);
    setActiveSubTab('');
    savePanelRoute(page);
  };

  const setPanelSubTab = (tab: string) => {
    setActiveSubTab(tab);
    savePanelRoute(activeRole === 'DRIVER' ? 'driver' : activeTab, tab);
  };

  useEffect(() => {
    const syncPanelRoute = () => {
      if (!isPanelPathname(window.location.pathname)) return;
      const route = readPanelRoute(window.location.hash);
      if (route) {
        if (route.page !== 'driver') setActiveTabState(route.page);
        setActiveSubTab(route.tab || '');
        return;
      }
      if (window.location.hash === '' || window.location.hash === '#') {
        setActiveTabState(activeRole === 'CEO' || activeRole === 'SUPER_ADMIN' ? 'ceo-dashboard' : 'est-dashboard');
        setActiveSubTab('');
      }
    };
    window.addEventListener('popstate', syncPanelRoute);
    window.addEventListener('hashchange', syncPanelRoute);
    return () => {
      window.removeEventListener('popstate', syncPanelRoute);
      window.removeEventListener('hashchange', syncPanelRoute);
    };
  }, [activeRole]);

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

  useEffect(() => {
    if (activeRole === 'WAITER' && window.location.pathname === '/garcom') {
      setActiveTab('est-salon');
    }
  }, [activeRole]);

  // Restaura navegação de retorno se o login com Google veio de uma loja pública (/app/:slug)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedReturnTo = sessionStorage.getItem('adegafood_auth_return_to');
      if (savedReturnTo && (savedReturnTo.startsWith('/app/') || savedReturnTo.startsWith('/entregador/convite/') || savedReturnTo.startsWith('/chegada/')) && window.location.pathname !== savedReturnTo && !window.location.pathname.startsWith('/app/')) {
        sessionStorage.removeItem('adegafood_auth_return_to');
        window.location.replace(savedReturnTo);
      }
    }
  }, []);

  // Auto-recuperação do estado de carregamento do estabelecimento
  const [loadingTenantTimeout, setLoadingTenantTimeout] = useState(false);
  useEffect(() => {
    if (authState === 'AUTHENTICATED_WITH_MEMBERSHIP' && !activeTenant && activeRole !== 'CEO' && activeRole !== 'SUPER_ADMIN') {
      const timer = setTimeout(() => {
        setLoadingTenantTimeout(true);
        if (availableTenants.length > 0 && availableTenants[0]?.tenantId) {
          switchTenant(availableTenants[0].tenantId);
        } else if (enterPreviewWithoutLogin) {
          enterPreviewWithoutLogin();
        }
      }, 2500);
      return () => clearTimeout(timer);
    } else {
      setLoadingTenantTimeout(false);
    }
  }, [authState, activeTenant, activeRole, availableTenants, switchTenant, enterPreviewWithoutLogin]);

  // Rotas públicas ou dedicadas verificadas antes do gate administrativo
  const pathname = window.location.pathname;

  // QR Code da mesa: /mesa/:token
  const tableToken = pathname.match(/^\/mesa\/([^/]+)\/?$/)?.[1];
  if (tableToken) {
    return <DineInClientApp token={decodeURIComponent(tableToken)} />;
  }

  // 1. Catálogo Público PWA da Adega/Loja: /app/:slug
  if (pathname.startsWith('/app/')) {
    const slug = pathname.replace('/app/', '').split('/')[0];
    return <ClientApp forcedSlug={slug} />;
  }

  // 19/10: QR de chegada lido pela câmera comum: /chegada/<código>
  const chegadaCode = chegadaCodeFromPath(pathname);
  if (chegadaCode !== null) {
    return <ChegadaPage code={chegadaCode} />;
  }

  // 19/10: Tela da Cozinha. Pareamento do tablet (login anônimo próprio) e a tela em si.
  if (pathname === '/cozinha/parear') return <KitchenPairPage />;
  if (pathname === '/cozinha') return <KitchenPage />;

  // 2a. Convite público de entregador: /entregador/convite/:token (antes das demais regras de /entregador)
  const inviteToken = inviteTokenFromPath(pathname);
  if (inviteToken) {
    return <DriverInvitePage token={inviteToken} />;
  }

  // 2b. Vínculo PENDING/INACTIVE ou entregador não aprovado: tela neutra (nunca "criar estabelecimento")
  const driverScreen = resolveDriverScreen(membershipStatus, activeRole, driverApprovalStatus);
  if (driverScreen) {
    return (
      <DriverStatusScreen
        variant={driverScreen}
        storeName={pendingTenantName}
        userName={currentUser?.name}
        onRefresh={driverScreen === 'PENDING' || driverScreen === 'UNAVAILABLE' ? () => retryAuthResolution() : undefined}
        onSignOut={async () => { await signOut(); window.location.replace('/'); }}
      />
    );
  }

  // 2b'. Vínculo SUSPENDED (fluxo antigo) dentro de /entregador: tela neutra em vez de app vazio
  if (isAccountSuspended && pathname.startsWith('/entregador')) {
    return (
      <DriverStatusScreen
        variant="SUSPENDED"
        userName={currentUser?.name}
        onSignOut={async () => { await signOut(); window.location.replace('/'); }}
      />
    );
  }

  // 2c. Rota para aplicativo do entregador: /entregador
  // Fix PWA: só abre o app do entregador com papel DRIVER resolvido. Sem sessão (deep link/PWA
  // após logout) ou com outro papel, /entregador segue o fluxo normal (login/painel) em vez de tela branca.
  if (activeRole === 'DRIVER') {
    return <DriverApp activeTab={activeSubTab} onTabChange={setPanelSubTab} />;
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
        <p className="text-xs text-gray-400 mt-1 font-medium">Delivery Channel SaaS</p>
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

  // 19/10: tela de chamada (TV/tablet) da fila de retirada: /chamada, equipe logada da loja ativa.
  if (pathname === '/chamada' && activeTenant?.id && activeRole && ['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER'].includes(activeRole)) {
    return <CallScreen tenantId={activeTenant.id} storeName={activeTenant.name} />;
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
  if ((authState === 'NOT_AUTHENTICATED' || !isSupabaseAuth || !currentUser)) {
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
      // Link de confirmação pode cair na raiz (Site URL do Supabase): oferece voltar à última loja visitada.
      const lastStoreSlug = readLastStoreSlug(typeof window !== 'undefined' ? window.localStorage : null);
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
              {lastStoreSlug && (
                <Button
                  onClick={() => { window.location.assign(`/app/${encodeURIComponent(lastStoreSlug)}`); }}
                  className="w-full text-xs font-bold cursor-pointer"
                  data-testid="back-to-last-store"
                >
                  Voltar para a loja e continuar meu pedido
                </Button>
              )}
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
        <p className="text-xs text-gray-400 mt-1 font-medium">Delivery Channel SaaS</p>

        {loadingTenantTimeout && (
          <div className="mt-6 flex flex-col items-center gap-2 max-w-xs w-full text-center">
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5 w-full">
              O carregamento está demorando mais do que o esperado.
            </p>
            {availableTenants.length > 0 && availableTenants[0]?.tenantId && (
              <Button
                size="sm"
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                onClick={() => switchTenant(availableTenants[0].tenantId)}
              >
                Conectar a {availableTenants[0].tenantName || 'meu estabelecimento'}
              </Button>
            )}
            {enterPreviewWithoutLogin && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border-amber-300 cursor-pointer"
                onClick={() => enterPreviewWithoutLogin()}
              >
                Abrir Modo Visualização / Edição
              </Button>
            )}
            <button
              onClick={() => {
                try {
                  sessionStorage.removeItem('adegafood_dev_preview_bypass');
                } catch {
                  // ignore
                }
                signOut();
              }}
              className="text-[11px] text-gray-400 hover:text-gray-600 underline pt-1 cursor-pointer"
            >
              Voltar para o login
            </button>
          </div>
        )}
      </div>
    );
  }

  // 10. Área Administrativa Liberada (CEO ou Usuário com Vínculo Ativo)
  const renderMainView = () => {
    // Guard de UI por papel (RLS continua sendo a autorização real)
    const isCeoRole = activeRole === 'CEO' || activeRole === 'SUPER_ADMIN';
    if (!isCeoRole && activeTab === 'est-modules' && !modulesAvailable) {
      return <EstablishmentDashboard onNavigate={setActiveTab} />;
    }
    if (!isCeoRole && activeTab === 'est-modules' && activeRole !== 'OWNER' && activeRole !== 'MANAGER') {
      return <EstablishmentDashboard onNavigate={setActiveTab} />;
    }
    const requiredModule = tabRequiredModule(activeTab) || (
      (activeTab === 'est-marketing' || activeTab === 'est-qrcodes') && activeSubTab === 'pickup-qr'
        ? 'pickup'
        : undefined
    );
    if (!isCeoRole && requiredModule && !modulesLoading && !isModuleEnabled(requiredModule)) {
      return (
        <ModuleDisabledScreen
          moduleKey={requiredModule}
          canManageModules={modulesAvailable && (activeRole === 'OWNER' || activeRole === 'MANAGER')}
          onOpenModules={() => setActiveTab('est-modules')}
        />
      );
    }
    if (!isCeoRole && activeTab.startsWith('est-') && activeTab !== 'est-modules' && !canAccessEstTab(activeRole, activeTab)) {
      const fallback = getDefaultAllowedTab(activeRole);
      if (fallback === 'est-orders') return <OrdersPage activeTab={activeSubTab} onTabChange={setPanelSubTab} />;
      return <EstablishmentDashboard onNavigate={setActiveTab} />;
    }
    switch (activeTab) {
      // Security Lab (área estritamente técnica/CEO — nunca visível para dono em produção)
      case 'security-lab': {
        const isLabAllowed = activeRole === 'CEO' || activeRole === 'SUPER_ADMIN';
        if (!isLabAllowed) {
          const fallback = getDefaultAllowedTab(activeRole);
          if (fallback === 'est-orders') return <OrdersPage activeTab={activeSubTab} onTabChange={setPanelSubTab} />;
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
        return <OrdersPage activeTab={activeSubTab} onTabChange={setPanelSubTab} />;
      case 'est-salon':
        return <SalonPage />;
      case 'est-products':
        return <ProductsPage />;
      case 'est-categories':
        return <CategoriesPage />;
      case 'est-promotions':
      case 'est-offers':
        return <PromotionsPage />;
      case 'est-customers':
        return <CustomersPage />;
      case 'est-marketing':
      case 'est-qrcodes':
        return (
          <MarketingPage
            activeTab={isMarketingTab(activeSubTab) ? activeSubTab : null}
            onTabChange={setPanelSubTab}
          />
        );
      case 'est-theme':
        return <ThemePage />;
      case 'est-drivers':
        return <DriversPage onNavigate={setActiveTab} />;
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
      case 'est-modules':
        return <ModulesPage />;
      case 'est-kitchen':
        if (!isModuleEnabled('kds')) {
          const fallback = getDefaultAllowedTab(activeRole);
          if (fallback === 'est-orders') return <OrdersPage activeTab={activeSubTab} onTabChange={setPanelSubTab} />;
          return <EstablishmentDashboard onNavigate={setActiveTab} />;
        }
        return <KitchenSettingsPage />;

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

      {/* 19/10: loja atual bem visível + seletor com pedidos novos de cada loja */}
      <StoreContextBar />

      {/* AppShell Global: Header Fixo + Menu Fixo à Esquerda + Conteúdo Flexível (COMANDO 131: 100% da altura da janela) */}
      <div className="flex-1 min-h-0 flex w-full max-w-none overflow-hidden">
        <Sidebar
          currentTab={activeTab}
          onSelectTab={setActiveTab}
          isOpenMobile={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        {/* 19/10: painel do dono/equipe com fundo cinza claro para destacar os cartões brancos (CEO mantém o fundo atual) */}
        <main
          data-testid="admin-main"
          data-owner-panel={isOwnerPanelTab(activeTab) ? 'true' : undefined}
          className={cn(
          "flex-1 min-w-0 h-full flex flex-col",
          isOwnerPanelTab(activeTab) ? "bg-slate-100" : "bg-slate-50/70",
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
