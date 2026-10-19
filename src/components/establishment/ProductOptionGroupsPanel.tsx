import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Save } from 'lucide-react';
import type { Product, ProductOptionGroup, ProductOptionPricingRule, ProductOptionGroupType } from '../../types';
import { productOptionRepository } from '../../repositories/productOptionRepository';
import { supabase } from '../../lib/supabase';
import { formatBRL } from '../../lib/pricing/money';
import { useToast } from '../../context/ToastContext';

const emptyGroup = {
  name: '', type: 'STANDARD' as ProductOptionGroupType, minSelect: 0, maxSelect: 1,
  allowRepeat: false, pricingRule: 'SUM' as ProductOptionPricingRule, active: true, sort: 0,
};

export const ProductOptionGroupsPanel: React.FC<{
  tenantId: string;
  products: Product[];
}> = ({ tenantId, products }) => {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<ProductOptionGroup[]>([]);
  const [available, setAvailable] = useState(true);
  const [productId, setProductId] = useState(products[0]?.id || '');
  const [linkedGroupIds, setLinkedGroupIds] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState(emptyGroup);
  const [optionGroupId, setOptionGroupId] = useState<string | null>(null);
  const [optionName, setOptionName] = useState('');
  const [optionPrice, setOptionPrice] = useState('0.00');
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editingOptionName, setEditingOptionName] = useState('');
  const [editingOptionPrice, setEditingOptionPrice] = useState('');
  const [bulkOptionIds, setBulkOptionIds] = useState<string[]>([]);
  const [bulkDelta, setBulkDelta] = useState('0.00');
  const [busy, setBusy] = useState(false);

  const loadGroups = useCallback(async () => {
    try {
      setGroups(await productOptionRepository.listForTenant(tenantId));
    } catch (error) {
      if ((error as { code?: string })?.code === 'ADDONS_UNAVAILABLE') {
        setAvailable(false);
        return;
      }
      showToast({ type: 'error', title: 'Erro ao carregar adicionais', message: (error as Error).message });
    }
  }, [tenantId, showToast]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);
  useEffect(() => { if (!productId && products[0]) setProductId(products[0].id); }, [productId, products]);

  useEffect(() => {
    let alive = true;
    async function loadLinks() {
      if (!productId) return setLinkedGroupIds([]);
      const { data, error } = await supabase.from('product_option_group_links')
        .select('group_id').eq('tenant_id', tenantId).eq('product_id', productId).order('sort');
      if (!alive) return;
      if (error) {
        if (['42P01', '42703', 'PGRST205'].includes(error.code || '')) { setAvailable(false); return; }
        showToast({ type: 'error', title: 'Erro ao carregar vínculos', message: error.message });
        return;
      }
      setLinkedGroupIds((data || []).map(row => row.group_id));
    }
    void loadLinks();
    return () => { alive = false; };
  }, [productId, tenantId, groups, showToast]);

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [groups]);

  if (!available) return null;
  const saveGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupForm.name.trim() || groupForm.minSelect < 0 || groupForm.maxSelect < groupForm.minSelect) return;
    setBusy(true);
    try {
      await productOptionRepository.saveGroup(tenantId, groupForm, editingGroupId || undefined);
      setGroupForm(emptyGroup); setEditingGroupId(null);
      await loadGroups();
    } catch (error) {
      showToast({ type: 'error', title: 'Erro ao salvar grupo', message: (error as Error).message });
    } finally { setBusy(false); }
  };
  const saveOption = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!optionGroupId || !optionName.trim()) return;
    setBusy(true);
    try {
      await productOptionRepository.saveOption(tenantId, optionGroupId, {
        name: optionName, extraPriceCents: Math.round(Number(optionPrice) * 100),
        active: true, soldOut: false, sort: groups.find(group => group.id === optionGroupId)?.options.length || 0,
      });
      setOptionName(''); setOptionPrice('0.00'); await loadGroups();
    } catch (error) {
      showToast({ type: 'error', title: 'Erro ao salvar opção', message: (error as Error).message });
    } finally { setBusy(false); }
  };
  const saveLinks = async () => {
    if (!productId) return;
    setBusy(true);
    try {
      await productOptionRepository.setProductGroups(tenantId, productId, linkedGroupIds);
      showToast({ type: 'success', title: 'Grupos atualizados', message: 'Os grupos foram vinculados ao produto.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Erro ao vincular grupos', message: (error as Error).message });
    } finally { setBusy(false); }
  };
  const updateGroupOrder = async (group: ProductOptionGroup, delta: number) => {
    const nextSort = Math.max(0, group.sort + delta);
    try { await productOptionRepository.saveGroup(tenantId, { ...group, sort: nextSort }); await loadGroups(); }
    catch (error) { showToast({ type: 'error', title: 'Erro ao ordenar grupos', message: (error as Error).message }); }
  };
  const updateOption = async (group: ProductOptionGroup, optionId: string, patch: { active?: boolean; soldOut?: boolean; sort?: number }) => {
    const option = group.options.find(item => item.id === optionId);
    if (!option) return;
    try {
      await productOptionRepository.saveOption(tenantId, group.id, { ...option, ...patch }, option.id);
      await loadGroups();
    } catch (error) { showToast({ type: 'error', title: 'Erro ao atualizar opção', message: (error as Error).message }); }
  };
  const saveOptionEdit = async (group: ProductOptionGroup, option: ProductOptionGroup['options'][number]) => {
    const price = Number(editingOptionPrice);
    if (!editingOptionName.trim() || !Number.isFinite(price) || price < 0) return;
    try {
      await productOptionRepository.saveOption(tenantId, group.id, {
        ...option,
        name: editingOptionName,
        extraPriceCents: Math.round(price * 100),
      }, option.id);
      setEditingOptionId(null);
      await loadGroups();
    } catch (error) { showToast({ type: 'error', title: 'Erro ao salvar opção', message: (error as Error).message }); }
  };
  const applyBulkPrice = async () => {
    const delta = Math.round(Number(bulkDelta) * 100);
    if (!bulkOptionIds.length || !Number.isFinite(delta)) return;
    setBusy(true);
    try {
      await productOptionRepository.changeOptionPrices(tenantId, bulkOptionIds, delta);
      setBulkOptionIds([]); setBulkDelta('0.00'); await loadGroups();
    } catch (error) { showToast({ type: 'error', title: 'Erro ao alterar preços', message: (error as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 space-y-5" data-testid="product-option-groups-library">
      <header>
        <h2 className="text-base font-extrabold text-gray-900">Grupos de adicionais</h2>
        <p className="text-xs text-gray-500">Crie grupos reutilizáveis e vincule-os a vários produtos. As alterações de preço e esgotado valem para todos os produtos vinculados.</p>
      </header>
      <form onSubmit={saveGroup} className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-end border-b border-gray-100 pb-4">
        <label className="col-span-2 text-xs font-semibold">Nome
          <input className="mt-1 w-full rounded-lg border p-2" value={groupForm.name} onChange={e => setGroupForm({ ...groupForm, name: e.target.value })} required maxLength={120} placeholder="Ex.: Adicionais" />
        </label>
        <label className="text-xs font-semibold">Tipo
          <select className="mt-1 w-full rounded-lg border p-2" value={groupForm.type} onChange={e => {
            const type = e.target.value as ProductOptionGroupType;
            setGroupForm({ ...groupForm, type, pricingRule: type === 'FLAVOR_SPLIT' ? 'HIGHEST' : 'SUM' });
          }}>
            <option value="STANDARD">Padrão</option><option value="FLAVOR_SPLIT">Meio a meio</option>
          </select>
        </label>
        <label className="text-xs font-semibold">Mínimo
          <input type="number" min="0" className="mt-1 w-full rounded-lg border p-2" value={groupForm.minSelect} onChange={e => setGroupForm({ ...groupForm, minSelect: Number(e.target.value) })} />
        </label>
        <label className="text-xs font-semibold">Máximo
          <input type="number" min={groupForm.minSelect} className="mt-1 w-full rounded-lg border p-2" value={groupForm.maxSelect} onChange={e => setGroupForm({ ...groupForm, maxSelect: Number(e.target.value) })} />
        </label>
        <label className="text-xs font-semibold">Regra de preço
          <select disabled={groupForm.type === 'STANDARD'} className="mt-1 w-full rounded-lg border p-2" value={groupForm.pricingRule} onChange={e => setGroupForm({ ...groupForm, pricingRule: e.target.value as ProductOptionPricingRule })}>
            <option value="SUM">Somar opções</option><option value="HIGHEST">Maior sabor</option><option value="AVERAGE">Média dos sabores</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={groupForm.allowRepeat} onChange={e => setGroupForm({ ...groupForm, allowRepeat: e.target.checked })} /> Permitir repetir opção</label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={groupForm.active} onChange={e => setGroupForm({ ...groupForm, active: e.target.checked })} /> Grupo ativo</label>
        <label className="text-xs font-semibold">Ordem
          <input type="number" min="0" className="mt-1 w-full rounded-lg border p-2" value={groupForm.sort} onChange={e => setGroupForm({ ...groupForm, sort: Number(e.target.value) })} />
        </label>
        <button disabled={busy} className="flex h-9 items-center justify-center gap-1 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">
          <Save className="h-4 w-4" /> {editingGroupId ? 'Salvar grupo' : 'Criar grupo'}
        </button>
        {editingGroupId && <button type="button" onClick={() => { setEditingGroupId(null); setGroupForm(emptyGroup); }} className="h-9 rounded-lg border px-3 text-xs">Cancelar edição</button>}
      </form>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <div className="space-y-3">
          <h3 className="text-sm font-bold">Biblioteca de grupos e opções</h3>
          {sortedGroups.map((group, index) => (
            <article key={group.id} className="rounded-xl border border-gray-200 p-3 space-y-2">
              <header className="flex items-center justify-between gap-2">
                <div><b className="text-sm">{group.name}</b><span className="ml-2 text-[10px] text-gray-500">{group.type === 'FLAVOR_SPLIT' ? 'Meio a meio' : 'Padrão'} · {group.minSelect}–{group.maxSelect} escolhas</span></div>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Subir grupo" disabled={index === 0} onClick={() => void updateGroupOrder(group, -1)}><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" aria-label="Descer grupo" disabled={index === sortedGroups.length - 1} onClick={() => void updateGroupOrder(group, 1)}><ChevronDown className="h-4 w-4" /></button>
                  <button type="button" className="text-xs font-bold text-emerald-700" onClick={() => { setEditingGroupId(group.id); setGroupForm({ name: group.name, type: group.type, minSelect: group.minSelect, maxSelect: group.maxSelect, allowRepeat: group.allowRepeat, pricingRule: group.pricingRule, active: group.active, sort: group.sort }); }}>Editar</button>
                </div>
              </header>
              {group.options.map(option => (
                <div key={option.id} className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-xs">
                  <input type="checkbox" aria-label={`Selecionar ${option.name} para alteração em lote`} checked={bulkOptionIds.includes(option.id)}
                    onChange={e => setBulkOptionIds(prev => e.target.checked ? [...prev, option.id] : prev.filter(id => id !== option.id))} />
                  {editingOptionId === option.id ? (
                    <>
                      <input value={editingOptionName} onChange={event => setEditingOptionName(event.target.value)} className="min-w-24 flex-1 rounded border p-1" aria-label="Nome da opção" />
                      <input value={editingOptionPrice} onChange={event => setEditingOptionPrice(event.target.value)} type="number" min="0" step="0.01" className="w-24 rounded border p-1" aria-label="Preço da opção em reais" />
                      <button type="button" onClick={() => void saveOptionEdit(group, option)} className="font-bold text-emerald-700">Salvar</button>
                      <button type="button" onClick={() => setEditingOptionId(null)} className="text-gray-500">Cancelar</button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-[6rem] flex-1">{option.name} · {formatBRL(option.extraPriceCents / 100)}</span>
                      <button type="button" onClick={() => { setEditingOptionId(option.id); setEditingOptionName(option.name); setEditingOptionPrice((option.extraPriceCents / 100).toFixed(2)); }} className="font-bold text-emerald-700">Editar</button>
                    </>
                  )}
                  <label className="flex items-center gap-1"><input type="checkbox" checked={option.active} onChange={e => void updateOption(group, option.id, { active: e.target.checked })} /> Ativa</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={option.soldOut} onChange={e => void productOptionRepository.setOptionSoldOut(tenantId, option.id, e.target.checked).then(loadGroups).catch(error => showToast({ type: 'error', title: 'Erro ao atualizar esgotado', message: error.message }))} /> Esgotado</label>
                  <button type="button" aria-label={`Subir ${option.name}`} onClick={() => void updateOption(group, option.id, { sort: Math.max(0, option.sort - 1) })}><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" aria-label={`Descer ${option.name}`} onClick={() => void updateOption(group, option.id, { sort: option.sort + 1 })}><ChevronDown className="h-4 w-4" /></button>
                </div>
              ))}
              <form onSubmit={saveOption} className="flex flex-wrap gap-2 pt-1">
                <input value={optionGroupId === group.id ? optionName : ''} onFocus={() => setOptionGroupId(group.id)} onChange={e => { setOptionGroupId(group.id); setOptionName(e.target.value); }} placeholder="Nova opção" className="min-w-32 flex-1 rounded-lg border p-2 text-xs" />
                <input value={optionGroupId === group.id ? optionPrice : '0.00'} onFocus={() => setOptionGroupId(group.id)} onChange={e => { setOptionGroupId(group.id); setOptionPrice(e.target.value); }} type="number" min="0" step="0.01" className="w-24 rounded-lg border p-2 text-xs" aria-label="Preço extra em reais" />
                <button disabled={busy || optionGroupId !== group.id || !optionName.trim()} className="rounded-lg bg-gray-100 px-3 text-xs font-bold"><Plus className="inline h-4 w-4" /> Opção</button>
              </form>
            </article>
          ))}
          {groups.length === 0 && <p className="text-xs text-gray-500">Nenhum grupo cadastrado ainda.</p>}
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2">
            <input type="number" step="0.01" value={bulkDelta} onChange={e => setBulkDelta(e.target.value)} className="w-24 rounded-lg border p-2 text-xs" aria-label="Alteração de preço em reais" />
            <button type="button" disabled={busy || bulkOptionIds.length === 0} onClick={() => void applyBulkPrice()} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              Alterar preço das {bulkOptionIds.length} opções selecionadas
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-bold">Vincular grupos aos produtos</h3>
          <select value={productId} onChange={e => setProductId(e.target.value)} className="w-full rounded-lg border p-2 text-sm">
            {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <div className="space-y-1">
            {sortedGroups.map(group => (
              <label key={group.id} className="flex items-center gap-2 rounded-lg border border-gray-100 p-2 text-sm">
                <input type="checkbox" checked={linkedGroupIds.includes(group.id)} onChange={e => setLinkedGroupIds(prev => e.target.checked ? [...prev, group.id] : prev.filter(id => id !== group.id))} />
                {group.name} {group.active ? '' : '(inativo)'}
              </label>
            ))}
          </div>
          <button type="button" disabled={busy || !productId} onClick={() => void saveLinks()} className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            <Save className="h-4 w-4" /> Salvar grupos do produto
          </button>
        </div>
      </div>
    </section>
  );
};
