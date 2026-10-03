import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  Package, 
  Layers, 
  Tag, 
  Users, 
  QrCode, 
  Palette, 
  Bike, 
  Boxes, 
  DollarSign, 
  TrendingUp, 
  UserPlus, 
  Settings, 
  ShieldCheck,
  Building2,
  Sparkles,
  FileText,
  Headphones,
  ExternalLink,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { getPublicStorePath, isValidStoreSlug } from '../../utils/publicStoreUrl';

export interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

interface NavGroup {
  groupTitle: string;
  items: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
  }>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile = () => {},
}) => {
  const { activeRole, activeTenant } = useAuth();

  // Estado de recolhimento no Desktop com persistência em localStorage
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('adegafood_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('adegafood_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Permissão técnica para laboratório de segurança
  const isSecurityLabEnabled = import.meta.env.VITE_ENABLE_SECURITY_LAB === 'true';

  // Grupos Oficiais do Estabelecimento conforme COMANDO 48
  const establishmentGroups: NavGroup[] = [
    {
      groupTitle: 'VISÃO GERAL',
      items: [
        { id: 'est-dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      groupTitle: 'VENDAS',
      items: [
        { id: 'est-orders', label: 'Pedidos', icon: <ShoppingBag className="w-4 h-4 shrink-0" /> },
        { id: 'est-products', label: 'Cardápio / Produtos', icon: <Package className="w-4 h-4 shrink-0" /> },
        { id: 'est-categories', label: 'Categorias', icon: <Layers className="w-4 h-4 shrink-0" /> },
        { id: 'est-marketing', label: 'Marketing', icon: <QrCode className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      groupTitle: 'CLIENTES',
      items: [
        { id: 'est-customers', label: 'Clientes', icon: <Users className="w-4 h-4 shrink-0" /> },
        { id: 'est-promotions', label: 'Promoções & Cupons', icon: <Tag className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      groupTitle: 'OPERAÇÃO',
      items: [
        { id: 'est-drivers', label: 'Frota & Entregadores', icon: <Bike className="w-4 h-4 shrink-0" /> },
        { id: 'est-inventory', label: 'Estoque & Kardex', icon: <Boxes className="w-4 h-4 shrink-0" /> },
        { id: 'est-theme', label: 'Customização Visual', icon: <Palette className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      groupTitle: 'FINANCEIRO',
      items: [
        { id: 'est-finance', label: 'Financeiro & Taxas', icon: <DollarSign className="w-4 h-4 shrink-0" /> },
        { id: 'est-reports', label: 'Relatórios & Fechamento', icon: <TrendingUp className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      groupTitle: 'GESTÃO',
      items: [
        { id: 'est-team', label: 'Equipe & Permissões', icon: <UserPlus className="w-4 h-4 shrink-0" /> },
        { id: 'est-settings', label: 'Configurações da Loja', icon: <Settings className="w-4 h-4 shrink-0" /> },
        ...(isSecurityLabEnabled ? [{ id: 'security-lab', label: 'Laboratório de Isolamento', icon: <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" /> }] : []),
      ],
    },
  ];

  // Grupos CEO / Administração Global
  const ceoGroups: NavGroup[] = [
    {
      groupTitle: 'VISÃO GERAL',
      items: [
        { id: 'ceo-dashboard', label: 'Visão Geral HQ', icon: <LayoutDashboard className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      groupTitle: 'REDE & VENDAS',
      items: [
        { id: 'ceo-tenants', label: 'Estabelecimentos', icon: <Building2 className="w-4 h-4 shrink-0" /> },
        { id: 'ceo-sponsors', label: 'Patrocínios & Rede', icon: <Sparkles className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      groupTitle: 'CONTROLE GLOBAL',
      items: [
        { id: 'ceo-finance', label: 'Receita & Planos', icon: <DollarSign className="w-4 h-4 shrink-0" /> },
        { id: 'ceo-audit', label: 'Trilha de Auditoria', icon: <FileText className="w-4 h-4 shrink-0" /> },
        { id: 'ceo-support', label: 'Central de Suporte', icon: <Headphones className="w-4 h-4 shrink-0" /> },
        ...(isSecurityLabEnabled ? [{ id: 'security-lab', label: 'Laboratório Anti-Hacker', icon: <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" /> }] : []),
      ],
    },
  ];

  const groups = (activeRole === 'CEO' || activeRole === 'SUPER_ADMIN') ? ceoGroups : establishmentGroups;

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden backdrop-blur-xs transition-opacity animate-in fade-in"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 bg-white border-r border-gray-200/80 flex flex-col justify-between transition-all duration-200 ease-in-out lg:static lg:translate-x-0 lg:h-full shrink-0 h-full',
          isOpenMobile ? 'translate-x-0 w-64' : '-translate-x-full',
          // Desktop Width: 50px quando recolhida, 200px quando expandida (COMANDO 125 - 10% extra)
          isCollapsed ? 'lg:w-[50px]' : 'lg:w-[200px]'
        )}
      >
        {/* Container Interno: Começa diretamente com a navegação (Sem duplicação de branding) */}
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
          {/* Topo do Sidebar: Cabeçalho Enxuto e Controle de Recolhimento */}
          <div className={cn(
            'px-2.5 py-1.5 border-b border-gray-100 flex items-center justify-between shrink-0',
            isCollapsed ? 'lg:px-1 lg:justify-center' : ''
          )}>
            {!isCollapsed && (
              <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-wider select-none">
                Menu
              </span>
            )}

            {/* Botão de Toggle de Recolhimento (apenas Desktop) */}
            <button
              onClick={toggleCollapsed}
              className={cn(
                "p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer",
                isCollapsed ? "hidden lg:flex" : "hidden lg:flex ml-auto"
              )}
              title={isCollapsed ? 'Expandir Menu' : 'Recolher Menu'}
              aria-label={isCollapsed ? 'Expandir Menu' : 'Recolher Menu'}
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>

            {/* Botão Fechar no Mobile */}
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 ml-auto cursor-pointer"
              aria-label="Fechar Menu"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation Groups */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-3 scrollbar-thin">
            {groups.map((group, gIdx) => (
              <div key={gIdx} className="space-y-0.5">
                {/* Título do Grupo */}
                {!isCollapsed && (
                  <div className="px-2 pb-0.5 text-[9.5px] font-bold text-gray-400 uppercase tracking-wider select-none">
                    {group.groupTitle}
                  </div>
                )}
                {isCollapsed && (
                  <div className="hidden lg:block my-1 border-t border-gray-100" />
                )}

                {/* Itens do Grupo */}
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const isActive = currentTab === item.id;
                    return (
                      <div key={item.id} className="relative group">
                        <button
                          onClick={() => {
                            onSelectTab(item.id);
                            onCloseMobile();
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 rounded-md text-[11.8px] font-semibold tracking-tight leading-none transition-all duration-150 cursor-pointer text-left',
                            isCollapsed
                              ? 'lg:justify-center lg:px-0 lg:py-1.5 px-2 py-[4.5px]'
                              : 'px-2 py-[4.5px]',
                            isActive
                              ? 'bg-emerald-700 text-white shadow-2xs font-bold'
                              : 'text-gray-600 hover:text-gray-950 hover:bg-gray-100/80'
                          )}
                          title={isCollapsed ? item.label : undefined}
                        >
                          <span className={cn(isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-700', 'shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5')}>
                            {item.icon}
                          </span>
                          <span className={cn('truncate', isCollapsed ? 'lg:hidden' : '')}>
                            {item.label}
                          </span>
                        </button>

                        {/* Tooltip flutuante no modo recolhido (desktop) */}
                        {isCollapsed && (
                          <div className="hidden lg:group-hover:flex absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 items-center pointer-events-none animate-in fade-in zoom-in-95 duration-100">
                            <div className="bg-slate-900 text-white text-[10.5px] font-medium px-2 py-0.5 rounded shadow-lg whitespace-nowrap">
                              {item.label}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer Ancorado na Parte Inferior do Sidebar (COMANDO 128/130) */}
          <div className={cn(
            'p-2 border-t border-gray-100 bg-white shrink-0 space-y-1 mt-auto',
            isCollapsed ? 'lg:p-1.5' : ''
          )}>
            {activeTenant && isValidStoreSlug(activeTenant.slug) && (
              <a
                href={getPublicStorePath(activeTenant.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'w-full flex items-center rounded-lg border border-emerald-200/80 bg-emerald-50/60 hover:bg-emerald-100/70 text-[11px] font-bold text-emerald-900 transition-colors',
                  isCollapsed ? 'lg:justify-center lg:p-1.5 p-1.5 justify-between' : 'p-1.5 justify-between'
                )}
                title="Abrir Catálogo Público"
              >
                <span className={cn('truncate', isCollapsed ? 'lg:hidden' : '')}>Catálogo Online</span>
                <ExternalLink className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              </a>
            )}

            {!isCollapsed && (
              <div className="text-[9.5px] text-gray-400 text-center font-medium select-none pt-0.5">
                AdegaFood • Painel Seguro
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
