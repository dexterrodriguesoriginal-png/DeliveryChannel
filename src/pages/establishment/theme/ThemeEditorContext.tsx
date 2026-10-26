import { createContext, useContext } from 'react';
import { Tenant } from '../../../types';
import { useThemeDraft } from './useThemeDraft';
import { useThemeControls } from './useThemeControls';
export type ThemeEditorContextValue = ReturnType<typeof useThemeDraft> &
  ReturnType<typeof useThemeControls> & { activeTenant: Tenant };
export const ThemeEditorContext = createContext<ThemeEditorContextValue | null>(null);
export function useThemeEditorContext() {
  const context = useContext(ThemeEditorContext);
  if (!context) throw new Error('Theme editor context is missing');
  return context;
}
