import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { User as AppUser, RoleId, Tenant, TenantTheme, TenantSettings } from '../types';
import { SecurityContext } from '../services/securityEngine';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { User as SupabaseUser, Session as SupabaseSession } from '@supabase/supabase-js';
import { dataStore } from '../services/dataStore';
import { isValidUuid } from '../lib/uuid';

export interface TenantMembership {
  tenantId: string;
  roleId: RoleId;
  status: string;
  tenantName: string;
  tenantSlug: string;
  category?: string;
}

export interface GoogleAuthOptions {
  returnTo?: string;
  intent?: 'owner' | 'customer';
}

export type MembershipStatus = 
  | 'AUTH_LOADING'
  | 'UNAUTHENTICATED'
  | 'MEMBERSHIP_LOADING'
  | 'MEMBERSHIP_RESOLVED_WITH_DATA'
  | 'MEMBERSHIP_RESOLVED_EMPTY'
  | 'MEMBERSHIP_ERROR';

export type AuthState = 
  | 'NOT_AUTHENTICATED'
  | 'AUTHENTICATING'
  | 'EMAIL_CONFIRMATION_REQUIRED'
  | 'EMAIL_CONFIRMATION_REQUIRED_FOR_TENANT'
  | 'AUTHENTICATED_RESOLVING_MEMBERSHIP'
  | 'AUTHENTICATED_WITH_MEMBERSHIP'
  | 'AUTHENTICATED_WITHOUT_MEMBERSHIP'
  | 'AUTH_ERROR';

interface AuthContextType {
  currentUser: AppUser | null;
  activeRole: RoleId | null;
  activeTenant: Tenant | null;
  isCeoSupportMode: boolean;
  securityContext: SecurityContext;

  // Supabase Auth Real
  supabaseUser: SupabaseUser | null;
  supabaseSession: SupabaseSession | null;
  isSupabaseAuth: boolean;
  isLoadingAuth: boolean;
  isMembershipLoading: boolean;
  authError: string | null;

  // Estado unificado de autenticação e autorização
  authState: AuthState;
  pendingConfirmationEmail: string | null;
  resendConfirmationEmail: (email?: string) => Promise<{ success: boolean; error?: string }>;
  clearEmailConfirmation: () => void;

  // Confirmação de e-mail do primeiro estabelecimento (Comando 43: Magic Link & AMR)
  pendingConfirmationTenant: { id: string; name: string; slug: string; email?: string; commercialEmail?: string } | null;
  tenantConfirmationError: string | null;
  confirmPendingTenantAfterEmail: (tenantId?: string) => Promise<{ success: boolean; error?: string }>;
  confirmPendingTenantAfterVerifiedGoogle: () => Promise<{ success: boolean; error?: string }>;
  confirmTenantEmail: () => Promise<{ success: boolean; error?: string }>;
  resendTenantConfirmationEmail: () => Promise<{ success: boolean; error?: string }>;
  clearTenantEmailConfirmation: () => void;

  // Status de associação Multi-Tenant e Resolução
  membershipStatus: MembershipStatus;
  membershipError: string | null;
  retryAuthResolution: () => Promise<void>;

  hasTenantMembership: boolean;
  isAccountSuspended: boolean;
  availableTenants: TenantMembership[];
  switchTenant: (tenantId: string) => Promise<boolean>;

  // Métodos de autenticação
  signInWithPassword: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (email: string, password: string, name: string, phone?: string, metadata?: Record<string, any>) => Promise<{ success: boolean; requiresEmailConfirmation?: boolean; error?: string }>;
  signInWithGoogle: (options?: GoogleAuthOptions) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;

  // Onboarding do primeiro estabelecimento
  createFirstTenant: (data: {
    name: string;
    slug: string;
    document: string;
    phone: string;
    email: string;
    category: string;
    address: string;
    city: string;
    phoneWhatsApp: string;
  }) => Promise<{ success: boolean; requiresEmailConfirmation?: boolean; data?: any; error?: string }>;
  refreshSession: () => Promise<void>;

  // Modo CEO Support e gerenciamento
  enterCeoSupportMode: (tenant: Tenant) => void;
  exitCeoSupportMode: () => void;
  setActiveTenant: (tenant: Tenant | null) => void;
  logout: () => void;

  // Modo Demo (ativo EXCLUSIVAMENTE quando VITE_ENABLE_DEMO_MODE=true)
  isDemoModeEnabled: boolean;
  loginAsPersona?: (role: RoleId, tenantId?: string) => void;

  // Acesso Temporário de Desenvolvimento (Sem Login - Painel do Dono)
  isDevBypassed: boolean;
  bypassLoginAsOwner: () => Promise<void>;
  exitDevBypass: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const IS_DEMO_MODE = import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';

function mapDbTenant(row: any, settingsRow?: any, themeRow?: any): Tenant {
  const settings: TenantSettings = {
    isOpen: settingsRow?.is_open !== undefined ? Boolean(settingsRow.is_open) : true,
    minOrderValue: Number(settingsRow?.min_order_value ?? 0),
    deliveryFee: Number(settingsRow?.delivery_fee ?? 0),
    freeDeliveryThreshold: settingsRow?.free_delivery_threshold ? Number(settingsRow.free_delivery_threshold) : undefined,
    estimatedDeliveryTime: settingsRow?.estimated_delivery_time || '30-45 min',
    defaultPrepTimeMinutes: settingsRow?.default_prep_time_minutes !== undefined && settingsRow?.default_prep_time_minutes !== null
      ? Number(settingsRow.default_prep_time_minutes)
      : 30,
    address: settingsRow?.address || 'Endereço Comercial',
    city: settingsRow?.city || 'São Paulo',
    phoneWhatsApp: settingsRow?.phone_whatsapp || '',
    pixKey: settingsRow?.pix_key || undefined,
  };

  const theme: TenantTheme = {
    storeName: themeRow?.store_name || row.name,
    tagline: themeRow?.tagline || 'Delivery Express & Conveniência',
    logoUrl: themeRow?.logo_url || 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=200&h=200&fit=crop',
    bannerUrl: themeRow?.banner_url || 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&h=400&fit=crop',
    primaryColor: themeRow?.primary_color || '#15803d',
    secondaryColor: themeRow?.secondary_color || '#166534',
    backgroundColor: themeRow?.background_color || '#f8fafc',
    cardColor: themeRow?.card_color || '#ffffff',
    buttonColor: themeRow?.button_color || '#15803d',
    textColor: themeRow?.text_color || '#0f172a',
    borderRadius: themeRow?.border_radius || '1rem',
    fontFamily: themeRow?.font_family || 'Inter',
  };

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name || row.name,
    document: row.document || '',
    phone: row.phone || '',
    email: row.email || '',
    category: row.category || 'ADEGA',
    status: row.status || 'ACTIVE',
    planTier: row.plan_tier || 'STANDARD',
    createdAt: row.created_at,
    settings,
    theme,
    gmvMonthly: 0,
    activeOrdersToday: 0,
    totalCustomers: 0,
    isDemo: false,
  };
}

/**
 * Validação estrita de identidade Google verificada (Comando 86)
 * Considera válido apenas se o provedor for Google E o e-mail estiver confirmado na conta Supabase Auth.
 */
export const isGoogleVerifiedUser = (user: any): boolean => {
  if (!user) return false;
  const isGoogle = 
    user.app_metadata?.provider === 'google' ||
    (Array.isArray(user.app_metadata?.providers) && user.app_metadata.providers.includes('google')) ||
    (Array.isArray(user.identities) && user.identities.some((id: any) => id.provider === 'google'));
  return Boolean(isGoogle && user.email_confirmed_at);
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [activeRole, setActiveRole] = useState<RoleId | null>(null);
  const [activeTenant, setActiveTenantState] = useState<Tenant | null>(null);
  const [isCeoSupportMode, setIsCeoSupportMode] = useState<boolean>(false);

  // Acesso Temporário de Desenvolvimento (Bypass de login para dono)
  const [isDevBypassed, setIsDevBypassed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('adegafood_dev_bypass') === 'true';
    }
    return false;
  });

  // Supabase Auth Real
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [supabaseSession, setSupabaseSession] = useState<SupabaseSession | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);
  const [isMembershipLoading, setIsMembershipLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Controle estrito de Confirmação de E-mail (Supabase Auth Email Confirmation)
  const [isEmailConfirmationRequired, setIsEmailConfirmationRequired] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return Boolean(sessionStorage.getItem('adegafood_pending_confirmation_email'));
    }
    return false;
  });
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('adegafood_pending_confirmation_email');
    }
    return null;
  });

  const clearEmailConfirmation = useCallback(() => {
    setIsEmailConfirmationRequired(false);
    setPendingConfirmationEmail(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('adegafood_pending_confirmation_email');
    }
  }, []);

  // Controle estrito de Confirmação de E-mail do Primeiro Estabelecimento (Comando 42 & 86)
  const [isTenantConfirmationRequired, setIsTenantConfirmationRequired] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return Boolean(sessionStorage.getItem('adegafood_pending_tenant_id'));
    }
    return false;
  });
  const [pendingConfirmationTenant, setPendingConfirmationTenant] = useState<{ id: string; name: string; slug: string; email?: string; commercialEmail?: string } | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('adegafood_pending_tenant_info');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return null;
        }
      }
    }
    return null;
  });
  const [tenantConfirmationError, setTenantConfirmationError] = useState<string | null>(null);

  const clearTenantEmailConfirmation = useCallback(() => {
    setIsTenantConfirmationRequired(false);
    setPendingConfirmationTenant(null);
    setTenantConfirmationError(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('adegafood_pending_tenant_id');
      sessionStorage.removeItem('adegafood_pending_tenant_info');
    }
  }, []);

  // Controle de concorrência e identificador sequencial de resolução
  const authResolutionIdRef = useRef<number>(0);
  const currentResolvedUserIdRef = useRef<string | null>(null);

  // Estados Multi-Tenant estritos e Resolução Conceitual
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus>('AUTH_LOADING');
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [availableTenants, setAvailableTenants] = useState<TenantMembership[]>([]);
  const [hasTenantMembership, setHasTenantMembership] = useState<boolean>(false);
  const [isAccountSuspended, setIsAccountSuspended] = useState<boolean>(false);

  // Carrega os dados reais do Tenant do banco a partir do tenant_id de forma tolerante a falhas
  const fetchTenantData = useCallback(async (tenantId: string): Promise<Tenant | null> => {
    if (!isValidUuid(tenantId)) {
      return dataStore.getTenantById({ userId: 'dev-owner-bypass', userRole: 'OWNER', userName: 'Dev' }, tenantId) || dataStore.getTenantBySlug(tenantId) || null;
    }

    try {
      const { data: tenantRow, error: tErr } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .maybeSingle();

      if (tErr || !tenantRow) {
        console.warn('[AuthContext] Erro ao carregar dados do tenant no Supabase:', tErr?.message);
        return null;
      }

      const { data: settingsRow } = await supabase
        .from('tenant_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      const { data: themeRow } = await supabase
        .from('tenant_themes')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return mapDbTenant(tenantRow, settingsRow, themeRow);
    } catch (err) {
      console.warn('[AuthContext] Erro ao carregar dados do tenant no Supabase:', err);
    }
    return null;
  }, []);

  // Resolve os vínculos em tenant_users sem qualquer fallback arbitrário para OWNER
  const resolveSupabaseProfile = useCallback(async (sbUser: SupabaseUser) => {
    const resolutionId = ++authResolutionIdRef.current;
    const sessionUserId = sbUser.id;
    const sessionEmail = sbUser.email || '';

    try {
      setIsAccountSuspended(false);
      setMembershipStatus('MEMBERSHIP_LOADING');
      setMembershipError(null);

      // 1. Busca perfil do usuário em public.users (garante consistência de nome/avatar/telefone)
      let userName = sbUser.user_metadata?.name || sbUser.user_metadata?.full_name || sessionEmail.split('@')[0] || 'Usuário';
      let userAvatar = sbUser.user_metadata?.avatar_url;
      let userPhone = sbUser.user_metadata?.phone;
      let publicUserId: string | null = null;

      try {
        const { data: userProfile, error: uErr } = await supabase
          .from('users')
          .select('id, name, avatar_url, phone')
          .eq('id', sessionUserId)
          .maybeSingle();

        if (uErr) {
          console.warn('[AUTH DEBUG] users profile query warning:', uErr.message);
        }

        if (userProfile) {
          publicUserId = userProfile.id;
          if (userProfile.name) userName = userProfile.name;
          if (userProfile.avatar_url) userAvatar = userProfile.avatar_url;
          if (userProfile.phone) userPhone = userProfile.phone;
        }
      } catch {
        try {
          const { data: userProfile } = await supabase
            .from('users')
            .select('id, name, avatar_url')
            .eq('id', sessionUserId)
            .maybeSingle();

          if (userProfile) {
            publicUserId = userProfile.id;
            if (userProfile.name) userName = userProfile.name;
            if (userProfile.avatar_url) userAvatar = userProfile.avatar_url;
          }
        } catch (e) {
          console.warn('[AUTH DEBUG] Aviso ao buscar perfil de public.users:', e);
        }
      }

      if (resolutionId !== authResolutionIdRef.current) return;

      // 2. Consulta TODOS os vínculos na tabela public.tenant_users (Zero-Trust)
      let membershipsData: { id?: string; role_id: string; tenant_id: string; status: string }[] = [];
      let membershipQueryError: any = null;

      try {
        const res = await supabase
          .from('tenant_users')
          .select('id, role_id, tenant_id, status')
          .eq('user_id', sessionUserId);

        membershipsData = (res.data || []) as any;
        membershipQueryError = res.error;
      } catch (err: any) {
        membershipQueryError = err;
      }

      // Se houve erro ou retorno vazio imediatamente pós-OAuth, realiza uma segunda tentativa com breve delay
      if (membershipQueryError || membershipsData.length === 0) {
        await new Promise(r => setTimeout(r, 250));
        if (resolutionId !== authResolutionIdRef.current) return;
        try {
          const retryRes = await supabase
            .from('tenant_users')
            .select('id, role_id, tenant_id, status')
            .eq('user_id', sessionUserId);
          if (retryRes.error) {
            membershipQueryError = retryRes.error;
            console.error('[AUTH DEBUG] tenant_users query error (retry):', retryRes.error);
          } else {
            membershipsData = (retryRes.data || []) as any;
            membershipQueryError = null;
          }
        } catch (retryErr) {
          console.warn('[AUTH DEBUG] Segunda tentativa de leitura de tenant_users:', retryErr);
        }
      }

      if (resolutionId !== authResolutionIdRef.current) return;

      // Se a query falhou com erro (CASO B), NUNCA transformar em "usuário sem estabelecimento"
      if (membershipQueryError) {
        console.error('[AUTH DEBUG] tenant_users query error:', membershipQueryError);
        console.log('[AUTH DEBUG]', {
          sessionUserId,
          sessionEmail,
          publicUserId,
          membershipQueryError: membershipQueryError.message || membershipQueryError,
          membershipRows: 0,
          activeMemberships: 0,
          hasTenantMembership: false,
          activeTenantId: null,
          activeRole: null,
          isLoadingAuth: false,
          isMembershipLoading: false,
        });

        setMembershipStatus('MEMBERSHIP_ERROR');
        setMembershipError(membershipQueryError.message || 'Erro ao carregar permissões do estabelecimento.');
        setHasTenantMembership(false);
        return;
      }

      const allMemberships = (membershipsData || []) as { id?: string; role_id: string; tenant_id: string; status: string }[];
      const activeMemberships = allMemberships.filter(m => m.status === 'ACTIVE');
      const suspendedMemberships = allMemberships.filter(m => m.status === 'SUSPENDED');

      // CASO A: Query executou com sucesso e retornou vazia
      if (allMemberships.length === 0) {
        console.log('[AUTH DEBUG]', {
          sessionUserId,
          sessionEmail,
          publicUserId,
          membershipQueryError: null,
          membershipRows: 0,
          activeMemberships: 0,
          hasTenantMembership: false,
          activeTenantId: null,
          activeRole: null,
          isLoadingAuth: false,
          isMembershipLoading: false,
        });

        setIsAccountSuspended(false);
        setHasTenantMembership(false);
        setActiveRole(null);
        setActiveTenantState(null);
        setAvailableTenants([]);
        setMembershipStatus('MEMBERSHIP_RESOLVED_EMPTY');
        setCurrentUser({
          id: sessionUserId,
          name: userName,
          email: sessionEmail,
          phone: userPhone,
          role: (sbUser.user_metadata?.user_type === 'customer' ? 'CUSTOMER' : null),
          avatar: userAvatar,
        });
        currentResolvedUserIdRef.current = sessionUserId;
        return;
      }

      // Vínculo suspenso e nenhum ativo
      if (activeMemberships.length === 0 && suspendedMemberships.length > 0) {
        console.log('[AUTH DEBUG]', {
          sessionUserId,
          sessionEmail,
          publicUserId,
          membershipQueryError: null,
          membershipRows: allMemberships.length,
          activeMemberships: 0,
          hasTenantMembership: false,
          activeTenantId: null,
          activeRole: null,
          isLoadingAuth: false,
          isMembershipLoading: false,
        });

        setIsAccountSuspended(true);
        setHasTenantMembership(false);
        setActiveRole(null);
        setActiveTenantState(null);
        setAvailableTenants([]);
        setMembershipStatus('MEMBERSHIP_RESOLVED_EMPTY');
        setCurrentUser({
          id: sessionUserId,
          name: userName,
          email: sessionEmail,
          phone: userPhone,
          role: null,
          avatar: userAvatar,
        });
        currentResolvedUserIdRef.current = sessionUserId;
        return;
      }

      // Sem vínculos ativos
      if (activeMemberships.length === 0) {
        console.log('[AUTH DEBUG]', {
          sessionUserId,
          sessionEmail,
          publicUserId,
          membershipQueryError: null,
          membershipRows: allMemberships.length,
          activeMemberships: 0,
          hasTenantMembership: false,
          activeTenantId: null,
          activeRole: null,
          isLoadingAuth: false,
          isMembershipLoading: false,
        });

        setIsAccountSuspended(false);
        setHasTenantMembership(false);
        setActiveRole(null);
        setActiveTenantState(null);
        setAvailableTenants([]);
        setMembershipStatus('MEMBERSHIP_RESOLVED_EMPTY');
        setCurrentUser({
          id: sessionUserId,
          name: userName,
          email: sessionEmail,
          phone: userPhone,
          role: (sbUser.user_metadata?.user_type === 'customer' ? 'CUSTOMER' : null),
          avatar: userAvatar,
        });
        currentResolvedUserIdRef.current = sessionUserId;
        return;
      }

      // Caso 1: Usuário é CEO ou SUPER_ADMIN (vínculo global ou role específica)
      const ceoMembership = activeMemberships.find(m => m.role_id === 'CEO' || m.role_id === 'SUPER_ADMIN');
      if (ceoMembership) {
        console.log('[AUTH DEBUG]', {
          sessionUserId,
          sessionEmail,
          publicUserId,
          membershipQueryError: null,
          membershipRows: allMemberships.length,
          activeMemberships: activeMemberships.length,
          hasTenantMembership: true,
          activeTenantId: null,
          activeRole: ceoMembership.role_id,
          isLoadingAuth: false,
          isMembershipLoading: false,
        });

        setIsAccountSuspended(false);
        setHasTenantMembership(true);
        setMembershipStatus('MEMBERSHIP_RESOLVED_WITH_DATA');
        setActiveRole(ceoMembership.role_id as RoleId);
        setActiveTenantState(null);
        setAvailableTenants([]);
        setCurrentUser({
          id: sessionUserId,
          name: userName,
          email: sessionEmail,
          phone: userPhone,
          role: ceoMembership.role_id as RoleId,
          avatar: userAvatar,
        });
        currentResolvedUserIdRef.current = sessionUserId;
        return;
      }

      // Caso 2: Usuário possui vínculos ativos (OWNER, MANAGER, DRIVER, etc.)
      setIsAccountSuspended(false);
      setHasTenantMembership(true);
      setMembershipStatus('MEMBERSHIP_RESOLVED_WITH_DATA');

      const tenantIds = activeMemberships.map(m => m.tenant_id).filter(Boolean);
      const tenantDetailsMap: Record<string, { id: string; name: string; slug: string; category?: string; status?: string; email?: string }> = {};

      if (tenantIds.length > 0) {
        try {
          const { data: tenantRows, error: tRowsErr } = await supabase
            .from('tenants')
            .select('id, name, slug, category, status, email')
            .in('id', tenantIds);

          if (tRowsErr) {
            console.warn('[AUTH DEBUG] Aviso na busca de estabelecimentos:', tRowsErr.message);
          }
          if (tenantRows) {
            tenantRows.forEach(t => {
              tenantDetailsMap[t.id] = t;
            });
          }
        } catch (tErr) {
          console.warn('[AUTH DEBUG] Aviso ao buscar dados dos estabelecimentos:', tErr);
        }
      }

      if (resolutionId !== authResolutionIdRef.current) return;

      // Validação de Estabelecimento Pendente de Confirmação (Comando 42)
      // Se todos os estabelecimentos do usuário estiverem com status PENDING,
      // bloqueia Dashboard, Pedidos, Produtos, etc., e exige confirmação de e-mail.
      const allTenantObjects = Object.values(tenantDetailsMap) as any[];
      const activeTenantsList = allTenantObjects.filter(t => t.status === 'ACTIVE');
      const pendingTenantsList = allTenantObjects.filter(t => t.status === 'PENDING');

      if (activeTenantsList.length === 0 && pendingTenantsList.length > 0) {
        const pendingT = pendingTenantsList[0];
        console.log('[AUTH DEBUG] Estabelecimento aguardando confirmação de e-mail:', pendingT);

        // AUTO-RECOVERY PARA GOOGLE OAUTH (Comando 86):
        // Se a conta for Google verificada, ativa o tenant pendente via RPC segura
        if (isGoogleVerifiedUser(sbUser)) {
          try {
            console.log('[AUTH DEBUG] Usuário Google verificado com tenant PENDING. Executando auto-ativação segura...');
            const { data: googleActiveData, error: googleActiveErr } = await supabase.rpc('confirm_pending_tenant_after_verified_google');
            if (!googleActiveErr && googleActiveData?.success) {
              console.log('[AUTH DEBUG] Tenant ativado com sucesso via Google verificado:', googleActiveData);
              clearTenantEmailConfirmation();

              // Recarrega os dados do tenant ativado
              const { data: updatedTenants } = await supabase
                .from('tenants')
                .select('id, name, slug, category, status, email')
                .in('id', tenantIds);

              if (updatedTenants && updatedTenants.some(t => t.status === 'ACTIVE')) {
                updatedTenants.forEach(t => {
                  tenantDetailsMap[t.id] = t;
                });
                activeTenantsList.push(...updatedTenants.filter(t => t.status === 'ACTIVE'));
                pendingTenantsList.length = 0;
              }
            } else {
              console.warn('[AUTH DEBUG] Falha na auto-ativação Google:', googleActiveErr?.message);
            }
          } catch (gErr) {
            console.warn('[AUTH DEBUG] Exceção na auto-ativação Google:', gErr);
          }
        }

        // Se ainda não houver estabelecimentos ativos (ex: e-mail/senha pendente de Magic Link)
        if (activeTenantsList.length === 0) {
          setIsAccountSuspended(false);
          setHasTenantMembership(false);
          setActiveRole(null);
          setActiveTenantState(null);
          setAvailableTenants([]);
          setIsTenantConfirmationRequired(true);
          const authAccountEmail = sessionEmail.trim().toLowerCase();
          const pendingTenantInfo = {
            id: pendingT.id,
            name: pendingT.name,
            slug: pendingT.slug,
            email: authAccountEmail,
            commercialEmail: pendingT.email,
          };
          setPendingConfirmationTenant(pendingTenantInfo);
          setPendingConfirmationEmail(authAccountEmail);
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('adegafood_pending_tenant_id', pendingT.id);
            sessionStorage.setItem('adegafood_pending_tenant_info', JSON.stringify(pendingTenantInfo));
          }
          setMembershipStatus('MEMBERSHIP_RESOLVED_EMPTY');
          setCurrentUser({
            id: sessionUserId,
            name: userName,
            email: sessionEmail,
            phone: userPhone,
            role: null,
            avatar: userAvatar,
          });
          currentResolvedUserIdRef.current = sessionUserId;
          return;
        }
      }

      // Se houver estabelecimentos ativos, limpa qualquer pendência anterior
      if (activeTenantsList.length > 0) {
        clearTenantEmailConfirmation();
      }

      // Mapeia os vínculos ativos
      const confirmedActiveMemberships = activeMemberships.filter(
        m => !tenantDetailsMap[m.tenant_id] || tenantDetailsMap[m.tenant_id].status === 'ACTIVE'
      );

      const mappedActiveTenants: TenantMembership[] = confirmedActiveMemberships.map(m => ({
        tenantId: m.tenant_id,
        roleId: m.role_id as RoleId,
        status: m.status,
        tenantName: tenantDetailsMap[m.tenant_id]?.name || '',
        tenantSlug: tenantDetailsMap[m.tenant_id]?.slug || '',
        category: tenantDetailsMap[m.tenant_id]?.category || 'Comércio',
      }));

      // Seleção do tenant preferencial
      let preferredMembership = mappedActiveTenants[0];
      if (mappedActiveTenants.length > 1) {
        const savedTenantPref = localStorage.getItem(`adegafood_pref_tenant_${sessionUserId}`);
        const found = mappedActiveTenants.find(t => t.tenantId === savedTenantPref);
        if (found) preferredMembership = found;
      }

      let chosenTenant = await fetchTenantData(preferredMembership.tenantId);

      if (resolutionId !== authResolutionIdRef.current) return;

      // Se fetchTenantData falhou, tenta resolver os dados a partir de tenantDetailsMap
      if (!chosenTenant) {
        const tInfo = tenantDetailsMap[preferredMembership.tenantId];
        const realSlug = tInfo?.slug?.trim().toLowerCase() || preferredMembership.tenantSlug?.trim().toLowerCase();
        const realName = tInfo?.name?.trim() || preferredMembership.tenantName?.trim();

        // REGRA ESTREITA COMANDO 72: Se o slug real não puder ser recuperado,
        // NUNCA fabricar 'estabelecimento', 'meu-estabelecimento' ou qualquer valor falso.
        // Lançar erro explícito de carregamento para retry transparente.
        if (!realSlug || realSlug === 'estabelecimento' || realSlug === 'seu-negocio') {
          console.error('[AuthContext] Falha ao carregar o slug real do estabelecimento:', preferredMembership.tenantId);
          setMembershipStatus('MEMBERSHIP_ERROR');
          setMembershipError('Não foi possível carregar as informações do seu estabelecimento no momento. Verifique sua conexão e tente novamente.');
          return;
        }

        chosenTenant = {
          id: preferredMembership.tenantId,
          name: realName || 'Estabelecimento Comercial',
          slug: realSlug,
          legalName: realName || 'Estabelecimento Comercial',
          document: '',
          phone: userPhone || '',
          email: sessionEmail,
          category: (tInfo?.category as Tenant['category']) || 'ADEGA',
          status: 'ACTIVE',
          planTier: 'STANDARD',
          createdAt: new Date().toISOString(),
          settings: {
            isOpen: true,
            minOrderValue: 0,
            deliveryFee: 0,
            estimatedDeliveryTime: '30-45 min',
            defaultPrepTimeMinutes: 30,
            address: 'Endereço Comercial',
            city: 'São Paulo',
            phoneWhatsApp: '',
          },
          theme: {
            storeName: realName || 'Estabelecimento Comercial',
            tagline: 'Delivery Express',
            logoUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=200&h=200&fit=crop',
            bannerUrl: 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&h=400&fit=crop',
            primaryColor: '#15803d',
            secondaryColor: '#166534',
            backgroundColor: '#f8fafc',
            cardColor: '#ffffff',
            buttonColor: '#15803d',
            textColor: '#0f172a',
            borderRadius: '1rem',
            fontFamily: 'Inter',
          },
          gmvMonthly: 0,
          activeOrdersToday: 0,
          totalCustomers: 0,
          isDemo: false,
        };
      }

      setAvailableTenants(mappedActiveTenants);
      setHasTenantMembership(true);
      setActiveRole(preferredMembership.roleId);
      setActiveTenantState(chosenTenant);

      setCurrentUser({
        id: sessionUserId,
        name: userName,
        email: sessionEmail,
        phone: userPhone,
        role: preferredMembership.roleId,
        tenantId: preferredMembership.tenantId,
        avatar: userAvatar,
      });

      console.log('[AUTH DEBUG]', {
        sessionUserId,
        sessionEmail,
        publicUserId,
        membershipQueryError: null,
        membershipRows: allMemberships.length,
        activeMemberships: activeMemberships.length,
        hasTenantMembership: true,
        activeTenantId: chosenTenant.id,
        activeRole: preferredMembership.roleId,
        isLoadingAuth: false,
        isMembershipLoading: false,
      });

      currentResolvedUserIdRef.current = sessionUserId;

    } catch (err: any) {
      console.error('[AUTH DEBUG] Exceção ao resolver perfil no banco:', err);
      setMembershipStatus('MEMBERSHIP_ERROR');
      setMembershipError(err?.message || 'Falha ao resolver perfil de usuário.');
    }
  }, [fetchTenantData]);

  // Função para retentar a resolução de permissões e membership
  const retryAuthResolution = useCallback(async () => {
    if (supabaseUser) {
      setIsMembershipLoading(true);
      setMembershipStatus('MEMBERSHIP_LOADING');
      setMembershipError(null);
      try {
        await resolveSupabaseProfile(supabaseUser);
      } finally {
        setIsMembershipLoading(false);
      }
    }
  }, [supabaseUser, resolveSupabaseProfile]);

  // Função estrita de troca de tenant: valida contra vínculos ativos reais do banco
  const switchTenant = useCallback(async (targetTenantId: string): Promise<boolean> => {
    const validMembership = availableTenants.find(t => t.tenantId === targetTenantId);
    if (!validMembership) {
      console.error('[AuthContext] Tentativa não autorizada de switchTenant para ID não associado:', targetTenantId);
      return false;
    }

    const tenantData = await fetchTenantData(validMembership.tenantId);
    if (!tenantData) {
      console.error('[AuthContext] Erro ao carregar dados do tenant associado:', targetTenantId);
      return false;
    }

    setActiveRole(validMembership.roleId);
    setActiveTenantState(tenantData);

    if (supabaseUser) {
      localStorage.setItem(`adegafood_pref_tenant_${supabaseUser.id}`, validMembership.tenantId);
      setCurrentUser(prev => prev ? {
        ...prev,
        role: validMembership.roleId,
        tenantId: validMembership.tenantId,
      } : null);
    }

    return true;
  }, [availableTenants, fetchTenantData, supabaseUser]);

  // Inicializa Sessão do Supabase e Registra Listener de Mudança de Auth com sincronização estrita
  useEffect(() => {
    let mounted = true;

    async function handleAuthChange(sbSession: SupabaseSession | null, source: string) {
      if (!mounted) return;
      console.log(`[AuthContext] Processando autenticação (${source}):`, sbSession?.user?.email);

      if (!sbSession?.user) {
        currentResolvedUserIdRef.current = null;
        if (source === 'SIGNED_OUT') {
          clearEmailConfirmation();
        }
        setSupabaseSession(null);
        setSupabaseUser(null);
        setCurrentUser(null);
        setActiveRole(null);
        setActiveTenantState(null);
        setAvailableTenants([]);
        setHasTenantMembership(false);
        setIsAccountSuspended(false);
        setIsMembershipLoading(false);
        setIsLoadingAuth(false);
        setMembershipStatus('UNAUTHENTICATED');
        return;
      }

      const incomingUserId = sbSession.user.id;
      const knownUserId = currentResolvedUserIdRef.current;

      // TRATAMENTO SILENCIOSO DE TOKEN_REFRESHED E SIGNED_IN REPETIDO (MESMO USUÁRIO JÁ ATIVO):
      // Quando o Supabase emite TOKEN_REFRESHED ou SIGNED_IN (por exemplo, ao reativar foco/visibilidade da aba
      // via _recoverAndRefresh()), se o usuário autenticado já for o mesmo que já teve seus vínculos resolvidos:
      // - Atualiza a sessão e o usuário silenciosamente em memória
      // - NÃO ativa telas de loading globais (setIsMembershipLoading/setIsLoadingAuth)
      // - NÃO chama resolveSupabaseProfile()
      // - NÃO desmonta páginas nem fecha formulários abertos
      if (incomingUserId && knownUserId && incomingUserId === knownUserId && source !== 'SIGNED_OUT') {
        console.log(`[AuthContext] ${source} silencioso — mesmo usuário (${sbSession.user.email}). Preservando estado.`);
        setSupabaseSession(sbSession);
        setSupabaseUser(sbSession.user);
        return;
      }

      // Sessão autenticada presente: limpa pendência de confirmação e ativa estados de loading enquanto resolve
      clearEmailConfirmation();
      setSupabaseSession(sbSession);
      setSupabaseUser(sbSession.user);
      setIsMembershipLoading(true);
      setIsLoadingAuth(true);

      // Garante que currentUser já tenha dados preliminares da sessão para evitar null inesperado
      const initialName = sbSession.user.user_metadata?.name || 
                          sbSession.user.user_metadata?.full_name || 
                          sbSession.user.email?.split('@')[0] || 
                          'Usuário';
      setCurrentUser(prev => prev || {
        id: sbSession.user.id,
        name: initialName,
        email: sbSession.user.email || '',
        phone: sbSession.user.user_metadata?.phone,
        role: (sbSession.user.user_metadata?.user_type === 'customer' ? 'CUSTOMER' : null),
        avatar: sbSession.user.user_metadata?.avatar_url,
      });

      try {
        await resolveSupabaseProfile(sbSession.user);
        currentResolvedUserIdRef.current = sbSession.user.id;
      } catch (err) {
        console.error('[AuthContext] Falha na resolução de perfil:', err);
      } finally {
        if (mounted) {
          setIsMembershipLoading(false);
          setIsLoadingAuth(false);
        }
      }
    }

    if (!isSupabaseConfigured) {
      setIsLoadingAuth(false);
      setIsMembershipLoading(false);
      setMembershipStatus('UNAUTHENTICATED');
      return;
    }

    // Safety timeout: impede que a interface fique travada indefinidamente se o Supabase demorar
    const safetyTimeout = setTimeout(() => {
      if (mounted) {
        setIsLoadingAuth(false);
        setIsMembershipLoading(false);
        setMembershipStatus((status) => {
          if (status === 'AUTH_LOADING') {
            return supabaseUser ? 'MEMBERSHIP_ERROR' : 'UNAUTHENTICATED';
          }
          if (status === 'MEMBERSHIP_LOADING') {
            return 'MEMBERSHIP_ERROR';
          }
          return status;
        });
      }
    }, 4500);

    // 1. Obtém sessão inicial
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        console.warn('[AuthContext] Erro getSession:', error.message);
      }
      if (data?.session?.user) {
        handleAuthChange(data.session, 'getSession');
      } else {
        // Se a URL contiver hash de OAuth (#access_token=...), NÃO finaliza o loading ainda,
        // pois o onAuthStateChange do Supabase irá processar o token em alguns milissegundos
        const isOAuthRedirect = typeof window !== 'undefined' && (
          window.location.hash.includes('access_token=') || 
          window.location.search.includes('code=')
        );

        if (!isOAuthRedirect) {
          setIsLoadingAuth(false);
          setIsMembershipLoading(false);
          setMembershipStatus('UNAUTHENTICATED');
        }
      }
    }).catch(err => {
      console.warn('[AuthContext] Falha ao verificar getSession:', err);
      if (mounted) {
        setIsLoadingAuth(false);
        setIsMembershipLoading(false);
        setMembershipStatus('UNAUTHENTICATED');
      }
    });

    // 2. Listener de eventos de autenticação
    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        console.log(`[Supabase Auth Event] ${event}`, session?.user?.email);

        if (event === 'SIGNED_OUT') {
          currentResolvedUserIdRef.current = null;
          handleAuthChange(null, 'SIGNED_OUT');
        } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
          const incomingUserId = session?.user?.id;
          const knownUserId = currentResolvedUserIdRef.current;

          // Se for o mesmo usuário já autenticado e resolvido, atualização 100% silenciosa (preserva UI)
          if (incomingUserId && knownUserId && incomingUserId === knownUserId) {
            console.log(`[Supabase Auth Event] ${event} silencioso para usuário já ativo (${session?.user?.email}): preservando páginas e formulários.`);
            setSupabaseSession(session);
            if (session?.user) {
              setSupabaseUser(session.user);
            }
            return;
          }
          if (session?.user) {
            handleAuthChange(session, event);
          }
        } else if (session?.user) {
          handleAuthChange(session, event);
        } else if (event === 'INITIAL_SESSION' && !session) {
          const isOAuthRedirect = typeof window !== 'undefined' && (
            window.location.hash.includes('access_token=') || 
            window.location.search.includes('code=')
          );
          if (!isOAuthRedirect) {
            setIsLoadingAuth(false);
            setIsMembershipLoading(false);
            setMembershipStatus('UNAUTHENTICATED');
          }
        }
      }
    );

    return () => {
      mounted = false;
      clearTimeout(safetyTimeout);
      authSubscription.subscription.unsubscribe();
    };
  }, [resolveSupabaseProfile]);

  // Login com Email e Senha no Supabase
  const signInWithPassword = async (email: string, password: string) => {
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        let friendlyMessage = error.message;
        if (error.message.includes('Invalid login credentials')) {
          friendlyMessage = 'E-mail ou senha incorretos. Por favor, verifique seus dados.';
        } else if (error.message.toLowerCase().includes('email not confirmed')) {
          friendlyMessage = 'Seu e-mail ainda não foi confirmado. Por favor, acesse o link de confirmação enviado para sua caixa de entrada.';
        }
        setAuthError(friendlyMessage);
        return { success: false, error: friendlyMessage };
      }

      if (data.user) {
        setSupabaseUser(data.user);
        setSupabaseSession(data.session);
        await resolveSupabaseProfile(data.user);
      }
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Erro ao realizar login. Tente novamente.';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  };

  // Cadastro de Novo Usuário no Supabase com suporte a Confirmação Real de E-mail
  const signUp = async (
    email: string,
    password: string,
    name: string,
    phone?: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; requiresEmailConfirmation?: boolean; error?: string }> => {
    setAuthError(null);
    try {
      const cleanEmail = email.trim();
      const cleanPhone = phone ? phone.trim() : undefined;
      const redirectUrl = typeof window !== 'undefined' && window.location.origin.includes('adegafood.ai.studio')
        ? 'https://adegafood.ai.studio'
        : (typeof window !== 'undefined' ? window.location.origin : 'https://adegafood.ai.studio');

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            name,
            full_name: name,
            ...(cleanPhone ? { phone: cleanPhone } : {}),
            ...(metadata || {}),
          },
        },
      });

      if (error) {
        let friendlyMsg = error.message;
        if (
          error.message.toLowerCase().includes('already registered') || 
          error.message.toLowerCase().includes('already in use')
        ) {
          friendlyMsg = 'Este e-mail já está cadastrado. Por favor, faça login com suas credenciais.';
        }
        setAuthError(friendlyMsg);
        return { success: false, error: friendlyMsg };
      }

      // Supabase Email Enumeration Protection:
      // Se o usuário já existir no banco e a confirmação de e-mail estiver ativa,
      // data.user é retornado mas data.user.identities é um array vazio [].
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        const duplicateMsg = 'Este e-mail já está cadastrado. Por favor, acesse sua conta na tela de login.';
        setAuthError(duplicateMsg);
        return { success: false, error: duplicateMsg };
      }

      // REGRA CRÍTICA DO signUp (Comando 38):
      // Quando data.user != null e data.session == null:
      // confirmação de e-mail obrigatória pelo Supabase Auth.
      const requiresConfirmation = !!data.user && !data.session;

      console.log('[AUTH DEBUG]', {
        signupUserId: data.user?.id || null,
        signupEmail: cleanEmail,
        signupSessionPresent: !!data.session,
        emailConfirmationRequired: requiresConfirmation,
        authState: requiresConfirmation
          ? 'EMAIL_CONFIRMATION_REQUIRED'
          : (data.session ? 'AUTHENTICATED_RESOLVING_MEMBERSHIP' : 'NOT_AUTHENTICATED'),
        confirmationEmailSent: requiresConfirmation,
      });

      if (requiresConfirmation) {
        // NÃO tratar como erro
        // NÃO fazer login novamente automaticamente
        // NÃO abrir dashboard
        // NÃO abrir onboarding ainda
        // NÃO criar tenant
        // NÃO criar tenant_users
        setIsEmailConfirmationRequired(true);
        setPendingConfirmationEmail(cleanEmail);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('adegafood_pending_confirmation_email', cleanEmail);
        }
        return { success: true, requiresEmailConfirmation: true };
      }

      // Se porventura uma sessão for retornada imediatamente (ex.: auto-confirmação habilitada)
      if (data.user && data.session) {
        clearEmailConfirmation();
        setSupabaseUser(data.user);
        setSupabaseSession(data.session);
        await resolveSupabaseProfile(data.user);
        return { success: true, requiresEmailConfirmation: false };
      }

      return { success: true, requiresEmailConfirmation: false };
    } catch (err: any) {
      const msg = err?.message || 'Erro ao criar conta. Tente novamente.';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  };

  // Reenvio oficial do link de confirmação de e-mail
  const resendConfirmationEmail = async (targetEmail?: string): Promise<{ success: boolean; error?: string }> => {
    const emailToResend = targetEmail?.trim() || pendingConfirmationEmail?.trim();
    if (!emailToResend) {
      return { success: false, error: 'Endereço de e-mail não informado para reenvio.' };
    }

    try {
      const redirectUrl = typeof window !== 'undefined' && window.location.origin.includes('adegafood.ai.studio')
        ? 'https://adegafood.ai.studio'
        : (typeof window !== 'undefined' ? window.location.origin : 'https://adegafood.ai.studio');

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: emailToResend,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) {
        console.warn('[AUTH DEBUG] Falha no reenvio de e-mail:', error.message);
        let friendlyMsg = 'Não foi possível reenviar o link de confirmação no momento.';
        const lowerErr = error.message.toLowerCase();
        if (
          lowerErr.includes('security purposes') ||
          lowerErr.includes('rate limit') ||
          lowerErr.includes('too many') ||
          lowerErr.includes('over_email_send_rate_limit')
        ) {
          friendlyMsg = 'Para sua segurança, aguarde alguns segundos antes de solicitar um novo link de confirmação.';
        }
        return { success: false, error: friendlyMsg };
      }

      console.log('[AUTH DEBUG]', {
        signupUserId: null,
        signupEmail: emailToResend,
        signupSessionPresent: false,
        emailConfirmationRequired: true,
        authState: 'EMAIL_CONFIRMATION_REQUIRED',
        confirmationEmailSent: true,
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro ao processar reenvio de e-mail.' };
    }
  };

  // Solicitação de Redefinição de Senha
  const resetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao solicitar redefinição de senha.' };
    }
  };

  // Login com Google via OAuth nativo do Supabase
  const signInWithGoogle = async (options?: GoogleAuthOptions) => {
    setAuthError(null);
    try {
      // Limpa qualquer estado anterior antes de iniciar o OAuth para isolamento total
      setCurrentUser(null);
      setActiveRole(null);
      setActiveTenantState(null);
      setAvailableTenants([]);
      setHasTenantMembership(false);
      setIsAccountSuspended(false);
      setMembershipStatus('AUTH_LOADING');
      setMembershipError(null);

      const targetPath = options?.returnTo && options.returnTo.startsWith('/') ? options.returnTo : '/';
      const authIntent = options?.intent || (targetPath.startsWith('/app/') ? 'customer' : 'owner');

      if (typeof window !== 'undefined') {
        if (targetPath && targetPath !== '/') {
          sessionStorage.setItem('adegafood_auth_return_to', targetPath);
        } else {
          sessionStorage.removeItem('adegafood_auth_return_to');
        }
        sessionStorage.setItem('adegafood_auth_intent', authIntent);
      }

      const baseUrl = window.location.origin.includes('adegafood.ai.studio')
        ? 'https://adegafood.ai.studio'
        : window.location.origin;

      const redirectUrl = targetPath !== '/' ? `${baseUrl}${targetPath}` : baseUrl;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
        },
      });
      if (error) {
        setAuthError(error.message);
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Erro ao iniciar login com Google.');
    }
  };

  // Logout Oficial
  const signOut = async () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('adegafood_dev_bypass');
    }
    setIsDevBypassed(false);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[AuthContext] Erro ao deslogar do Supabase:', err);
    }
    currentResolvedUserIdRef.current = null;
    clearEmailConfirmation();
    clearTenantEmailConfirmation();
    setSupabaseUser(null);
    setSupabaseSession(null);
    setCurrentUser(null);
    setActiveRole(null);
    setActiveTenantState(null);
    setAvailableTenants([]);
    setHasTenantMembership(false);
    setIsAccountSuspended(false);
    setIsMembershipLoading(false);
    setIsLoadingAuth(false);
    setMembershipStatus('UNAUTHENTICATED');
    setMembershipError(null);
  };

  // Recarrega a sessão e perfil do Supabase
  const refreshSession = useCallback(async () => {
    if (supabaseUser) {
      setIsMembershipLoading(true);
      try {
        await resolveSupabaseProfile(supabaseUser);
      } finally {
        setIsMembershipLoading(false);
      }
    }
  }, [supabaseUser, resolveSupabaseProfile]);

  // Criação do primeiro estabelecimento via RPC segura no Supabase (Comando 42 & 45: PENDING por padrão)
  const createFirstTenant = async (data: {
    name: string;
    slug: string;
    document: string;
    phone: string;
    email: string;
    category: string;
    address: string;
    city: string;
    phoneWhatsApp: string;
  }): Promise<{ success: boolean; requiresEmailConfirmation?: boolean; data?: any; error?: string }> => {
    try {
      if (!supabaseUser) {
        return { success: false, error: 'Usuário não autenticado.' };
      }

      // Regra Obrigatória Comando 45: Magic Link DEVE ser enviado para o e-mail da conta autenticada
      const authAccountEmail = (supabaseUser.email || '').trim().toLowerCase();
      if (!authAccountEmail) {
        return { success: false, error: 'E-mail da conta autenticada não encontrado para confirmação.' };
      }

      // 1. Executa a RPC create_tenant_for_current_user
      // A RPC cria o tenant com status 'PENDING', salva data.email em tenants.email (comercial)
      // e vincula authAccountEmail na confirmação de e-mail da conta
      const { data: rpcData, error } = await supabase.rpc('create_tenant_for_current_user', {
        p_name: data.name,
        p_slug: data.slug,
        p_document: data.document,
        p_phone: data.phone,
        p_email: data.email.trim().toLowerCase(),
        p_category: data.category || 'ADEGA',
        p_address: data.address,
        p_city: data.city || 'São Paulo',
        p_phone_whatsapp: data.phoneWhatsApp,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // 2. Receber tenantId retornado
      const newTenantId = rpcData?.tenantId || rpcData?.tenant_id;
      if (!newTenantId) {
        throw new Error('Identificador do estabelecimento não retornado.');
      }

      // REGRA ARQUITETURAL COMANDO 86: GOOGLE OAUTH
      // Se a conta já possui identidade Google verificada e e-mail confirmado,
      // ativa o primeiro estabelecimento imediatamente via RPC confirm_pending_tenant_after_verified_google
      // sem chamar signInWithOtp e sem tela intermediária de Magic Link!
      if (isGoogleVerifiedUser(supabaseUser)) {
        console.log('[AuthContext] Usuário Google verificado. Ativando estabelecimento via identidade Google...');
        const { data: googleConfirmData, error: googleConfirmErr } = await supabase.rpc('confirm_pending_tenant_after_verified_google');

        if (googleConfirmErr) {
          console.error('[AuthContext] Falha ao ativar estabelecimento via Google:', googleConfirmErr.message);
          return { success: false, error: googleConfirmErr.message };
        }

        console.log('[AuthContext] Estabelecimento ativado com sucesso via Google:', googleConfirmData);
        clearTenantEmailConfirmation();
        if (supabaseUser) {
          await resolveSupabaseProfile(supabaseUser);
        }

        setIsLoadingAuth(false);
        setIsMembershipLoading(false);
        return { success: true, requiresEmailConfirmation: false, data: googleConfirmData };
      }

      // 3. Contas de E-mail/Senha: exige confirmação oficial por Magic Link
      const pendingInfo = {
        id: newTenantId,
        name: data.name,
        slug: data.slug,
        email: authAccountEmail,
        commercialEmail: data.email.trim().toLowerCase(),
      };

      setIsTenantConfirmationRequired(true);
      setPendingConfirmationTenant(pendingInfo);
      setPendingConfirmationEmail(authAccountEmail);
      setTenantConfirmationError(null);
      setHasTenantMembership(false);
      setActiveTenantState(null);
      setActiveRole(null);
      setAvailableTenants([]);
      setIsAccountSuspended(false);

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('adegafood_pending_tenant_id', newTenantId);
        sessionStorage.setItem('adegafood_pending_tenant_info', JSON.stringify(pendingInfo));
      }

      // Disparo REAL do Magic Link oficial do Supabase Auth para o e-mail da conta autenticada
      const redirectUrl = typeof window !== 'undefined' && window.location.origin.includes('adegafood.ai.studio')
        ? 'https://adegafood.ai.studio/confirmar-estabelecimento'
        : (typeof window !== 'undefined' ? `${window.location.origin}/confirmar-estabelecimento` : 'https://adegafood.ai.studio/confirmar-estabelecimento');

      let emailDispatchError: string | null = null;
      try {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: authAccountEmail,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: redirectUrl,
          },
        });

        if (otpError) {
          console.error('[AUTH DEBUG] Erro no disparo do Magic Link:', otpError);
          emailDispatchError = 'Não foi possível enviar o e-mail de confirmação agora. Tente novamente mais tarde.';
          setTenantConfirmationError(emailDispatchError);
        } else {
          console.log('[AUTH DEBUG] Magic Link disparado com sucesso para o e-mail da conta:', authAccountEmail);
        }
      } catch (otpErr) {
        console.error('[AUTH DEBUG] Exceção no disparo de signInWithOtp:', otpErr);
        emailDispatchError = 'Não foi possível enviar o e-mail de confirmação agora. Tente novamente mais tarde.';
        setTenantConfirmationError(emailDispatchError);
      }

      // Finalizar loadings sem transicionar para o Dashboard
      setIsLoadingAuth(false);
      setIsMembershipLoading(false);

      return { 
        success: true, 
        requiresEmailConfirmation: true, 
        data: rpcData,
        error: emailDispatchError || undefined 
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha ao processar cadastro do estabelecimento.' };
    }
  };

  // Ativação segura do estabelecimento para contas autenticadas com identidade Google verificada (Comando 86)
  const confirmPendingTenantAfterVerifiedGoogle = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsMembershipLoading(true);
      const { data, error } = await supabase.rpc('confirm_pending_tenant_after_verified_google');

      if (error) {
        console.warn('[AuthContext] Falha ao ativar estabelecimento via Google verificado:', error.message);
        return { success: false, error: error.message || 'Falha ao ativar estabelecimento via Google verificado.' };
      }

      clearTenantEmailConfirmation();
      if (supabaseUser) {
        await resolveSupabaseProfile(supabaseUser);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro inesperado na confirmação via Google.' };
    } finally {
      setIsMembershipLoading(false);
    }
  }, [clearTenantEmailConfirmation, supabaseUser, resolveSupabaseProfile]);

  // Confirmação segura do primeiro estabelecimento após autenticação pelo Magic Link (Comando 43 & 45 & 86)
  // Backend valida auth.uid(), o claim auth.jwt()->'amr' contendo 'magiclink'/'otp'/'email', e expires_at
  // Se a conta for Google verificada, direciona para confirm_pending_tenant_after_verified_google
  const confirmPendingTenantAfterEmail = useCallback(async (tenantId?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsMembershipLoading(true);

      // Desvio seguro: usuários Google verificados utilizam a RPC dedicada sem dependência de AMR
      if (isGoogleVerifiedUser(supabaseUser)) {
        return await confirmPendingTenantAfterVerifiedGoogle();
      }

      const targetTenantId = tenantId || pendingConfirmationTenant?.id || null;

      // Executa RPC confirm_pending_tenant_after_email que valida auth.uid(), claim auth.jwt()->'amr', e expires_at com lock
      const { data, error } = await supabase.rpc('confirm_pending_tenant_after_email', {
        p_tenant_id: targetTenantId,
      });

      if (error) {
        console.warn('[AuthContext] Falha ao confirmar estabelecimento após e-mail:', error.message);
        return { success: false, error: error.message || 'Falha ao confirmar estabelecimento após autenticação por e-mail.' };
      }

      clearTenantEmailConfirmation();
      if (supabaseUser) {
        await resolveSupabaseProfile(supabaseUser);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro inesperado na confirmação.' };
    } finally {
      setIsMembershipLoading(false);
    }
  }, [supabaseUser, confirmPendingTenantAfterVerifiedGoogle, pendingConfirmationTenant, clearTenantEmailConfirmation, resolveSupabaseProfile]);

  // Wrapper para compatibilidade regressiva
  const confirmTenantEmail = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    return confirmPendingTenantAfterEmail();
  }, [confirmPendingTenantAfterEmail]);

  // Reenvio oficial de Magic Link de confirmação para o estabelecimento
  // REGRA OBRIGATÓRIA: Enviar SEMPRE para o e-mail da conta autenticada
  const resendTenantConfirmationEmail = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      // Se for Google verificado, ativa diretamente via Google sem necessidade de envio de e-mail
      if (isGoogleVerifiedUser(supabaseUser)) {
        return await confirmPendingTenantAfterVerifiedGoogle();
      }

      const tenantId = pendingConfirmationTenant?.id || null;
      const authAccountEmail = (supabaseUser?.email || currentUser?.email || '').trim().toLowerCase();
      if (!authAccountEmail) {
        return { success: false, error: 'E-mail da conta autenticada não identificado para reenvio.' };
      }

      // 1. Registra reenvio na auditoria com controle de cooldown e renovação de expires_at via RPC
      const { error: rpcErr } = await supabase.rpc('resend_tenant_confirmation_email', {
        p_tenant_id: tenantId,
      });

      if (rpcErr) {
        return { success: false, error: rpcErr.message };
      }

      // 2. Dispara Magic Link oficial via Supabase Auth para o e-mail da conta com shouldCreateUser: false
      const redirectUrl = typeof window !== 'undefined' && window.location.origin.includes('adegafood.ai.studio')
        ? 'https://adegafood.ai.studio/confirmar-estabelecimento'
        : (typeof window !== 'undefined' ? `${window.location.origin}/confirmar-estabelecimento` : 'https://adegafood.ai.studio/confirmar-estabelecimento');

      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: authAccountEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectUrl,
        },
      });

      if (otpError) {
        console.error('[AUTH DEBUG] Erro no reenvio de confirmação:', otpError);
        let msg = 'Não foi possível enviar o e-mail de confirmação agora. Tente novamente mais tarde.';
        if (otpError.message.toLowerCase().includes('rate limit') || (otpError as any).status === 429) {
          msg = 'Limite temporário de envio de e-mails atingido. Aguarde alguns instantes antes de tentar novamente.';
        }
        return { success: false, error: msg };
      }

      return { success: true };
    } catch (err: any) {
      console.error('[AUTH DEBUG] Exceção no reenvio de confirmação:', err);
      return { success: false, error: 'Não foi possível enviar o e-mail de confirmação agora. Tente novamente mais tarde.' };
    }
  }, [pendingConfirmationTenant, currentUser, supabaseUser, confirmPendingTenantAfterVerifiedGoogle]);

  // Listener para ativação automática ao retornar do Magic Link (/confirmar-estabelecimento)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isCallbackPath = window.location.pathname.startsWith('/confirmar-estabelecimento');
    const hasAuthParams = window.location.hash.includes('access_token=') || window.location.search.includes('code=');

    if ((isCallbackPath || hasAuthParams) && supabaseUser) {
      confirmPendingTenantAfterEmail().then((res) => {
        if (res.success && isCallbackPath) {
          window.history.replaceState({}, '', '/');
        }
      });
    }
  }, [supabaseUser, confirmPendingTenantAfterEmail]);

  const securityContext = useMemo(
    () => ({
      userId: currentUser?.id || 'anonymous',
      userName: currentUser?.name || 'Anônimo',
      userRole: activeRole || 'CUSTOMER',
      tenantId:
        activeRole === 'CEO' && !isCeoSupportMode
          ? undefined
          : activeTenant?.id,
      isCeoSupportMode,
    }),
    [
      currentUser?.id,
      currentUser?.name,
      activeRole,
      activeTenant?.id,
      isCeoSupportMode,
    ]
  );

  const enterCeoSupportMode = (tenant: Tenant) => {
    if (activeRole === 'CEO' || activeRole === 'SUPER_ADMIN') {
      setIsCeoSupportMode(true);
      setActiveTenantState(tenant);
    }
  };

  const exitCeoSupportMode = () => {
    setIsCeoSupportMode(false);
    setActiveTenantState(null);
  };

  const setActiveTenant = (tenant: Tenant | null) => {
    setActiveTenantState(tenant);
  };

  // Modo Demo: exclusivo para desenvolvimento sob flag estrita
  const loginAsPersona = IS_DEMO_MODE ? (role: RoleId, tenantId?: string) => {
    setIsCeoSupportMode(false);
    setActiveRole(role);
    setHasTenantMembership(role !== 'CUSTOMER');
    setCurrentUser({
      id: 'demo-user-id',
      name: `Demo ${role}`,
      email: `demo.${role.toLowerCase()}@adegafood.test`,
      role,
      tenantId,
    });
  } : undefined;

  // Acesso Temporário de Desenvolvimento (Comando: Acesso direto ao painel do dono sem login)
  const bypassLoginAsOwner = useCallback(async () => {
    setIsLoadingAuth(false);
    setIsMembershipLoading(false);
    setIsEmailConfirmationRequired(false);
    setIsTenantConfirmationRequired(false);
    setAuthError(null);
    setMembershipError(null);
    setIsAccountSuspended(false);

    if (typeof window !== 'undefined') {
      localStorage.setItem('adegafood_dev_bypass', 'true');
    }
    setIsDevBypassed(true);

    let tenant: Tenant | null = null;
    try {
      const { data: tenantRows } = await supabase.from('tenants').select('*').limit(1);
      if (tenantRows && tenantRows.length > 0) {
        const tRow = tenantRows[0];
        const { data: settingsRow } = await supabase.from('tenant_settings').select('*').eq('tenant_id', tRow.id).maybeSingle();
        const { data: themeRow } = await supabase.from('tenant_themes').select('*').eq('tenant_id', tRow.id).maybeSingle();
        tenant = mapDbTenant(tRow, settingsRow, themeRow);
      }
    } catch (e) {
      console.warn('[DevBypass] Erro ao buscar tenant no Supabase:', e);
    }

    if (!tenant) {
      tenant = dataStore.getTenantBySlug('adega-premium') || null;
    }

    const tenantId = tenant?.id || 'tenant-adega-01';
    const tenantName = tenant?.name || 'Adega Premium Jardins';
    const tenantSlug = tenant?.slug || 'adega-premium';

    setActiveTenantState(tenant);
    setActiveRole('OWNER');
    setHasTenantMembership(true);
    setMembershipStatus('MEMBERSHIP_RESOLVED_WITH_DATA');
    setAvailableTenants([
      {
        tenantId,
        roleId: 'OWNER',
        status: 'ACTIVE',
        tenantName,
        tenantSlug,
        category: tenant?.category || 'ADEGA',
      }
    ]);

    const devUser: AppUser = {
      id: 'dev-owner-bypass',
      name: 'Dono do Estabelecimento (Dev)',
      email: tenant?.email || 'dono.dev@adegafood.test',
      role: 'OWNER',
      tenantId,
    };
    setCurrentUser(devUser);
  }, []);

  const exitDevBypass = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('adegafood_dev_bypass');
    }
    setIsDevBypassed(false);
    setCurrentUser(null);
    setActiveRole(null);
    setActiveTenantState(null);
    setHasTenantMembership(false);
    setMembershipStatus('UNAUTHENTICATED');
  }, []);

  // Restaura o bypass automaticamente ao recarregar a página se ativo
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('adegafood_dev_bypass') === 'true') {
      bypassLoginAsOwner();
    }
  }, [bypassLoginAsOwner]);

  // Estado unificado e estrito de ciclo de vida da autenticação
  const authState: AuthState = useMemo(() => {
    // 0. Modo Dev Bypass temporário para testes e programação do painel de dono
    if (isDevBypassed && currentUser) {
      return 'AUTHENTICATED_WITH_MEMBERSHIP';
    }

    // 1. Falha de autenticação ou erro estrito na resolução dos vínculos (CASO B)
    if (membershipStatus === 'MEMBERSHIP_ERROR' || authError) {
      return 'AUTH_ERROR';
    }

    // 2. Confirmação de e-mail cadastral pendente (Supabase Auth email confirmation)
    if (isEmailConfirmationRequired && !supabaseUser) {
      return 'EMAIL_CONFIRMATION_REQUIRED';
    }

    // 2b. Confirmação de e-mail do primeiro estabelecimento pendente (Comando 42)
    if (isTenantConfirmationRequired && pendingConfirmationTenant) {
      return 'EMAIL_CONFIRMATION_REQUIRED_FOR_TENANT';
    }

    // 3. Sem sessão Supabase
    if (!supabaseUser) {
      if (isLoadingAuth) {
        return 'AUTHENTICATING';
      }
      return 'NOT_AUTHENTICATED';
    }

    // 3. Sessão existe mas ainda está carregando ou resolvendo vínculos
    if (isLoadingAuth || isMembershipLoading || membershipStatus === 'AUTH_LOADING' || membershipStatus === 'MEMBERSHIP_LOADING') {
      return 'AUTHENTICATED_RESOLVING_MEMBERSHIP';
    }

    // 4. Sessão com vínculos confirmados (CASO 2: Usuário já cadastrado com estabelecimento ativo ou CEO)
    if (
      hasTenantMembership ||
      activeRole === 'CEO' ||
      activeRole === 'SUPER_ADMIN' ||
      availableTenants.length > 0 ||
      !!activeTenant ||
      membershipStatus === 'MEMBERSHIP_RESOLVED_WITH_DATA'
    ) {
      return 'AUTHENTICATED_WITH_MEMBERSHIP';
    }

    // 5. Sessão válida sem vínculos em tenant_users (CASO 1: Novo Usuário)
    if (
      membershipStatus === 'MEMBERSHIP_RESOLVED_EMPTY' ||
      (!hasTenantMembership && availableTenants.length === 0)
    ) {
      return 'AUTHENTICATED_WITHOUT_MEMBERSHIP';
    }

    return 'AUTHENTICATED_WITHOUT_MEMBERSHIP';
  }, [
    membershipStatus,
    authError,
    supabaseUser,
    isLoadingAuth,
    isMembershipLoading,
    hasTenantMembership,
    activeRole,
    availableTenants.length,
    activeTenant,
    isTenantConfirmationRequired,
    pendingConfirmationTenant,
    isDevBypassed,
    currentUser,
  ]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        activeRole,
        activeTenant,
        isCeoSupportMode,
        securityContext,

        supabaseUser,
        supabaseSession,
        isSupabaseAuth: !!supabaseUser || isDevBypassed,
        isLoadingAuth,
        isMembershipLoading,
        authError,

        authState,
        pendingConfirmationEmail,
        resendConfirmationEmail,
        clearEmailConfirmation,

        pendingConfirmationTenant,
        tenantConfirmationError,
        confirmPendingTenantAfterEmail,
        confirmPendingTenantAfterVerifiedGoogle,
        confirmTenantEmail,
        resendTenantConfirmationEmail,
        clearTenantEmailConfirmation,

        membershipStatus,
        membershipError,
        retryAuthResolution,

        hasTenantMembership,
        isAccountSuspended,
        availableTenants,
        switchTenant,

        signInWithPassword,
        signUp,
        signInWithGoogle,
        signOut,
        resetPassword,

        createFirstTenant,
        refreshSession,

        enterCeoSupportMode,
        exitCeoSupportMode,
        setActiveTenant,
        logout: signOut,

        isDemoModeEnabled: IS_DEMO_MODE,
        loginAsPersona,

        isDevBypassed,
        bypassLoginAsOwner,
        exitDevBypass,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
};
