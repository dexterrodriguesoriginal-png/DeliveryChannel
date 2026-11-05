import React, { useId, useState } from 'react';
import { House, Smartphone, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canManageMenuTheme } from '../../repositories/menuThemeRepository';
import { canManageStoreHome } from '../../repositories/storeHomeRepository';
import { ThemeEditorShell } from './theme/ThemeEditorShell';
import { MenuThemeEditor } from './theme/menu/MenuThemeEditor';
import { StoreHomeEditor } from './theme/home/StoreHomeEditor';
import type { Tenant } from '../../types';
import './theme/menu/menuThemeEditor.css';

type DesignTab = 'app' | 'menu' | 'home';

function DesignWorkspace({ tenant }: { tenant: Tenant }) {
  const { securityContext } = useAuth();
  const [tab, setTab] = useState<DesignTab>('app');
  const [openedMenu, setOpenedMenu] = useState(false);
  const [openedHome, setOpenedHome] = useState(false);
  const id = useId();
  const canEditMenu = canManageMenuTheme(securityContext, tenant.id);
  const canEditHome = canManageStoreHome(securityContext, tenant.id);

  const tabs: DesignTab[] = [
    'app',
    ...(canEditMenu ? (['menu'] as const) : []),
    ...(canEditHome ? (['home'] as const) : []),
  ];

  function selectTab(next: DesignTab) {
    setTab(next);
    if (next === 'menu') setOpenedMenu(true);
    if (next === 'home') setOpenedHome(true);
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    selectTab(next);
    document.getElementById(`${id}-${next}-tab`)?.focus();
  }

  return (
    <div className="theme-design-workspace">
      <div className="theme-design-tabs" role="tablist" aria-label="Qual design editar" onKeyDown={onTabKeyDown}>
        <button type="button" id={`${id}-app-tab`} role="tab" tabIndex={tab === 'app' ? 0 : -1}
          aria-selected={tab === 'app'} aria-controls={`${id}-app-panel`} onClick={() => selectTab('app')}>
          <Smartphone size={16} /> Design do App
        </button>
        {canEditMenu && (
          <button type="button" id={`${id}-menu-tab`} role="tab" tabIndex={tab === 'menu' ? 0 : -1}
            aria-selected={tab === 'menu'} aria-controls={`${id}-menu-panel`} onClick={() => selectTab('menu')}>
            <UtensilsCrossed size={16} /> Design do Cardápio
          </button>
        )}
        {canEditHome && (
          <button type="button" id={`${id}-home-tab`} role="tab" tabIndex={tab === 'home' ? 0 : -1}
            aria-selected={tab === 'home'} aria-controls={`${id}-home-panel`} onClick={() => selectTab('home')}>
            <House size={16} /> Tela Inicial
          </button>
        )}
      </div>
      <div className="theme-design-panel" id={`${id}-app-panel`} role="tabpanel" aria-labelledby={`${id}-app-tab`} hidden={tab !== 'app'}>
        <ThemeEditorShell tenant={tenant} active={tab === 'app'} />
      </div>
      {openedMenu && canEditMenu && (
        <div className="theme-design-panel" id={`${id}-menu-panel`} role="tabpanel" aria-labelledby={`${id}-menu-tab`} hidden={tab !== 'menu'}>
          <MenuThemeEditor tenant={tenant} active={tab === 'menu'} />
        </div>
      )}
      {openedHome && canEditHome && (
        <div className="theme-design-panel" id={`${id}-home-panel`} role="tabpanel" aria-labelledby={`${id}-home-tab`} hidden={tab !== 'home'}>
          <StoreHomeEditor tenant={tenant} active={tab === 'home'} />
        </div>
      )}
    </div>
  );
}

export const ThemePage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  return activeTenant
    ? <DesignWorkspace key={`${activeTenant.id}:${securityContext.userId}:${securityContext.userRole}`} tenant={activeTenant} />
    : null;
};
