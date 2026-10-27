import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { TenantTheme } from '../../../types';
import { StoreTemplate, ThemeTokens } from '../../../types/theme';
import { themeToTokens, tokensToTheme } from '../../../lib/theme/themeEngine';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (a: TenantTheme, b: TenantTheme) => JSON.stringify(a) === JSON.stringify(b);
interface DraftState {
  saved: TenantTheme;
  draft: TenantTheme;
  history: TenantTheme[];
}
type Action =
  | { type: 'edit'; value: React.SetStateAction<TenantTheme> }
  | { type: 'undo' | 'cancel' }
  | { type: 'saved'; value: TenantTheme; submitted: TenantTheme }
  | { type: 'external'; value: TenantTheme };
function reducer(state: DraftState, action: Action): DraftState {
  switch (action.type) {
    case 'edit': {
      const next = typeof action.value === 'function' ? action.value(state.draft) : action.value;
      if (equal(next, state.draft)) return state;
      return { ...state, draft: copy(next), history: [...state.history.slice(-49), state.draft] };
    }
    case 'undo':
      return state.history.length
        ? { ...state, draft: state.history.at(-1)!, history: state.history.slice(0, -1) }
        : state;
    case 'cancel':
      return { ...state, draft: copy(state.saved), history: [] };
    case 'saved':
      return {
        saved: copy(action.value),
        draft: equal(state.draft, action.submitted) ? copy(action.value) : state.draft,
        history: [],
      };
    case 'external': {
      if (equal(state.saved, action.value)) return state;
      return {
        saved: copy(action.value),
        draft: equal(state.draft, state.saved) ? copy(action.value) : state.draft,
        history: [],
      };
    }
  }
}

/** A tenant-scoped draft. Applying a model never writes to the backend. */
export function useThemeDraft(savedTheme: TenantTheme) {
  const [state, dispatch] = useReducer(reducer, savedTheme, (saved) => ({
    saved: copy(saved),
    draft: copy(saved),
    history: [],
  }));
  useEffect(() => {
    dispatch({ type: 'external', value: savedTheme });
  }, [savedTheme]);
  const setDraftTheme = useCallback(
    (value: React.SetStateAction<TenantTheme>) => dispatch({ type: 'edit', value }),
    []
  );
  const draftTokens = useMemo(() => themeToTokens(state.draft), [state.draft]);
  const updateTokens = useCallback(
    (fn: (tokens: ThemeTokens) => ThemeTokens) => {
      setDraftTheme((prev) => tokensToTheme(fn(themeToTokens(prev)), prev));
    },
    [setDraftTheme]
  );
  const applyTemplate = useCallback(
    (template: StoreTemplate) => {
      updateTokens((prev) => ({
        ...copy(template.tokens),
        // O modelo troca o visual, mas as cores das barras do sistema escolhidas pela loja são preservadas.
        meta: {
          ...copy(template.tokens.meta || {}),
          templateId: template.id,
          ...(prev.meta?.systemBars ? { systemBars: copy(prev.meta.systemBars) } : {}),
        },
      }));
    },
    [updateTokens]
  );
  return {
    draftTheme: state.draft,
    draftTokens,
    setDraftTheme,
    updateTokens,
    applyTemplate,
    isDirty: !equal(state.draft, state.saved),
    canUndo: state.history.length > 0,
    undo: () => dispatch({ type: 'undo' }),
    cancel: () => dispatch({ type: 'cancel' }),
    markSaved: (value: TenantTheme, submitted: TenantTheme) =>
      dispatch({ type: 'saved', value, submitted }),
  };
}
