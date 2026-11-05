import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Edit3, ImagePlus, MonitorPlay, Plus, Trash2, Upload, Video, Youtube } from 'lucide-react';
import { parseYouTubeId, youTubeEmbedUrl, youTubeThumbnailUrl } from '../../lib/youtube';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { mediaRepository, type PublishedMedia } from '../../repositories/mediaRepository';
import { menuOutdoorRepository, type MenuOutdoorSlide, type MenuOutdoorSlideDraft } from '../../repositories/menuOutdoorRepository';
import { extractDateAndTimeFromIso, formatPromoDateTimeBr } from '../../utils/promoCardDateUtils';
import { canManageMenuOutdoor } from '../../lib/marketingTabs';
import type { Product } from '../../types';

interface Props {
  tenantId: string;
  viewerId: string;
  role?: string | null;
  products: Product[];
}

const fieldClass = 'mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15';
const dateInput = (iso: string | null) => {
  const parts = extractDateAndTimeFromIso(iso);
  return parts.date ? `${parts.date}T${parts.time}` : '';
};
type EditorMedia = { assetId: string; publicUrl: string; mediaType: 'IMAGE' | 'VIDEO' | 'YOUTUBE'; youtubeId?: string };
const dateIso = (value: string) => value ? new Date(`${value}:00-03:00`).toISOString() : null;

export function menuOutdoorStatus(slide: Pick<MenuOutdoorSlide, 'active' | 'startsAt' | 'endsAt'> & { mediaAvailable?: boolean }, now = Date.now()) {
  if (!slide.active) return 'Pausado';
  if (slide.mediaAvailable === false) return 'Sem mídia publicada';
  if (slide.endsAt && Date.parse(slide.endsAt) <= now) return 'Encerrado';
  if (slide.startsAt && Date.parse(slide.startsAt) > now) return 'Agendado';
  return 'No ar';
}

/** The keyed editor discards pending requests and drafts when tenant or identity changes. */
export function MenuOutdoorPanel(props: Props) {
  if (!canManageMenuOutdoor(props.role)) return null;
  return <MenuOutdoorEditor key={`${props.tenantId}:${props.viewerId}:${props.role}`} {...props} />;
}

function MenuOutdoorEditor({ tenantId, products }: Props) {
  const [slides, setSlides] = useState<MenuOutdoorSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<MenuOutdoorSlide | 'new' | null>(null);
  const [library, setLibrary] = useState<PublishedMedia[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [media, setMedia] = useState<EditorMedia | null>(null);
  const [youtubeLink, setYoutubeLink] = useState('');
  const [deleting, setDeleting] = useState<MenuOutdoorSlide | null>(null);
  const [title, setTitle] = useState('');
  const [productId, setProductId] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const alive = useRef(true);
  const saveLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const catalog = products.filter(product => product.tenantId === tenantId && product.isActive);

  useEffect(() => {
    alive.current = true;
    let current = true;
    menuOutdoorRepository.list(tenantId)
      .then(rows => { if (current) setSlides(rows); })
      .catch(() => { if (current) setError('Não foi possível carregar os banners. Tente novamente.'); })
      .finally(() => { if (current) setLoading(false); });
    menuOutdoorRepository.listPublishedMedia(tenantId)
      .then(rows => { if (current) setLibrary(rows); })
      .catch(() => { if (current) setLibraryError('Não foi possível carregar a biblioteca. Você ainda pode enviar uma nova mídia.'); });
    return () => { current = false; alive.current = false; };
  }, [tenantId]);

  const openEditor = (slide?: MenuOutdoorSlide) => {
    setError(''); setNotice('');
    setEditing(slide || 'new'); setLibraryOpen(false);
    setYoutubeLink('');
    setMedia(slide ? slide.youtubeId
      ? { assetId: '', publicUrl: youTubeThumbnailUrl(slide.youtubeId), mediaType: 'YOUTUBE', youtubeId: slide.youtubeId }
      : { assetId: slide.assetId, publicUrl: slide.videoUrl || slide.imageUrl || '', mediaType: slide.videoUrl ? 'VIDEO' : 'IMAGE' } : null);
    setTitle(slide?.title || ''); setProductId(slide?.productId || '');
    setSortOrder(String(slide?.sortOrder ?? (slides.length ? Math.max(...slides.map(row => row.sortOrder)) + 1 : 0)));
    setActive(slide?.active ?? true);
    setStartsAt(dateInput(slide?.startsAt || null)); setEndsAt(dateInput(slide?.endsAt || null));
  };

  const upload = async (file?: File) => {
    if (!file || uploading) return;
    setUploading(true); setError('');
    try {
      const published = await mediaRepository.uploadAndPublishCreative(tenantId, file);
      if (alive.current) {
        setMedia(published); setLibraryOpen(false);
        setLibrary(previous => [published, ...previous.filter(row => row.assetId !== published.assetId)]);
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Não foi possível publicar a mídia.');
    } finally { if (alive.current) setUploading(false); }
  };

  const applyYoutube = () => {
    const id = parseYouTubeId(youtubeLink);
    if (!id) { setError('Link do YouTube inválido. Use um link como youtube.com/watch?v=…, youtu.be/… ou youtube.com/shorts/….'); return; }
    setError(''); setLibraryOpen(false);
    setMedia({ assetId: '', publicUrl: youTubeThumbnailUrl(id), mediaType: 'YOUTUBE', youtubeId: id });
  };

  const confirmDelete = async () => {
    if (!deleting || saveLock.current) return;
    const target = deleting;
    saveLock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await menuOutdoorRepository.remove(tenantId, target.id);
      if (!alive.current) return;
      setSlides(previous => previous.filter(row => row.id !== target.id));
      setDeleting(null); setNotice('Banner excluído. A mídia continua disponível na sua biblioteca.');
    } catch (err) {
      if (alive.current) { setDeleting(null); setError(err instanceof Error ? err.message : 'Não foi possível excluir o banner.'); }
    } finally { saveLock.current = false; if (alive.current) setBusy(false); }
  };

  const persist = async (draft: MenuOutdoorSlideDraft) => {
    if (saveLock.current) return;
    saveLock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await menuOutdoorRepository.save(tenantId, draft);
      if (!alive.current) return;
      setSlides(previous => [...previous.filter(row => row.id !== saved.id), saved].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)));
      setEditing(null); setNotice('Outdoor atualizado. As alterações aparecem no cardápio.');
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Não foi possível salvar o banner.');
    } finally { saveLock.current = false; if (alive.current) setBusy(false); }
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!media || uploading || !editing) return;
    if (active && !media.publicUrl) {
      setError('Publique ou escolha outra mídia antes de ativar este banner.'); return;
    }
    const start = dateIso(startsAt), end = dateIso(endsAt);
    if (start && end && Date.parse(end) <= Date.parse(start)) {
      setError('O término precisa ser depois do início da exibição.'); return;
    }
    void persist({
      ...(editing === 'new' ? {} : { id: editing.id }),
      ...(media.mediaType === 'YOUTUBE' ? { youtubeId: media.youtubeId } : { assetId: media.assetId }),
      title, productId, sortOrder: Number(sortOrder), active, startsAt: start, endsAt: end,
    });
  };

  return <section className="space-y-6" aria-label="Outdoor do cardápio">
    <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-emerald-200"><MonitorPlay size={15} /> A primeira impressão abre o apetite</span>
          <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">Outdoor do cardápio</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">Fotos e vídeos em destaque no topo do cardápio da mesa. Um espaço próprio para suas novidades, separado dos cards promocionais do aplicativo.</p>
        </div>
        <Button onClick={() => openEditor()} disabled={loading || busy} size="lg" className="min-h-12 shrink-0 bg-emerald-400 text-slate-950 hover:bg-emerald-300" leftIcon={<Plus size={19} />}>Novo banner</Button>
      </div>
    </div>

    {error && !editing && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900"><Check size={18} />{notice}</p>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-lg font-black text-slate-900">Sua vitrine, do seu jeito</h3><p className="mt-1 text-sm text-slate-500">A sequência segue a ordem definida em cada banner.</p></div>
      <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">{slides.length} {slides.length === 1 ? 'banner' : 'banners'}</span>
    </div>

    {loading ? <div role="status" className="rounded-3xl border border-slate-200 p-10 text-center text-slate-500">Carregando sua vitrine…</div>
      : slides.length === 0 ? <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
        <ImagePlus className="mx-auto text-emerald-700" size={40} /><h3 className="mt-4 text-lg font-bold text-slate-900">Dê destaque ao que dá vontade</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">Escolha uma foto ou um vídeo e prepare a primeira cena do seu cardápio.</p>
        <Button onClick={() => openEditor()} className="mt-6 min-h-12">Criar primeiro banner</Button>
      </div> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {slides.map(slide => <article key={slide.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="relative aspect-video bg-slate-100">
            {slide.youtubeId ? <img src={youTubeThumbnailUrl(slide.youtubeId)} alt={slide.title || 'Vídeo do YouTube'} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              : slide.videoUrl ? <video src={slide.videoUrl} controls muted playsInline preload="metadata" className="h-full w-full object-cover" aria-label={slide.title || 'Vídeo do banner'} />
              : slide.imageUrl ? <img src={slide.imageUrl} alt={slide.title || 'Banner do cardápio'} loading="lazy" className="h-full w-full object-cover" />
                : <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500"><ImagePlus size={30} /><span className="text-sm">Mídia indisponível</span></div>}
            <span className="absolute left-3 top-3 rounded-full bg-slate-950/85 px-3 py-1 text-xs font-bold text-white">Ordem {slide.sortOrder}</span>
            {slide.youtubeId && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white"><Youtube size={14} />YouTube</span>}
          </div>
          <div className="p-5">
            <div className="flex items-start justify-between gap-2"><h4 className="font-bold text-slate-900">{slide.title || 'Banner sem título'}</h4><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${menuOutdoorStatus(slide) === 'No ar' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>{menuOutdoorStatus(slide)}</span></div>
            <p className="mt-2 text-xs text-slate-500">{slide.productId ? catalog.find(product => product.id === slide.productId)?.name || 'Produto indisponível' : 'Destaque sem link de produto'}</p>
            {(slide.startsAt || slide.endsAt) && <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-slate-600"><CalendarDays size={15} className="shrink-0" /><span>{slide.startsAt ? `De ${formatPromoDateTimeBr(slide.startsAt)}` : 'Início imediato'}<br />{slide.endsAt ? `Até ${formatPromoDateTimeBr(slide.endsAt)}` : 'Sem data de término'}</span></p>}
            <div className="mt-5 flex gap-2"><Button variant="outline" disabled={busy} onClick={() => openEditor(slide)} className="min-h-11 flex-1" leftIcon={<Edit3 size={16} />}>Editar</Button>
              <Button variant="ghost" disabled={busy || (!slide.active && !slide.mediaAvailable)} title={!slide.mediaAvailable && !slide.active ? 'Escolha uma mídia publicada para ativar' : undefined} className="min-h-11 flex-1" onClick={() => void persist({ ...slide, active: !slide.active })}>{slide.active ? 'Pausar' : 'Ativar'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => { setError(''); setDeleting(slide); }} aria-label={`Excluir ${slide.title || 'banner sem título'}`} className="min-h-11 text-red-700 hover:bg-red-50" leftIcon={<Trash2 size={16} />}>Excluir</Button></div>
          </div>
        </article>)}
      </div>}

    <Modal isOpen={editing !== null} onClose={() => { if (!busy && !uploading) setEditing(null); }} title={editing === 'new' ? 'Novo banner do cardápio' : 'Editar banner do cardápio'} description="Mídia horizontal fica ótima em celular, tablet e totem." size="xl">
      <form onSubmit={save} className="space-y-5">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              {media?.mediaType === 'YOUTUBE' && media.youtubeId ? <iframe src={youTubeEmbedUrl(media.youtubeId)} title="Prévia do vídeo do YouTube" allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" className="h-full w-full border-0" />
                : media?.publicUrl ? media.mediaType === 'VIDEO' ? <video src={media.publicUrl} controls muted playsInline className="h-full w-full object-cover" aria-label="Prévia do vídeo" /> : <img src={media.publicUrl} alt="Prévia do banner" className="h-full w-full object-cover" />
                : <div className="text-center text-slate-400"><MonitorPlay className="mx-auto mb-2" size={38} /><p className="text-sm">Sua próxima vitrine começa aqui</p></div>}
            </div>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" aria-label="Arquivo de imagem ou vídeo" className="sr-only" disabled={uploading || busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
            <Button type="button" variant="outline" isLoading={uploading} disabled={busy} onClick={() => fileInput.current?.click()} className="mt-3 min-h-12 w-full" leftIcon={<Upload size={17} />}>{media ? 'Trocar foto ou vídeo' : 'Escolher foto ou vídeo'}</Button>
            {media && !media.publicUrl && <p className="mt-3 text-sm text-amber-800">A mídia foi despublicada. Você pode pausar o banner ou escolher outra mídia para ativá-lo.</p>}
            <div className="mt-3 rounded-2xl border border-slate-200 p-3">
              <label className="block text-sm font-semibold text-slate-700">Ou use um vídeo do YouTube
                <input value={youtubeLink} onChange={e => setYoutubeLink(e.target.value)} maxLength={500} inputMode="url" placeholder="https://youtube.com/watch?v=…" className={fieldClass} disabled={busy || uploading} /></label>
              <Button type="button" variant="outline" disabled={busy || uploading || !youtubeLink.trim()} onClick={applyYoutube} className="mt-2 min-h-12 w-full" leftIcon={<Youtube size={17} />}>Usar link do YouTube</Button>
              <p className="mt-2 text-xs text-slate-500">O vídeo toca mudo e em repetição no cardápio.</p>
            </div>
            <Button type="button" variant="ghost" disabled={busy || uploading} onClick={() => setLibraryOpen(value => !value)} className="mt-2 min-h-12 w-full">Usar mídia da biblioteca</Button>
            {libraryOpen && <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 p-3" aria-label="Biblioteca de mídia publicada">
              <p className="text-xs font-semibold text-slate-600">Mídias publicadas desta loja</p>
              {libraryError && <p role="alert" className="text-sm text-amber-800">{libraryError}</p>}
              {library.length === 0 && !libraryError && <p className="text-sm text-slate-500">Nenhuma mídia publicada. Envie uma foto ou um vídeo acima.</p>}
              <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">{library.map((asset, index) => <button type="button" key={asset.assetId} onClick={() => { setMedia(asset); setLibraryOpen(false); }} aria-label={`Selecionar ${asset.mediaType === 'VIDEO' ? 'vídeo' : 'imagem'} ${index + 1}`} className="relative aspect-video min-h-16 overflow-hidden rounded-lg border-2 border-slate-200 bg-slate-100 focus:border-emerald-600">
                {asset.mediaType === 'VIDEO' ? <><video src={asset.publicUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" /><Video size={20} className="absolute right-2 top-2 text-white" /></> : <img src={asset.publicUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </button>)}</div>
            </div>}
            <p className="mt-3 flex gap-2 text-xs leading-relaxed text-slate-500"><Video size={16} className="shrink-0" />JPG, PNG ou WEBP até 5 MB. MP4 ou WEBM com até 5 minutos e 50 MB (maior que isso, use um link do YouTube). A mídia é publicada pelo mesmo fluxo seguro da sua biblioteca de marketing.</p>
          </div>
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-slate-700">Título do banner <span className="font-normal text-slate-400">(opcional)</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Hoje é dia de experimentar algo novo" className={fieldClass} /></label>
            <label className="block text-sm font-semibold text-slate-700">Ao tocar no banner<select value={productId} onChange={e => setProductId(e.target.value)} className={fieldClass}><option value="">Só exibir o destaque</option>{catalog.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
            <label className="block text-sm font-semibold text-slate-700">Ordem de exibição<input type="number" min="0" max="9999" required value={sortOrder} onChange={e => setSortOrder(e.target.value)} className={fieldClass} /></label>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-5 w-5 accent-emerald-700" />Banner ativo</label>
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4"><h4 className="flex items-center gap-2 text-sm font-bold text-slate-800"><CalendarDays size={17} />Agendamento opcional</h4><p className="mt-1 text-xs text-slate-500">Horário de Brasília. Deixe vazio para exibir sem limite de período.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Início<input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className={fieldClass} /></label><label className="text-sm font-semibold text-slate-700">Término<input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className={fieldClass} /></label></div></div>
        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><Button type="button" variant="outline" disabled={busy || uploading} onClick={() => setEditing(null)} className="min-h-12">Cancelar</Button><Button type="submit" isLoading={busy} disabled={!media || uploading} className="min-h-12">Salvar banner</Button></div>
      </form>
    </Modal>

    <Modal isOpen={deleting !== null} onClose={() => { if (!busy) setDeleting(null); }} title="Excluir banner?" description="O banner sai do cardápio na hora. Essa ação não pode ser desfeita." size="sm">
      <p className="text-sm text-slate-700">Excluir <strong>{deleting?.title || 'Banner sem título'}</strong>? A foto ou o vídeo continua na sua biblioteca de mídia.</p>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleting(null)} className="min-h-12">Cancelar</Button>
        <Button type="button" isLoading={busy} onClick={() => void confirmDelete()} className="min-h-12 bg-red-600 text-white hover:bg-red-700" leftIcon={<Trash2 size={16} />}>Excluir banner</Button>
      </div>
    </Modal>
  </section>;
}
