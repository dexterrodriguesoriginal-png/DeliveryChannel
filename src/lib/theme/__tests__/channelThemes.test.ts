import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../templates';
import { menuFromTokens, totemFromTokens, resolveMenuTheme, resolveTotemDesign } from '../channelThemes';
import { DEFAULT_MENU_THEME, menuThemeContrastIssues } from '../menuTheme';
import { DEFAULT_TOTEM_DESIGN } from '../../menu/totemDesign';
import { totemContrastIssues } from '../channelThemeContrast';
import { tokensToTheme } from '../themeEngine';
import { mapPublicStorePayload } from '../../../repositories/publicStoreMapper';

describe('channel catalog and inheritance', () => {
  it('adapts all 500 templates with AA text contrast', () => {
    expect(TEMPLATES).toHaveLength(500);
    for (const template of TEMPLATES) {
      expect(menuThemeContrastIssues(menuFromTokens(template.tokens)), template.id).toEqual([]);
      expect(totemContrastIssues(totemFromTokens(template.tokens)), template.id).toEqual([]);
    }
  });
  it('preserves legacy and independent configurations after app changes', () => {
    for (const app of [tokensToTheme(TEMPLATES[0].tokens, { storeName: "Loja" } as never), tokensToTheme(TEMPLATES[100].tokens, { storeName: "Loja" } as never)]) {
      expect(resolveMenuTheme(DEFAULT_MENU_THEME, app)).toEqual(DEFAULT_MENU_THEME);
      expect(resolveTotemDesign(DEFAULT_TOTEM_DESIGN, app)).toEqual(DEFAULT_TOTEM_DESIGN);
      const custom = {...menuFromTokens(TEMPLATES[50].tokens), followApp:false};
      expect(resolveMenuTheme(custom, app)).toEqual(custom);
    }
  });
  it('follows app changes independently for menu and totem in public rendering', () => {
    const first = tokensToTheme(TEMPLATES[0].tokens, { storeName: "Loja" } as never);
    const second = tokensToTheme(TEMPLATES[200].tokens, { storeName: "Loja" } as never);
    const raw = {...DEFAULT_MENU_THEME,followApp:true};
    expect(resolveMenuTheme(raw, first)).not.toEqual(resolveMenuTheme(raw, second));
    expect(resolveTotemDesign({...DEFAULT_TOTEM_DESIGN,followApp:true}, first)).not.toEqual(resolveTotemDesign({...DEFAULT_TOTEM_DESIGN,followApp:true}, second));
    const payload = {tenant:{id:'t',slug:'loja',name:'Loja'},theme:{theme_tokens:second.tokens},menuTheme:raw};
    expect(mapPublicStorePayload(payload).menuTheme).toEqual(resolveMenuTheme(raw, second));
  });
});
