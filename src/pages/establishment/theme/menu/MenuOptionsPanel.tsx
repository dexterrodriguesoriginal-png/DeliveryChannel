import { useUnsavedChanges } from '../../../../lib/ui/useUnsavedChanges';
import { useEffect, useRef, useState } from 'react';
import { Monitor, Save, Type } from 'lucide-react';
import type { SecurityContext } from '../../../../services/securityEngine';
import type { MenuOptions } from '../../../../types/menuOptions';
import { menuOptionsRepository } from '../../../../repositories/menuOptionsRepository';
import { DEFAULT_HOME_LABEL, MAX_HOME_LABEL_LENGTH, sanitizeHomeLabel } from '../../../../lib/menu/homeLabel';
import { DEFAULT_MENU_OPTIONS, MAX_IDLE_SECONDS, MIN_IDLE_SECONDS, isValidMenuOptions } from '../../../../lib/menu/menuOptions';

import { totemPublicUrl } from '../../../../lib/menu/totemAccess';

const same = (a: MenuOptions, b: MenuOptions) => JSON.stringify(a) === JSON.stringify(b);

/** Opções operacionais do cardápio da mesa (modo totem). Salvam separadas do visual. */
export function MenuOptionsPanel({ securityContext, tenantId, slug, onDraftChange }: { securityContext: SecurityContext; tenantId: string; slug: string; onDraftChange?: (draft: MenuOptions, dirty: boolean, loading: boolean) => void }) {
  const [saved, setSaved] = useState<MenuOptions>({ ...DEFAULT_MENU_OPTIONS });
  const [draft, setDraft] = useState<MenuOptions>({ ...DEFAULT_MENU_OPTIONS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const dirty = !same(saved, draft);
  useUnsavedChanges(dirty);
  useEffect(() => { onDraftChange?.(draft, dirty, loading || !!error); }, [draft, dirty, loading, error, onDraftChange]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    menuOptionsRepository.load(securityContext, tenantId).then(options => {
      if (active) { setSaved(options); setDraft(options); }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as opções.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, securityContext.userId, securityContext.userRole, securityContext.tenantId]);

  const save = async () => {
    const clean = { ...draft, homeLabel: sanitizeHomeLabel(draft.homeLabel) };
    if (loading || inFlight.current || !dirty || !isValidMenuOptions(clean)) return;
    inFlight.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const options = await menuOptionsRepository.save(securityContext, tenantId, clean);
      setSaved(options); setDraft(options); setNotice('Opções do cardápio salvas.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar. Suas alterações continuam aqui.');
    } finally { setSaving(false); inFlight.current = false; }
  };

  const totemUrl = totemPublicUrl(window.location.origin, slug);
  const invalid = !isValidMenuOptions({ ...draft, homeLabel: sanitizeHomeLabel(draft.homeLabel) });
  return <section className="menu-design-section" data-testid="menu-options-panel">
    <div className="menu-design-section-title"><Type size={18} /><div><h2>Nome do botão do cardápio</h2><p>Como o bloco aparece na tela inicial do QR da mesa.</p></div></div>
    <fieldset disabled={loading || saving}>
      <label className="menu-design-color"><span>Texto do botão (até {MAX_HOME_LABEL_LENGTH} caracteres)</span>
        <input type="text" aria-label="Nome do botão do cardápio" maxLength={MAX_HOME_LABEL_LENGTH} placeholder={DEFAULT_HOME_LABEL} value={draft.homeLabel}
          onChange={event => { setDraft({ ...draft, homeLabel: event.target.value }); setNotice(''); }}
          onBlur={() => setDraft(current => ({ ...current, homeLabel: sanitizeHomeLabel(current.homeLabel) }))} /></label>
    </fieldset>
    <div className="menu-design-section-title"><Monitor size={18} /><div><h2>Modo totem</h2><p>Tela cheia e reinício automático para tablets e celulares fixos na mesa.</p></div></div>
    {error && <div role="alert" className="menu-design-error">{error}</div>}
    <fieldset disabled={loading || saving}>
      <label className="menu-design-color"><span>Ativar modo totem</span>
        <input type="checkbox" aria-label="Modo totem" checked={draft.totemMode} onChange={event => { setDraft({ ...draft, totemMode: event.target.checked }); setNotice(''); }} /></label>
      <label className="menu-design-color"><span>Segundos sem toque até perguntar “Ainda está aí?” ({MIN_IDLE_SECONDS} a {MAX_IDLE_SECONDS})</span>
        <input type="number" aria-label="Tempo de inatividade em segundos" min={MIN_IDLE_SECONDS} max={MAX_IDLE_SECONDS} step={5} value={draft.idleSeconds} disabled={!draft.totemMode}
          onChange={event => { setDraft({ ...draft, idleSeconds: Number(event.target.value) }); setNotice(''); }} /></label>
      <label className="menu-design-color"><span>Modo de atendimento da loja</span>
        <select aria-label="Modo de atendimento" value={draft.serviceMode} onChange={event => setDraft({ ...draft, serviceMode: event.target.value as MenuOptions['serviceMode'] })}>
          <option value="TABLE">Mesa (QR da mesa)</option>
          <option value="COUNTER">Totem balcão (pré-configuração)</option>
          <option value="BOTH">Ambos (pré-configuração do balcão)</option>
        </select>
      </label>
      {draft.serviceMode !== 'TABLE' && <p role="status" className="theme-save-status">O totem do salão já está disponível em /totem/:slug. {totemUrl && <a href={totemUrl} target="_blank" rel="noopener noreferrer">Abrir totem do salão</a>} O acesso exige autorização do dispositivo. Esta opção não altera as regras de pagamento e retirada.</p>}
      <label className="menu-design-color"><span>Produtos por fileira (tablet e totem)</span>
        <select aria-label="Produtos por fileira" value={draft.productColumns} onChange={event => setDraft({ ...draft, productColumns: Number(event.target.value) as 1 | 2 | 3 })}>
          <option value={1}>1 produto</option><option value={2}>2 produtos</option><option value={3}>3 produtos</option>
        </select>
      </label>
      <p className="text-xs">No celular, a apresentação se adapta à largura disponível. Confira as fileiras na prévia de tablet. O modo totem e a inatividade são opções de atendimento; o visual do totem é editado em Design do Totem.</p>
      <label className="menu-design-color"><span>Usar os mesmos banners do app do cliente no Outdoor</span>
        <input type="checkbox" aria-label="Usar os mesmos banners do app" checked={draft.reuseAppBanners} onChange={event => setDraft({ ...draft, reuseAppBanners: event.target.checked })} />
      </label>
      {invalid && <div role="status" className="menu-design-contrast">Informe um tempo entre {MIN_IDLE_SECONDS} e {MAX_IDLE_SECONDS} segundos.</div>}
    </fieldset>
    <div className="theme-action-buttons">
      <span role="status" className="theme-save-status">{dirty ? 'Alterações não salvas' : notice || (loading ? 'Carregando…' : 'Painel salvo')}</span>
      <button type="button" className="theme-primary" disabled={!dirty || saving || loading || invalid} onClick={() => void save()}><Save size={15} />{saving ? 'Salvando…' : 'Salvar opções'}</button>
    </div>
  </section>;
}
