import React, { useEffect, useMemo, useState } from 'react';
import {
  Eye, ImagePlus, Monitor, RotateCcw, Save, Smartphone, UploadCloud,
} from 'lucide-react';
import type { Tenant } from '../../../../types';
import { useAuth } from '../../../../context/AuthContext';
import {
  ALL_HOME_ACTIONS,
  DEFAULT_HOME_DESIGN,
  HOME_TEMPLATES_FOR_EDITOR,
  getHomeTemplate,
  type HomeAction,
  type StoreHomeDesign,
} from '../../../../lib/storeHome/storeHome.model';
import {
  canManageStoreHome,
  storeHomeRepository,
} from '../../../../repositories/storeHomeRepository';
import { StoreHomeScreen } from '../../../../components/client/storeHome/StoreHomeScreen';

interface Props {
  tenant: Tenant;
  active?: boolean;
}

type ImageField = 'backgroundUrl' | 'topBannerUrl' | 'bottomBannerUrl';

const ACTION_LABELS: Record<HomeAction, string> = {
  MENU: 'Ver cardápio',
  TABLE: 'Estou na mesa',
  PICKUP: 'Pedir para retirar',
  DELIVERY: 'Pedir delivery',
  ACCOUNT: 'Minha conta',
  WAITER: 'Chamar garçom',
  BILL: 'Pedir a conta',
};

const IMAGE_FIELDS: Array<{ field: ImageField; label: string }> = [
  { field: 'backgroundUrl', label: 'Imagem de fundo' },
  { field: 'topBannerUrl', label: 'Banner superior' },
  { field: 'bottomBannerUrl', label: 'Banner inferior' },
];

export function StoreHomeEditor({ tenant, active = true }: Props) {
  const { securityContext } = useAuth();
  const allowed = canManageStoreHome(securityContext, tenant.id);

  const [draft, setDraft] = useState<StoreHomeDesign>(DEFAULT_HOME_DESIGN);
  const [published, setPublished] = useState<StoreHomeDesign | null>(null);
  const [revision, setRevision] = useState(0);
  const [segment, setSegment] = useState('TODOS');
  const [device, setDevice] = useState<'mobile' | 'totem'>('mobile');
  const [previewVersion, setPreviewVersion] = useState<'draft' | 'published'>('draft');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [remoteReady, setRemoteReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const segments = useMemo(
    () => [...new Set(['TODOS', ...HOME_TEMPLATES_FOR_EDITOR.map(t => t.segment)])],
    [],
  );

  const visibleTemplates = HOME_TEMPLATES_FOR_EDITOR.filter(
    template => segment === 'TODOS' || template.segment === segment,
  );

  const previewDesign = previewVersion === 'published' && published ? published : draft;
  const canWrite = allowed && remoteReady && !working && !uploading && active;

  useEffect(() => {
    if (!allowed || !active) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRemoteReady(false);
    setError('');
    setMessage('');
    setDirty(false);

    storeHomeRepository.loadPrivate(securityContext, tenant.id)
      .then(result => {
        if (cancelled) return;
        setDraft(result.draft);
        setPublished(result.published);
        setRevision(result.revision);
        setRemoteReady(true);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Não foi possível carregar o design.');
        setDraft({ ...DEFAULT_HOME_DESIGN, actions: [...DEFAULT_HOME_DESIGN.actions] });
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [tenant.id, securityContext.userId, securityContext.userRole, securityContext.tenantId, allowed, active]);

  if (!allowed) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950" role="status">
        Apenas o dono ou gerente desta loja pode editar a tela inicial.
      </section>
    );
  }

  function update<K extends keyof StoreHomeDesign>(field: K, value: StoreHomeDesign[K]) {
    setDraft(current => ({ ...current, [field]: value }));
    setDirty(true);
    setMessage('');
  }

  function applyTemplate(id: string) {
    update('templateId', getHomeTemplate(id).id);
    setPreviewVersion('draft');
  }

  function toggleAction(action: HomeAction) {
    if (action === 'MENU') return;
    const next = draft.actions.includes(action)
      ? draft.actions.filter(item => item !== action)
      : [...draft.actions, action];
    update('actions', next);
  }

  async function upload(field: ImageField, file?: File) {
    if (!file || !remoteReady) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const url = await storeHomeRepository.uploadImage(securityContext, tenant.id, file);
      update(field, url);
      setMessage('Imagem enviada. Salve o rascunho para manter essa alteração.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar imagem.');
    } finally {
      setUploading(false);
    }
  }

  async function saveDraft() {
    if (!canWrite) return;
    setWorking(true);
    setError('');
    setMessage('');
    try {
      const newRevision = await storeHomeRepository.saveDraft(securityContext, tenant.id, draft, revision);
      setRevision(newRevision);
      setDirty(false);
      setMessage('Rascunho salvo. O cliente ainda verá a versão publicada anteriormente.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar rascunho.');
    } finally {
      setWorking(false);
    }
  }

  async function publish() {
    if (!canWrite) return;
    setWorking(true);
    setError('');
    setMessage('');
    try {
      let nextRevision = revision;
      if (dirty || revision === 0) {
        nextRevision = await storeHomeRepository.saveDraft(securityContext, tenant.id, draft, revision);
        setRevision(nextRevision);
      }
      await storeHomeRepository.publish(securityContext, tenant.id, nextRevision);
      const updated = await storeHomeRepository.loadPrivate(securityContext, tenant.id);
      setDraft(updated.draft);
      setPublished(updated.published);
      setRevision(updated.revision);
      setDirty(false);
      setPreviewVersion('published');
      setMessage('Tela inicial publicada para este estabelecimento.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao publicar.');
    } finally {
      setWorking(false);
    }
  }

  function restoreDefault() {
    const confirmed = window.confirm(
      'Restaurar o design padrão no rascunho? A versão publicada continuará como está até você clicar em Publicar.',
    );
    if (!confirmed) return;
    setDraft({ ...DEFAULT_HOME_DESIGN, actions: [...DEFAULT_HOME_DESIGN.actions] });
    setDirty(true);
    setPreviewVersion('draft');
    setMessage('Padrão restaurado no rascunho. Clique em Publicar para aplicar aos clientes.');
  }

  const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900';
  const buttonClass = 'rounded-xl px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section className="space-y-6 py-5" aria-label="Editor da tela inicial" data-testid="store-home-editor">
      <div>
        <h2 className="text-2xl font-black text-slate-900">Tela Inicial</h2>
        <p className="mt-2 text-sm text-slate-600">
          Personalize a entrada da loja com modelos prontos. O grid central mantém o padrão Delivery Channel.
          Sem geração por IA.
        </p>
      </div>

      {loading && <p role="status" className="text-sm text-slate-600">Carregando design…</p>}

      {!remoteReady && !loading && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          A prévia pode ser editada localmente, mas salvar e publicar estão indisponíveis até a conexão com o backend.
        </p>
      )}

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <fieldset disabled={loading || working || uploading || !active} className="space-y-5 disabled:opacity-70">
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="mb-4 text-lg font-black">Modelos profissionais</h3>
              <label className="block text-sm font-bold">
                Segmento
                <select className={`${inputClass} mt-2`} value={segment} onChange={e => setSegment(e.target.value)}>
                  {segments.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {visibleTemplates.map(template => (
                  <button
                    type="button"
                    key={template.id}
                    aria-pressed={draft.templateId === template.id}
                    onClick={() => applyTemplate(template.id)}
                    className={[
                      'overflow-hidden rounded-xl border-2 bg-white text-left transition',
                      draft.templateId === template.id ? 'border-emerald-700' : 'border-slate-200',
                    ].join(' ')}
                  >
                    <div className="h-20 w-full" style={{ backgroundImage: template.topGradient }} />
                    <div className="p-3">
                      <strong className="block text-xs text-slate-900">{template.name}</strong>
                      <span className="text-[11px] text-slate-500">{template.segment}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-lg font-black">Textos da tela</h3>
              {([
                ['headerTitle', 'Saudação', 80],
                ['tagline', 'Slogan sob a logo', 120],
                ['title', 'Pergunta central', 100],
                ['subtitle', 'Subtítulo', 150],
                ['footerTitle', 'Texto do banner inferior', 100],
              ] as const).map(([field, label, max]) => (
                <label key={field} className="block text-sm font-bold">
                  {label}
                  <input
                    className={`${inputClass} mt-2`}
                    value={draft[field]}
                    onChange={event => update(field, event.target.value)}
                    maxLength={max}
                  />
                </label>
              ))}
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-lg font-black">Imagens e banners</h3>
              {IMAGE_FIELDS.map(({ field, label }) => (
                <div key={field} className="space-y-2">
                  <label className="block text-sm font-bold">{label}</label>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-400 px-4 py-4 text-sm font-bold text-slate-700">
                    <ImagePlus size={18} />
                    Enviar imagem
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        void upload(field, file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {draft[field] ? (
                    <>
                      <img alt={`Prévia: ${label}`} src={draft[field]} className="h-24 w-full rounded-xl object-cover" />
                      <button type="button" className="text-xs font-bold text-red-700" onClick={() => update(field, '')}>
                        Remover imagem do design
                      </button>
                    </>
                  ) : null}
                </div>
              ))}
              <p className="text-xs text-slate-500">
                JPG, PNG ou WebP, até 5 MB. O envio usa o mesmo fluxo seguro da biblioteca de marketing.
              </p>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-lg font-black">Ajustes visuais</h3>
              <label className="block text-sm font-bold">
                Área ocupada pela imagem de fundo
                <select
                  className={`${inputClass} mt-2`}
                  value={draft.backgroundMode}
                  onChange={e => update('backgroundMode', e.target.value as StoreHomeDesign['backgroundMode'])}
                >
                  <option value="full">Tela inteira</option>
                  <option value="sections">Somente banners</option>
                </select>
              </label>
              <label className="block text-sm font-bold">
                Escurecimento: {Math.round(draft.overlayOpacity * 100)}%
                <input type="range" min={20} max={90} step={5} value={draft.overlayOpacity * 100}
                  onChange={e => update('overlayOpacity', Number(e.target.value) / 100)}
                  className="mt-3 w-full accent-emerald-700" />
              </label>
              <label className="block text-sm font-bold">
                Desfoque do fundo: {draft.backgroundBlur}px
                <input type="range" min={0} max={20} step={1} value={draft.backgroundBlur}
                  onChange={e => update('backgroundBlur', Number(e.target.value))}
                  className="mt-3 w-full accent-emerald-700" />
              </label>
              <label className="block text-sm font-bold">
                Enquadramento vertical: {draft.backgroundPositionY}%
                <input type="range" min={0} max={100} value={draft.backgroundPositionY}
                  onChange={e => update('backgroundPositionY', Number(e.target.value))}
                  className="mt-3 w-full accent-emerald-700" />
              </label>
              <label className="block text-sm font-bold">
                Tamanho da logo: {draft.logoSize}px
                <input type="range" min={56} max={136} step={4} value={draft.logoSize}
                  onChange={e => update('logoSize', Number(e.target.value))}
                  className="mt-3 w-full accent-emerald-700" />
              </label>
              <label className="block text-sm font-bold">
                Posição da logo
                <select className={`${inputClass} mt-2`} value={draft.logoPosition}
                  onChange={e => update('logoPosition', e.target.value as StoreHomeDesign['logoPosition'])}>
                  <option value="center">Centralizada</option>
                  <option value="left">Alinhada à esquerda</option>
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm font-bold">
                <input type="checkbox" checked={draft.showFooter} onChange={e => update('showFooter', e.target.checked)} />
                Mostrar banner inferior
              </label>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-lg font-black">Botões da tela</h3>
              <p className="mb-4 text-xs text-slate-600">
                O cardápio é obrigatório. No cliente, ações de módulos desligados (delivery, retirada, salão) ficam ocultas automaticamente.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {ALL_HOME_ACTIONS.map(action => (
                  <label key={action} className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={draft.actions.includes(action)}
                      disabled={action === 'MENU'}
                      onChange={() => toggleAction(action)}
                    />
                    {ACTION_LABELS[action]}
                  </label>
                ))}
              </div>
            </section>
          </fieldset>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <button type="button" disabled={!canWrite} onClick={() => void saveDraft()}
              className={`${buttonClass} flex items-center gap-2 bg-slate-800 text-white`}>
              <Save size={17} /> Salvar rascunho
            </button>
            <button type="button" disabled={!canWrite} onClick={() => void publish()}
              className={`${buttonClass} flex items-center gap-2 bg-emerald-700 text-white`}>
              <UploadCloud size={17} /> Publicar
            </button>
            <button type="button" disabled={working || uploading || loading}
              onClick={restoreDefault}
              className={`${buttonClass} flex items-center gap-2 border border-slate-300 bg-white text-slate-800`}>
              <RotateCcw size={17} /> Restaurar padrão
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {dirty ? 'Existem alterações ainda não salvas.' : 'Nenhuma alteração pendente no rascunho.'}
          </p>
        </div>

        <div className="min-w-0">
          <div className="sticky top-4 space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-lg font-black"><Eye size={20} /> Prévia em tempo real</h3>
                <div className="flex gap-2">
                  <button type="button" aria-label="Prévia no celular" aria-pressed={device === 'mobile'}
                    onClick={() => setDevice('mobile')}
                    className={`${buttonClass} ${device === 'mobile' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>
                    <Smartphone size={18} />
                  </button>
                  <button type="button" aria-label="Prévia no totem" aria-pressed={device === 'totem'}
                    onClick={() => setDevice('totem')}
                    className={`${buttonClass} ${device === 'totem' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>
                    <Monitor size={18} />
                  </button>
                </div>
              </div>
              <div className="mb-4 flex gap-2">
                <button type="button" onClick={() => setPreviewVersion('draft')} aria-pressed={previewVersion === 'draft'}
                  className={`${buttonClass} ${previewVersion === 'draft' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
                  Rascunho
                </button>
                <button type="button" onClick={() => setPreviewVersion('published')} disabled={!published}
                  aria-pressed={previewVersion === 'published'}
                  className={`${buttonClass} ${previewVersion === 'published' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
                  Publicado
                </button>
              </div>
              <div className={[
                'mx-auto overflow-auto rounded-[26px] border-[7px] border-slate-900 bg-slate-900 shadow-2xl',
                device === 'mobile' ? 'w-full max-w-[390px] max-h-[650px]' : 'w-full max-w-[520px] max-h-[760px]',
              ].join(' ')} data-testid="store-home-preview-frame" data-device={device}>
                <StoreHomeScreen
                  preview
                  design={previewDesign}
                  storeName={tenant.theme?.storeName || tenant.name}
                  logoUrl={tenant.theme?.logoUrl}
                  tableName="Mesa 04"
                />
              </div>
              <p className="mt-3 text-center text-xs text-slate-500">
                Visualização ilustrativa. QR, mesa e módulos da loja mandam na navegação real.
              </p>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
