import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { RoleTenantSwitcher } from './RoleTenantSwitcher';
import { 
  Menu, 
  ChevronDown, 
  Store, 
  Building2, 
  Lock, 
  Bell, 
  CheckCircle2, 
  ExternalLink 
} from 'lucide-react';

export interface HeaderProps {
  onToggleSidebar?: () => void;
  activeNavTab: string;
}

const ROLE_LABELS: Record<string, string> = {
  CEO: 'Administrador Global',
  SUPER_ADMIN: 'Super Administrador',
  OWNER: 'Proprietário',
  MANAGER: 'Gerente',
  OPERATOR: 'Operador',
  CASHIER: 'Caixa',
  DELIVERY_MANAGER: 'Gestão de Entregas',
  DRIVER: 'Entregador',
  CUSTOMER: 'Cliente',
};

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { currentUser, activeRole, activeTenant, isSupabaseAuth } = useAuth();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const isStoreOpen = activeTenant?.settings?.isOpen ?? true;

  return (
    <>
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-gray-200/80 px-2 sm:px-2.5 h-6.5 sm:h-7 flex items-center justify-between transition-colors">
        {/* ============================================================ */}
        {/* Esquerda: Brand ADEGAFOOD & Nome da Loja (COMANDO 124 / 125) */}
        {/* ============================================================ */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="lg:hidden p-0.5 rounded text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors cursor-pointer"
              aria-label="Abrir Menu"
            >
              <Menu className="w-2.5 h-2.5" />
            </button>
          )}

          <div className="flex items-center gap-1">
            <div className="w-4.5 h-4.5 rounded bg-emerald-700 flex items-center justify-center text-white font-black text-[8px] shadow-2xs tracking-wider shrink-0">
              AF
            </div>
            <div className="flex flex-col justify-center min-w-0">
              <span className="font-extrabold text-[9px] sm:text-[9.5px] tracking-tight text-slate-900 font-sans leading-none">
                ADEGA<span className="text-emerald-700">FOOD</span>
              </span>
              <span className="text-[6.5px] sm:text-[7px] font-bold text-slate-600 truncate max-w-[120px] sm:max-w-[180px] uppercase tracking-wide mt-0.5 leading-none">
                {(activeRole === 'CEO' || activeRole === 'SUPER_ADMIN')
                  ? 'ADMINISTRAÇÃO GLOBAL'
                  : (activeTenant?.name || 'ESTABELECIMENTO')}
              </span>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* Centro / Contextual: Status Operacional da Loja              */}
        {/* ============================================================ */}
        {activeTenant && (
          <div className="hidden md:flex items-center gap-1 px-1.5 py-0 bg-slate-50 border border-slate-200/80 rounded text-[7.5px] leading-tight">
            <span className={`w-1 h-1 rounded-full shrink-0 ${isStoreOpen ? 'bg-emerald-500 ring-1 ring-emerald-500/20' : 'bg-rose-500 ring-1 ring-rose-500/20'}`} />
            <span className={isStoreOpen ? 'text-emerald-800 font-semibold' : 'text-rose-700 font-semibold'}>
              {isStoreOpen ? 'Loja aberta' : 'Loja fechada'}
            </span>
          </div>
        )}

        {/* ============================================================ */}
        {/* Direita: Notificações, Minha Conta & Perfil                  */}
        {/* ============================================================ */}
        <div className="flex items-center gap-1">
          {/* Botão Notificações */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotificationsOpen(prev => !prev)}
              className="p-0.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer relative"
              title="Notificações"
              aria-label="Notificações"
            >
              <Bell className="w-2 h-2" />
              <span className="absolute top-0 right-0 w-1 h-1 rounded-full bg-emerald-600 ring-1 ring-white" />
            </button>

            {/* Dropdown Notificações Rápido */}
            {notificationsOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-white rounded shadow-xl border border-slate-200/80 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-0.5 border-b border-slate-100">
                  <span className="text-[8.5px] font-bold text-slate-900">Notificações</span>
                  <span className="text-[7px] text-emerald-700 font-semibold cursor-pointer">Tudo lido</span>
                </div>
                <div className="py-0.5 text-[8px] text-slate-500 space-y-0.5">
                  <div className="flex items-start gap-1 p-0.5 rounded bg-emerald-50/50 text-emerald-950">
                    <CheckCircle2 className="w-2 h-2 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[8px]">Sistema Operacional</p>
                      <p className="text-[7px] text-slate-500">Cardápio e pedidos funcionando perfeitamente.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Botão de Troca de Estabelecimento / Sessão */}
          <button
            onClick={() => setSwitcherOpen(true)}
            className="flex items-center gap-0.5 px-1 py-0.2 bg-white hover:bg-slate-50 border border-slate-200 rounded text-[8.5px] font-semibold text-slate-700 transition-colors cursor-pointer shadow-2xs"
          >
            {isSupabaseAuth ? <Building2 className="w-1.5 h-1.5 text-emerald-700" /> : <Lock className="w-1.5 h-1.5 text-emerald-700" />}
            <span className="hidden sm:inline">{isSupabaseAuth ? 'Minha Conta' : 'Entrar'}</span>
            <ChevronDown className="w-1.5 h-1.5 text-slate-400" />
          </button>

          {/* Current User Info */}
          {currentUser && (
            <div 
              onClick={() => setSwitcherOpen(true)}
              className="flex items-center gap-1 pl-1 border-l border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
              title="Abrir Minha Conta"
            >
              <Avatar name={currentUser.name} src={currentUser.avatar} size="xs" className="w-4.5 h-4.5 text-[7px]" />
              <div className="hidden lg:block text-left">
                <div className="text-[8.5px] font-bold text-slate-900 leading-none truncate max-w-[90px]">
                  {currentUser.name}
                </div>
                <div className="text-[7px] text-slate-500 font-medium leading-none mt-0.5">
                  {activeRole ? (ROLE_LABELS[activeRole] || activeRole) : 'Proprietário'}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <RoleTenantSwitcher
        isOpen={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />
    </>
  );
};
