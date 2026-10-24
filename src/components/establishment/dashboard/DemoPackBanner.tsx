import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '../../ui/Button';
import { demoPackService, DemoPackReview, DemoReviewItem } from '../../../services/demoPackService';

type DemoChoice = 'keep' | 'remove' | 'selection';
const GROUPS = [
  { kind: 'category', label: 'Categorias' },
  { kind: 'product', label: 'Produtos' },
  { kind: 'offer', label: 'Ofertas' },
] as const;

/** Mantém os vínculos visíveis coerentes com os itens que o dono escolheu guardar. */
export function updateDemoSelection(items: DemoReviewItem[], selected: ReadonlySet<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(selected);
  const byId = new Map(items.map(item => [item.id, item]));
  const selectWithParents = (itemId: string) => {
    const item = byId.get(itemId);
    if (!item) return;
    next.add(item.id);
    if (item.categoryId) selectWithParents(item.categoryId);
    if (item.productId) selectWithParents(item.productId);
  };
  const deselectWithChildren = (itemId: string) => {
    next.delete(itemId);
    items.filter(item => item.categoryId === itemId || item.productId === itemId)
      .forEach(item => deselectWithChildren(item.id));
  };
  if (checked) selectWithParents(id);
  else deselectWithChildren(id);
  return next;
}

/** As três decisões usam os mesmos RPCs; uma seleção vazia remove só os demos. */
export async function submitDemoPackChoice(choice: DemoChoice, items: DemoReviewItem[], selected: ReadonlySet<string>): Promise<void> {
  if (choice === 'keep') {
    await demoPackService.keepDemoItems();
    return;
  }
  await demoPackService.removeDemoItems(choice === 'remove' ? null : items.filter(item => !selected.has(item.id)).map(item => item.id));
}

interface DemoPackBannerViewProps {
  items: DemoReviewItem[];
  selected: ReadonlySet<string>;
  choosing: boolean;
  busy: boolean;
  error?: string | null;
  onChoose: () => void;
  onCancel: () => void;
  onCheck: (id: string, checked: boolean) => void;
  onDecision: (choice: DemoChoice) => void | Promise<void>;
}

export function DemoPackBannerView({ items, selected, choosing, busy, error, onChoose, onCancel, onCheck, onDecision }: DemoPackBannerViewProps) {
  return <aside aria-labelledby="demo-pack-title" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5 space-y-3">
    <div className="flex gap-3">
      <Sparkles className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
      <div>
        <h2 id="demo-pack-title" className="font-bold text-amber-950">Seu catálogo de demonstração está pronto</h2>
        <p className="text-sm text-amber-900 mt-1">Preparamos exemplos para o seu segmento. Escolha o que deseja manter para começar.</p>
        <p className="text-xs text-amber-800 mt-1">A remoção afeta apenas itens Demo. Itens criados ou editados por você e itens já utilizados serão preservados.</p>
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {choosing ? <>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-3 max-h-80 overflow-y-auto rounded-xl border border-amber-200 bg-white p-3">
        <legend className="sr-only">Escolher os itens de demonstração que deseja manter</legend>
        {GROUPS.map(group => <div key={group.kind}>
          <h3 className="font-semibold text-sm text-gray-900 mb-2">{group.label}</h3>
          <div className="space-y-2">
            {items.filter(item => item.kind === group.kind).map(item => <label key={item.id} className="flex gap-2 items-start text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={selected.has(item.id)} onChange={event => onCheck(item.id, event.target.checked)} className="mt-1 accent-emerald-700" />
              <span>{item.name}</span>
            </label>)}
          </div>
        </div>)}
      </fieldset>
      <p className="text-xs text-amber-800">Marque o que deseja manter. As categorias e os produtos vinculados aos itens marcados também serão mantidos.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => onDecision('selection')}>Salvar seleção</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Voltar</Button>
      </div>
    </> : <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy} onClick={() => onDecision('keep')}>Manter tudo</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => onDecision('remove')}>Remover tudo</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onChoose}>Escolher o que manter</Button>
    </div>}
    {busy && <p role="status" className="text-xs text-amber-800">Salvando sua escolha...</p>}
  </aside>;
}

interface DemoPackBannerProps {
  tenantId: string;
  isOwner: boolean;
  onComplete?: () => void;
}

export function DemoPackBanner({ tenantId, isOwner, onComplete }: DemoPackBannerProps) {
  const [review, setReview] = useState<DemoPackReview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const version = useRef(0);

  useEffect(() => {
    const requestVersion = ++version.current;
    setReview(null);
    setSelected(new Set());
    setChoosing(false);
    setBusy(false);
    setError(null);
    if (isOwner) {
      demoPackService.getReview().then(result => {
        if (version.current !== requestVersion) return;
        if (result.tenantId !== tenantId) throw new Error('Não foi possível confirmar os itens de demonstração da sua loja.');
        setReview(result);
        setSelected(new Set(result.items.map(item => item.id)));
      }).catch(cause => {
        if (version.current === requestVersion) setError(cause?.message || 'Não foi possível carregar os itens de demonstração.');
      });
    }
    return () => { ++version.current; };
  }, [tenantId, isOwner, retry]);

  const submit = async (choice: DemoChoice) => {
    if (!review || review.tenantId !== tenantId || !isOwner || busy) return;
    const requestVersion = version.current;
    setBusy(true);
    setError(null);
    try {
      await submitDemoPackChoice(choice, review.items, selected);
      if (version.current !== requestVersion) return;
      setReview({ ...review, reviewed: true });
      onComplete?.();
    } catch (cause) {
      if (version.current === requestVersion) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar sua escolha. Tente novamente.');
    } finally {
      if (version.current === requestVersion) setBusy(false);
    }
  };

  if (!isOwner || review?.reviewed) return null;
  if (!review) return error ? <aside className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    <p role="alert">{error}</p>
    <Button type="button" variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>Tentar novamente</Button>
  </aside> : null;

  return <DemoPackBannerView items={review.items} selected={selected} choosing={choosing} busy={busy} error={error}
    onChoose={() => setChoosing(true)} onCancel={() => setChoosing(false)}
    onCheck={(id, checked) => setSelected(previous => updateDemoSelection(review.items, previous, id, checked))}
    onDecision={submit} />;
}
