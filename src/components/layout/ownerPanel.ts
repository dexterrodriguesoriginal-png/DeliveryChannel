/**
 * 19/10: abas do painel do estabelecimento (dono/equipe) usam fundo cinza claro
 * (bg-slate-100) para destacar os cartões brancos. CEO e Security Lab mantêm o fundo atual.
 * Vitrine do cliente, app do entregador e cozinha não passam por esse layout.
 */
export function isOwnerPanelTab(tab: string): boolean {
  return !tab.startsWith('ceo-') && tab !== 'security-lab';
}
