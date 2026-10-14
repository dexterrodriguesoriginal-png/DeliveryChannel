/**
 * Campanhas e cards (N5) — somente com VITE_BACKEND_SCHEMA=n1n6 e papéis OWNER/MANAGER
 * (RLS N5; CEO/SUPER_ADMIN não acessam as tabelas novas). Métricas vêm do servidor
 * (get_campaign_metrics): receita apenas de pedidos válidos; funil do navegador é estimativa.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { CampaignCardN5, CampaignMetrics, CampaignN5, Offer, Product } from '../../types';
import { campaignRepository } from '../../repositories/campaignRepository';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUSES: CampaignN5['status'][] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'];
const STATUS_LABEL: Record<CampaignN5['status'], string> = {
  DRAFT: 'Rascunho', SCHEDULED: 'Agendada', ACTIVE: 'Ativa', PAUSED: 'Pausada', ENDED: 'Encerrada', ARCHIVED: 'Arquivada',
};

interface Props {
  tenantId: string;
  offers: Offer[];
  products: Pick<Product, 'id' | 'name'>[];
}

export const CampaignsPanel: React.FC<Props> = ({ tenantId, offers, products }) => {
  const [campaigns, setCampaigns] = useState<CampaignN5[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [cards, setCards] = useState<CampaignCardN5[]>([]);
  const [metrics, setMetrics] = useState<CampaignMetrics | null>(null);
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [cardMode, setCardMode] = useState<'OFFER' | 'PRODUCT' | 'BANNER_ONLY'>('OFFER');
  const [cardTitle, setCardTitle] = useState('');
  const [cardRef, setCardRef] = useState('');
  const [cardPrice, setCardPrice] = useState('');

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e: any) { setError(e?.message || 'Falha na operação.'); } finally { setBusy(false); }
  }, []);

  const reload = useCallback(() => run(async () => {
    const list = await campaignRepository.listCampaigns(tenantId);
    setCampaigns(list);
    if (!selectedId && list[0]) setSelectedId(list[0].id);
  }), [run, tenantId, selectedId]);

  useEffect(() => { void reload(); }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) { setCards([]); setMetrics(null); return; }
    void run(async () => {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 86400000);
      const [c, m] = await Promise.all([
        campaignRepository.listCards(tenantId, selectedId),
        campaignRepository.getMetrics(selectedId, from, to),
      ]);
      setCards(c);
      setMetrics(m);
    });
  }, [selectedId, tenantId, run]);

  const selected = campaigns.find(c => c.id === selectedId);

  return (
    <div className="space-y-4" data-testid="campaigns-panel">
      {error && <div role="alert" className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-bold text-gray-900">Campanhas</h3>
        <div className="flex gap-2 items-end">
          <Input label="Nova campanha" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Semana do Vinho" />
          <Button
            disabled={busy || !newName.trim()}
            onClick={() => run(async () => {
              const c = await campaignRepository.createCampaign(tenantId, { name: newName.trim() });
              setNewName('');
              setCampaigns(prev => [...prev, c]);
              setSelectedId(c.id);
            })}
          >Criar</Button>
        </div>
        {campaigns.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhuma campanha ainda.</p>
        ) : (
          <ul className="divide-y">
            {campaigns.map(c => (
              <li key={c.id} className={`py-2 flex items-center justify-between gap-2 ${c.id === selectedId ? 'font-semibold' : ''}`}>
                <button className="text-left text-sm flex-1" onClick={() => setSelectedId(c.id)}>{c.name}</button>
                <select
                  aria-label={`Status de ${c.name}`}
                  value={c.status}
                  disabled={busy}
                  className="text-xs border rounded-lg px-2 py-1"
                  onChange={e => run(async () => {
                    const u = await campaignRepository.updateCampaign(tenantId, c.id, { status: e.target.value as CampaignN5['status'] });
                    setCampaigns(prev => prev.map(x => (x.id === u.id ? u : x)));
                  })}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && (
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-bold text-gray-900">Cards de “{selected.name}”</h3>
          <ul className="divide-y">
            {cards.map(card => (
              <li key={card.id} className="py-2 flex items-center justify-between text-sm">
                <span>{card.title} <span className="text-xs text-gray-500">({card.commercialMode})</span></span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => {
                  await campaignRepository.deleteCard(tenantId, card.id);
                  setCards(prev => prev.filter(x => x.id !== card.id));
                })}>Remover</Button>
              </li>
            ))}
            {cards.length === 0 && <li className="py-2 text-xs text-gray-500">Sem cards.</li>}
          </ul>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
            <select aria-label="Modo do card" value={cardMode} onChange={e => { setCardMode(e.target.value as any); setCardRef(''); }} className="text-sm border rounded-lg px-2 py-2">
              <option value="OFFER">Oferta existente</option>
              <option value="PRODUCT">Produto do catálogo</option>
              <option value="BANNER_ONLY">Somente banner</option>
            </select>
            {cardMode !== 'BANNER_ONLY' && (
              <select aria-label="Referência do card" value={cardRef} onChange={e => setCardRef(e.target.value)} className="text-sm border rounded-lg px-2 py-2">
                <option value="">Selecione…</option>
                {(cardMode === 'OFFER' ? offers.map(o => ({ id: o.id, name: o.title })) : products).map(x => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            )}
            <Input label="Título" value={cardTitle} onChange={e => setCardTitle(e.target.value)} />
            {cardMode === 'PRODUCT' && (
              <Input label="Preço promocional (opcional)" type="number" value={cardPrice} onChange={e => setCardPrice(e.target.value)} />
            )}
          </div>
          <Button
            disabled={busy || !cardTitle.trim() || (cardMode !== 'BANNER_ONLY' && !cardRef)}
            onClick={() => run(async () => {
              const price = cardPrice ? Number(cardPrice) : undefined;
              const c = await campaignRepository.createCard(tenantId, selected.id, {
                commercialMode: cardMode,
                title: cardTitle.trim(),
                offerId: cardMode === 'OFFER' ? cardRef : undefined,
                productId: cardMode === 'PRODUCT' ? cardRef : undefined,
                cardPromotionalPrice: cardMode === 'PRODUCT' && price && price > 0 ? price : undefined,
                displayOrder: cards.length,
              });
              setCards(prev => [...prev, c]);
              setCardTitle(''); setCardRef(''); setCardPrice('');
            })}
          >Adicionar card</Button>
        </Card>
      )}

      {selected && metrics && (
        <Card className="p-4 space-y-2" data-testid="campaign-metrics">
          <h3 className="text-sm font-bold text-gray-900">Resultados (últimos 30 dias)</h3>
          <p className="text-sm">Pedidos válidos: <b>{metrics.orders.validOrders}</b> · Receita: <b>{brl(metrics.orders.revenue)}</b> · Receita paga: <b>{brl(metrics.orders.paidRevenue)}</b></p>
          <p className="text-xs text-gray-500">
            Receita calculada no servidor a partir de pedidos válidos. Funil (estimativa do navegador):{' '}
            {Object.entries(metrics.funnelEstimate).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'sem eventos'}
          </p>
        </Card>
      )}
    </div>
  );
};
