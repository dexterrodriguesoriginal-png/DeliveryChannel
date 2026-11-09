import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LayoutList, Save, Trash2 } from 'lucide-react';
import type { SecurityContext } from '../../../../services/securityEngine';
import { menuHeaderRepository } from '../../../../repositories/menuHeaderRepository';
import {
  DEFAULT_MENU_HEADER,
  MENU_COVER_SIZE_TEXT,
  menuCoverFileError,
  type MenuHeaderSettings,
} from '../../../../lib/menu/menuHeader';

const same = (a: MenuHeaderSettings, b: MenuHeaderSettings) =>
  a.coverUrl === b.coverUrl && a.categoryMenuMode === b.categoryMenuMode;

/** Capa da loja (estilo Facebook/YouTube) e menu lateral do cardápio. Salva separado das cores. */
export function MenuHeaderPanel({ securityContext, tenantId }: { securityContext: SecurityContext; tenantId: string }) {
  const [saved, setSaved] = useState<MenuHeaderSettings>({ ...DEFAULT_MENU_HEADER });
  const [draft, setDraft] = useState<MenuHeaderSettings>({ ...DEFAULT_MENU_HEADER });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = !same(saved, draft);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice('');
    menuHeaderRepository.load(securityContext, tenantId).then(settings => {
      if (active) { setSaved(settings); setDraft(settings); }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a capa do cardápio.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, securityContext.userId, securityContext.userRole, securityContext.tenantId]);

  const pickFile = async (file: File | undefined) => {
    if (!file || inFlight.current) return;
    const problem = menuCoverFileError(file);
    if (problem) { setError(problem); return; }
    inFlight.current = true; setUploading(true); setError(''); setNotice('');
    try {
      const url = await menuHeaderRepository.uploadCover(securityContext, tenantId, file);
      setDraft(current => ({ ...current, coverUrl: url }));
      setNotice('Capa enviada. Clique em “Salvar capa e menu” para publicar.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar a capa.');
    } finally {
      setUploading(false); inFlight.current = false;
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (loading || inFlight.current || !dirty) return;
    inFlight.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const settings = await menuHeaderRepository.save(securityContext, tenantId, draft);
      setSaved(settings); setDraft(settings); setNotice('Capa e menu do cardápio salvos.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar. Suas alterações continuam aqui.');
    } finally { setSaving(false); inFlight.current = false; }
  };

  const busy = loading || saving || uploading;
  return <section className="menu-design-section" data-testid="menu-header-panel">
    <div className="menu-design-section-title"><ImagePlus size={18} /><div><h2>Capa da loja</h2><p>Imagem larga no topo do cardápio, atrás da logo, do nome e da mesa — igual capa de Facebook ou YouTube.</p></div></div>
    {error && <div role="alert" className="menu-design-error">{error}</div>}
    <p className="menu-design-cover-size" data-testid="menu-cover-size"><strong>Tamanho exato:</strong> {MENU_COVER_SIZE_TEXT}</p>
    <div className="menu-design-cover-preview" data-testid="menu-cover-preview">
      {draft.coverUrl
        ? <img src={draft.coverUrl} alt="Prévia da capa do cardápio" referrerPolicy="no-referrer" />
        : <span>Sem capa: o cardápio usa o cabeçalho padrão com as cores do tema.</span>}
    </div>
    <fieldset disabled={busy} className="menu-design-cover-actions">
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Enviar capa da loja" hidden
        onChange={event => void pickFile(event.target.files?.[0])} />
      <button type="button" className="theme-secondary" onClick={() => fileRef.current?.click()}>
        <ImagePlus size={15} />{uploading ? 'Enviando…' : draft.coverUrl ? 'Trocar capa' : 'Enviar capa'}
      </button>
      {draft.coverUrl && <button type="button" className="theme-secondary" onClick={() => { setDraft({ ...draft, coverUrl: null }); setNotice(''); }}>
        <Trash2 size={15} />Remover capa
      </button>}
    </fieldset>

    <div className="menu-design-section-title"><LayoutList size={18} /><div><h2>Menu de categorias</h2><p>Cartões na lateral esquerda do cardápio, com a imagem em cima e o nome embaixo.</p></div></div>
    <fieldset disabled={busy} role="radiogroup" aria-label="Imagem do menu de categorias">
      <label className="menu-design-color"><span>Ícone padrão (o sistema escolhe pelo nome da categoria)</span>
        <input type="radio" name="category-menu-mode" aria-label="Ícone padrão" checked={draft.categoryMenuMode === 'ICON'}
          onChange={() => { setDraft({ ...draft, categoryMenuMode: 'ICON' }); setNotice(''); }} /></label>
      <label className="menu-design-color"><span>Imagem própria (a foto cadastrada em cada categoria; sem foto, usa o ícone)</span>
        <input type="radio" name="category-menu-mode" aria-label="Imagem própria" checked={draft.categoryMenuMode === 'IMAGE'}
          onChange={() => { setDraft({ ...draft, categoryMenuMode: 'IMAGE' }); setNotice(''); }} /></label>
    </fieldset>
    <div className="theme-action-buttons">
      <span role="status" className="theme-save-status">{notice || (dirty ? 'Alterações não salvas' : '')}</span>
      <button type="button" className="theme-primary" disabled={!dirty || busy} onClick={() => void save()}><Save size={15} />{saving ? 'Salvando…' : 'Salvar capa e menu'}</button>
    </div>
  </section>;
}
