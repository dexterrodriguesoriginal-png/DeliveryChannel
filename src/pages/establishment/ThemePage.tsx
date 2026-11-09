import React, { useId, useState } from 'react';
import { MonitorPlay, Smartphone, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canManageMenuTheme } from '../../repositories/menuThemeRepository';
import { ThemeEditorShell } from './theme/ThemeEditorShell';
import { MenuThemeEditor } from './theme/menu/MenuThemeEditor';
import { DesignTotemEditor } from './theme/totem/DesignTotemEditor';
import type { Tenant } from '../../types';
import './theme/menu/menuThemeEditor.css';

type DesignTab = 'app' | 'menu' | 'totem';

function DesignWorkspace({ tenant }: { tenant: Tenant }) {
  const { securityContext } = useAuth();
  const [tab, setTab] = useState<DesignTab>('app');
  const [openedMenu, setOpenedMenu] = useState(false);
  const [openedTotem, setOpenedTotem] = useState(false);
  const id = useId();
  const canEditMenu = canManageMenuTheme(securityContext, tenant.id);

  const tabs: DesignTab[] = [
    'app',
    ...(canEditMenu ? (['menu'] as const) : []),
    ...(canEditMenu ? (['totem'] as const) : []),
  ];

  function selectTab(next: DesignTab) {
    setTab(next);
    if (next === 'menu') setOpenedMenu(true);
    if (next === 'totem') setOpenedTotem(true);
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
        {canEditMenu && (
          <button type="button" id={`${id}-totem-tab`} role="tab" tabIndex={tab === 'totem' ? 0 : -1}
            aria-selected={tab === 'totem'} aria-controls={`${id}-totem-panel`} onClick={() => selectTab('totem')}>
            <MonitorPlay size={16} /> Design do Totem
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
      {openedTotem && canEditMenu && (
        <div className="theme-design-panel" id={`${id}-totem-panel`} role="tabpanel" aria-labelledby={`${id}-totem-tab`} hidden={tab !== 'totem'}>
          <DesignTotemEditor tenant={tenant} active={tab === 'totem'} />
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
