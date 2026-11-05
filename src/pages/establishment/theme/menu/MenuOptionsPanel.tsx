import { useEffect, useRef, useState } from 'react';
import { Monitor, Save } from 'lucide-react';
import type { SecurityContext } from '../../../../services/securityEngine';
import type { MenuOptions } from '../../../../types/menuOptions';
import { menuOptionsRepository } from '../../../../repositories/menuOptionsRepository';
import { DEFAULT_MENU_OPTIONS, MAX_IDLE_SECONDS, MIN_IDLE_SECONDS, isValidMenuOptions } from '../../../../lib/menu/menuOptions';

const same = (a: MenuOptions, b: MenuOptions) => JSON.stringify(a) === JSON.stringify(b);

/** Opções operacionais do cardápio da mesa (modo totem). Salvam separadas do visual. */
export function MenuOptionsPanel({ securityContext, tenantId }: { securityContext: SecurityContext; tenantId: string }) {
  const [saved, setSaved] = useState<MenuOptions>({ ...DEFAULT_MENU_OPTIONS });
  const [draft, setDraft] = useState<MenuOptions>({ ...DEFAULT_MENU_OPTIONS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const dirty = !same(saved, draft);

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
    if (loading || inFlight.current || !dirty || !isValidMenuOptions(draft)) return;
    inFlight.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const options = await menuOptionsRepository.save(securityContext, tenantId, draft);
      setSaved(options); setDraft(options); setNotice('Modo totem salvo.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar. Suas alterações continuam aqui.');
    } finally { setSaving(false); inFlight.current = false; }
  };

  const invalid = !isValidMenuOptions(draft);
  return <section className="menu-design-section" data-testid="menu-options-panel">
    <div className="menu-design-section-title"><Monitor size={18} /><div><h2>Modo totem</h2><p>Tela cheia e reinício automático para tablets e celulares fixos na mesa.</p></div></div>
    {error && <div role="alert" className="menu-design-error">{error}</div>}
    <fieldset disabled={loading || saving}>
      <label className="menu-design-color"><span>Ativar modo totem</span>
        <input type="checkbox" aria-label="Modo totem" checked={draft.totemMode} onChange={event => { setDraft({ ...draft, totemMode: event.target.checked }); setNotice(''); }} /></label>
      <label className="menu-design-color"><span>Segundos sem toque até perguntar “Ainda está aí?” ({MIN_IDLE_SECONDS} a {MAX_IDLE_SECONDS})</span>
        <input type="number" aria-label="Tempo de inatividade em segundos" min={MIN_IDLE_SECONDS} max={MAX_IDLE_SECONDS} step={5} value={draft.idleSeconds} disabled={!draft.totemMode}
          onChange={event => { setDraft({ ...draft, idleSeconds: Number(event.target.value) }); setNotice(''); }} /></label>
      {invalid && <div role="status" className="menu-design-contrast">Informe um tempo entre {MIN_IDLE_SECONDS} e {MAX_IDLE_SECONDS} segundos.</div>}
    </fieldset>
    <div className="theme-action-buttons">
      <span role="status" className="theme-save-status">{notice || (dirty ? 'Alterações não salvas' : '')}</span>
      <button type="button" className="theme-primary" disabled={!dirty || saving || loading || invalid} onClick={() => void save()}><Save size={15} />{saving ? 'Salvando…' : 'Salvar modo totem'}</button>
    </div>
  </section>;
}
