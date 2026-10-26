import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { ThemeEditorShell } from './theme/ThemeEditorShell';

export const ThemePage: React.FC = () => {
  const { activeTenant } = useAuth();
  return activeTenant ? <ThemeEditorShell key={activeTenant.id} tenant={activeTenant} /> : null;
};
