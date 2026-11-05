import React, { useId, useState } from 'react';
import { Smartphone, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canManageMenuTheme } from '../../repositories/menuThemeRepository';
import { ThemeEditorShell } from './theme/ThemeEditorShell';
import { MenuThemeEditor } from './theme/menu/MenuThemeEditor';
import type { Tenant } from '../../types';
import './theme/menu/menuThemeEditor.css';

function DesignWorkspace({ tenant }: { tenant: Tenant }) {
  const { securityContext } = useAuth();
  const [tab, setTab] = useState<'app' | 'menu'>('app');
  const [openedMenu, setOpenedMenu] = useState(false);
  const id = useId();
  const canEditMenu = canManageMenuTheme(securityContext, tenant.id);
  return <div className="theme-design-workspace">
    <div className="theme-design-tabs" role="tablist" aria-label="Qual design editar" onKeyDown={event => {
      if (!canEditMenu || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'app' : event.key === 'End' ? 'menu' : tab === 'app' ? 'menu' : 'app';
      setTab(next); if (next === 'menu') setOpenedMenu(true);
      document.getElementById(`${id}-${next}-tab`)?.focus();
    }}>
      <button type="button" id={`${id}-app-tab`} role="tab" tabIndex={tab === 'app' ? 0 : -1} aria-selected={tab === 'app'} aria-controls={`${id}-app-panel`} onClick={() => setTab('app')}><Smartphone size={16} /> Design do App</button>
      {canEditMenu && <button type="button" id={`${id}-menu-tab`} role="tab" tabIndex={tab === 'menu' ? 0 : -1} aria-selected={tab === 'menu'} aria-controls={`${id}-menu-panel`} onClick={() => { setOpenedMenu(true); setTab('menu'); }}><UtensilsCrossed size={16} /> Design do Cardápio</button>}
    </div>
    <div className="theme-design-panel" id={`${id}-app-panel`} role="tabpanel" aria-labelledby={`${id}-app-tab`} hidden={tab !== 'app'}><ThemeEditorShell tenant={tenant} active={tab === 'app'} /></div>
    {openedMenu && canEditMenu && <div className="theme-design-panel" id={`${id}-menu-panel`} role="tabpanel" aria-labelledby={`${id}-menu-tab`} hidden={tab !== 'menu'}><MenuThemeEditor tenant={tenant} active={tab === 'menu'} /></div>}
  </div>;
}

export const ThemePage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  return activeTenant ? <DesignWorkspace key={`${activeTenant.id}:${securityContext.userId}:${securityContext.userRole}`} tenant={activeTenant} /> : null;
};
