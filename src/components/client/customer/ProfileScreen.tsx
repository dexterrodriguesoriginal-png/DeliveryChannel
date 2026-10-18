import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell, Ticket, User, MapPin, IdCard, Heart, Settings, BellRing, Eraser, LogOut, HelpCircle, FileText, ShieldCheck, Trash2, LogIn, ChevronRight, Store,
} from 'lucide-react';
import type { Campaign, Order, Product } from '../../../types';
import { Accordion, MenuRow } from './ui';
import { CustomerNotification } from '../../../lib/customer/notifications';
import { AccountDataPage, CouponsPage, DeleteAccountSheet, FavoritesPage, HelpPage, LegalPage, NotificationSettingsPage, NotificationsPage } from './ProfilePages';
import { StoreCoupon } from '../../../repositories/customerAppRepository';

export type ProfilePage =
  | 'menu' | 'notifications' | 'coupons' | 'account-data' | 'favorites' | 'notif-settings' | 'help' | 'terms' | 'privacy';

export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || '1.2.0';

export interface ProfileScreenProps {
  page: ProfilePage;
  onNavigate: (p: ProfilePage) => void;
  color: string;
  user: { id: string; email?: string } | null;
  customerName: string;
  customerPhone: string;
  onLogin: () => void;
  onSignOut: () => Promise<void> | void;
  onOpenAddresses: () => void;
  addressSummary?: string;
  // notificações
  notifications: CustomerNotification[];
  unreadCount: number;
  onNotificationsSeen: () => void;
  onOpenOrder: (orderId: string) => void;
  // cupons
  storeSlug: string;
  campaigns: Campaign[];
  nowMs: number;
  onUseCoupon: (code: string) => void;
  loadCoupons: (slug: string, campaigns: Campaign[]) => Promise<StoreCoupon[]>;
  // conta
  loadCpf: () => Promise<string | null>;
  onSaveProfile: (d: { name: string; phone: string; cpf: string }) => Promise<void>;
  // favoritos
  favoriteProducts: Product[];
  qtyOf: (productId: string) => number;
  onAdd: (p: Product) => void;
  onRemove: (p: Product) => void;
  onOpenProduct: (p: Product) => void;
  onToggleFavorite: (productId: string) => void;
  // configurações
  onClearSearchHistory: () => void;
  onRequestDeletion: (reason: string) => Promise<{ ok: boolean; message?: string }>;
  // ajuda
  storeName: string;
  onWhatsApp: (text?: string) => void;
  helpOrder?: Order | null;
  onClearHelpOrder: () => void;
  onAboutStore: () => void;
}

/** Perfil no estilo do iFood: cabeçalho com avatar, menu em acordeão, rodapé com versão. */
export const ProfileScreen: React.FC<ProfileScreenProps> = (props) => {
  const { page, onNavigate, color, user } = props;
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Estado dos acordeões fica aqui (o menu desmonta ao abrir uma subpágina): volta como o cliente deixou.
  const [openSections, setOpenSections] = useState<{ account: boolean; settings: boolean }>({ account: false, settings: false });
  const setSection = (k: 'account' | 'settings') => (v: boolean) => setOpenSections(s => ({ ...s, [k]: v }));
  const back = () => onNavigate('menu');

  if (page === 'notifications') return <NotificationsPage {...props} onBack={back} />;
  if (page === 'coupons') return <CouponsPage {...props} onBack={back} />;
  if (page === 'account-data') return <AccountDataPage {...props} onBack={back} />;
  if (page === 'favorites') return <FavoritesPage {...props} onBack={back} />;
  if (page === 'notif-settings') return <NotificationSettingsPage {...props} onBack={back} />;
  if (page === 'help') return <HelpPage {...props} onBack={() => { props.onClearHelpOrder(); back(); }} />;
  if (page === 'terms') return <LegalPage kind="terms" onBack={back} />;
  if (page === 'privacy') return <LegalPage kind="privacy" onBack={back} />;

  const initials = (props.customerName || user?.email || 'C').trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();

  return (
    <div className="max-w-lg mx-auto pb-28 dc-screen-in" data-testid="profile-screen">
      <div className="px-4 pt-5 pb-4 flex items-center gap-4 bg-white">
        <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-black shadow-sm shrink-0" style={{ backgroundColor: color }}>
          {user ? initials : <User className="w-7 h-7" />}
        </div>
        <div className="min-w-0 flex-1">
          {user ? (
            <>
              <h2 className="text-lg font-extrabold text-gray-900 truncate" data-testid="profile-name">{props.customerName || 'Cliente'}</h2>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-extrabold text-gray-900">Olá!</h2>
              <button type="button" onClick={props.onLogin} className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold cursor-pointer" style={{ color }} data-testid="profile-login">
                <LogIn className="w-4 h-4" /> Entrar ou criar conta <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 bg-white divide-y divide-gray-100 border-y border-gray-100">
        <MenuRow testId="menu-notifications" icon={<Bell className="w-5 h-5" />} title="Notificações" subtitle="Atualizações dos seus pedidos" onClick={() => onNavigate('notifications')}
          right={props.unreadCount > 0 ? <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-black flex items-center justify-center">{props.unreadCount}</span> : undefined} />
        <MenuRow testId="menu-coupons" icon={<Ticket className="w-5 h-5" />} title="Meus cupons" subtitle="Descontos desta loja" onClick={() => onNavigate('coupons')} />
        <Accordion testId="menu-account" open={openSections.account} onOpenChange={setSection('account')} icon={<User className="w-5 h-5" />} title="Conta" subtitle="Endereços, dados e favoritos">
          <MenuRow testId="menu-addresses" icon={<MapPin className="w-4 h-4" />} title="Endereços" subtitle={props.addressSummary || 'Endereços de entrega salvos'} onClick={props.onOpenAddresses} />
          <MenuRow testId="menu-account-data" icon={<IdCard className="w-4 h-4" />} title="Dados da conta" subtitle="Nome, CPF e telefone" onClick={() => (user ? onNavigate('account-data') : props.onLogin())} />
          <MenuRow testId="menu-favorites" icon={<Heart className="w-4 h-4" />} title="Favoritos" subtitle={`${props.favoriteProducts.length} produto(s)`} onClick={() => onNavigate('favorites')} />
        </Accordion>
        <Accordion testId="menu-settings" open={openSections.settings} onOpenChange={setSection('settings')} icon={<Settings className="w-5 h-5" />} title="Configurações" subtitle="Notificações, privacidade e conta">
          <MenuRow testId="menu-notif-settings" icon={<BellRing className="w-4 h-4" />} title="Gerenciar notificações" onClick={() => onNavigate('notif-settings')} />
          <MenuRow testId="menu-clear-search" icon={<Eraser className="w-4 h-4" />} title="Limpar histórico de busca" onClick={props.onClearSearchHistory} right={<span />} />
          <MenuRow testId="menu-terms" icon={<FileText className="w-4 h-4" />} title="Termos de uso" onClick={() => onNavigate('terms')} />
          <MenuRow testId="menu-privacy" icon={<ShieldCheck className="w-4 h-4" />} title="Política de privacidade" onClick={() => onNavigate('privacy')} />
          {user && <MenuRow testId="menu-delete" icon={<Trash2 className="w-4 h-4" />} title="Excluir minha conta" danger onClick={() => setDeleteOpen(true)} />}
          {user && <MenuRow testId="menu-signout" icon={<LogOut className="w-4 h-4" />} title="Sair da conta" danger onClick={() => props.onSignOut()} right={<span />} />}
        </Accordion>
        <MenuRow testId="menu-help" icon={<HelpCircle className="w-5 h-5" />} title="Ajuda" subtitle="Dúvidas frequentes e falar com a loja" onClick={() => onNavigate('help')} />
        <MenuRow testId="menu-about-store" icon={<Store className="w-5 h-5" />} title={`Sobre ${props.storeName}`} subtitle="Telefone, endereço e horário" onClick={props.onAboutStore} />
      </div>

      <p className="text-center text-[11px] text-gray-400 mt-6" data-testid="app-version">Delivery Channel · versão {APP_VERSION}</p>

      <DeleteAccountSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} color={color} onConfirm={props.onRequestDeletion} />
    </div>
  );
};

