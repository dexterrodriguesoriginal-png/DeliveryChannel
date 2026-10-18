import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Home, Briefcase, MapPin, MoreVertical, Plus, LocateFixed, Pencil, Trash2, Search, Loader2 } from 'lucide-react';
import { AddressAutocompleteInput, ParsedAddress } from '../../onboarding/AddressAutocompleteInput';
import { MapConfirm } from './MapConfirm';
import { ScreenHeader, BottomSheet, PrimaryButton, EmptyBlock } from './ui';
import { useToast } from '../../../context/ToastContext';
import {
  AddressLabel, SavedAddress, addressSubtitle, addressTitle, defaultKV, loadAddressBook, newAddressId, removeAddress, selectAddress, upsertAddress,
} from '../../../lib/customer/localStore';
import { DEFAULT_CENTER, GeoPoint, ReverseAddress, extractHouseNumber, getCurrentPosition, reverseGeocode } from '../../../lib/customer/geocode';
import { cn } from '../../../utils/cn';

type Step = 'list' | 'search' | 'map' | 'details';

interface Draft {
  id?: string;
  street: string;
  number: string;
  noNumber: boolean;
  complement: string;
  reference: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  formattedAddress: string;
  placeId?: string;
  label: AddressLabel;
  nickname: string;
  point: GeoPoint | null;
}

const emptyDraft = (): Draft => ({
  street: '', number: '', noNumber: false, complement: '', reference: '', neighborhood: '', city: '', state: '', postalCode: '', formattedAddress: '', label: 'Casa', nickname: '', point: null,
});

const LABEL_ICON: Record<AddressLabel, React.ReactNode> = {
  Casa: <Home className="w-5 h-5" />,
  Trabalho: <Briefcase className="w-5 h-5" />,
  Outro: <MapPin className="w-5 h-5" />,
};

/**
 * Fluxo de endereço igual ao do iFood: lista de salvos → buscar (autocomplete ou localização atual) →
 * mapa com pin fixo para confirmar → número/complemento/referência + Casa/Trabalho/Outro.
 * Endereços ficam no aparelho por usuário; lat/lng vão junto no pedido (orders.address_details).
 */
export const AddressFlow: React.FC<{
  open: boolean;
  userId: string | null;
  color: string;
  /** 'select' = escolher para o pedido (fecha ao escolher); 'manage' = Perfil > Endereços. */
  mode: 'select' | 'manage';
  onClose: () => void;
  onSelected?: (a: SavedAddress) => void;
  startStep?: Step;
}> = ({ open, userId, color, mode, onClose, onSelected, startStep }) => {
  const kv = useMemo(() => defaultKV(), []);
  const { showToast } = useToast();
  const [book, setBook] = useState(() => loadAddressBook(kv, userId));
  const [step, setStep] = useState<Step>('list');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [query, setQuery] = useState('');
  // Últimos textos do campo de busca: o autocomplete troca o texto pelo endereço formatado logo antes de
  // avisar a seleção, então o número digitado pelo cliente fica no valor anterior.
  const typedRef = useRef<string[]>([]);
  const onQueryChange = (v: string) => { typedRef.current = [...typedRef.current.slice(-4), v]; setQuery(v); };
  const [mapCenter, setMapCenter] = useState<GeoPoint>(DEFAULT_CENTER);
  const [resolving, setResolving] = useState(false);
  const [mapMoving, setMapMoving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [menuFor, setMenuFor] = useState<SavedAddress | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedAddress | null>(null);

  useEffect(() => {
    if (!open) return;
    const b = loadAddressBook(kv, userId);
    setBook(b);
    setDraft(emptyDraft());
    setQuery('');
    setStep(startStep || (b.items.length === 0 ? 'search' : 'list'));
  }, [open, userId, kv, startStep]);

  const applyReverse = useCallback((r: ReverseAddress | null, keepNumber: boolean) => {
    if (!r) return;
    setDraft(d => ({
      ...d,
      street: r.street || d.street,
      number: keepNumber && d.number ? d.number : r.number || d.number,
      neighborhood: r.neighborhood || d.neighborhood,
      city: r.city || d.city,
      state: r.state || d.state,
      postalCode: r.postalCode || d.postalCode,
      formattedAddress: r.formattedAddress || d.formattedAddress,
      placeId: r.placeId || d.placeId,
    }));
  }, []);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const p = await getCurrentPosition();
      setDraft(d => ({ ...d, point: p }));
      setMapCenter(p);
      setStep('map');
      setResolving(true);
      applyReverse(await reverseGeocode(p), false);
    } catch (e: any) {
      showToast({ type: 'warning', title: 'Localização', message: e?.message || 'Não foi possível obter sua localização.' });
    } finally {
      setResolving(false);
      setLocating(false);
    }
  };

  const onPicked = (p: ParsedAddress) => {
    const typedNumber = [...typedRef.current].reverse().map(extractHouseNumber).find(Boolean) || '';
    typedRef.current = [];
    setDraft(d => ({
      ...d,
      street: p.street || p.formattedAddress,
      number: p.number || typedNumber,
      neighborhood: p.neighborhood || '',
      city: p.city || '',
      state: p.state || '',
      postalCode: p.postalCode || '',
      formattedAddress: p.formattedAddress || '',
      placeId: p.placeId,
      point: typeof p.latitude === 'number' && typeof p.longitude === 'number' ? { lat: p.latitude, lng: p.longitude } : d.point,
    }));
    if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
      setMapCenter({ lat: p.latitude, lng: p.longitude });
      setStep('map');
    } else {
      // Sem coordenada (fallback ViaCEP): vai direto para os detalhes; o pedido segue sem lat/lng.
      setStep('details');
    }
  };

  const onPinMoved = useCallback(async (p: GeoPoint) => {
    setDraft(d => ({ ...d, point: p }));
    setResolving(true);
    try {
      applyReverse(await reverseGeocode(p), true);
    } finally {
      setResolving(false);
    }
  }, [applyReverse]);

  const editAddress = (a: SavedAddress) => {
    setMenuFor(null);
    setDraft({
      id: a.id, street: a.street, number: a.number, noNumber: Boolean(a.noNumber), complement: a.complement || '', reference: a.reference || '',
      neighborhood: a.neighborhood || '', city: a.city || '', state: a.state || '', postalCode: a.postalCode || '', formattedAddress: a.formattedAddress || '',
      placeId: a.placeId, label: a.label, nickname: a.nickname || '',
      point: typeof a.latitude === 'number' && typeof a.longitude === 'number' ? { lat: a.latitude, lng: a.longitude } : null,
    });
    if (typeof a.latitude === 'number' && typeof a.longitude === 'number') setMapCenter({ lat: a.latitude, lng: a.longitude });
    setStep('details');
  };

  const save = () => {
    if (!draft.street.trim()) {
      showToast({ type: 'warning', title: 'Endereço', message: 'Informe a rua.' });
      return;
    }
    if (!draft.noNumber && !draft.number.trim()) {
      showToast({ type: 'warning', title: 'Número', message: 'Informe o número ou marque "Sem número".' });
      return;
    }
    const a: SavedAddress = {
      id: draft.id || newAddressId(),
      label: draft.label,
      nickname: draft.label === 'Outro' ? draft.nickname.trim() || undefined : undefined,
      street: draft.street.trim(),
      number: draft.noNumber ? 'S/N' : draft.number.trim(),
      noNumber: draft.noNumber,
      complement: draft.complement.trim() || undefined,
      reference: draft.reference.trim() || undefined,
      neighborhood: draft.neighborhood.trim() || undefined,
      city: draft.city.trim() || undefined,
      state: draft.state.trim() || undefined,
      postalCode: draft.postalCode.trim() || undefined,
      formattedAddress: draft.formattedAddress || undefined,
      placeId: draft.placeId,
      latitude: draft.point?.lat,
      longitude: draft.point?.lng,
      updatedAt: new Date().toISOString(),
    };
    const b = upsertAddress(kv, userId, a);
    setBook(b);
    showToast({ type: 'success', title: draft.id ? 'Endereço atualizado' : 'Endereço salvo', message: addressTitle(a) });
    if (mode === 'select') {
      onSelected?.(a);
      onClose();
    } else {
      setStep('list');
    }
  };

  const choose = (a: SavedAddress) => {
    setBook(selectAddress(kv, userId, a.id));
    onSelected?.(a);
    if (mode === 'select') onClose();
  };

  if (!open) return null;

  const back = () => {
    if (step === 'details') setStep(draft.point && !draft.id ? 'map' : book.items.length ? 'list' : 'search');
    else if (step === 'map') setStep('search');
    else if (step === 'search' && book.items.length > 0) setStep('list');
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-[1150] bg-white flex flex-col dc-screen-in" data-testid="address-flow" data-step={step}>
      <div className="w-full max-w-lg mx-auto flex flex-col flex-1 min-h-0">
        {step === 'list' && (
          <>
            <ScreenHeader title="Endereço de entrega" onBack={onClose} />
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 space-y-3">
                <button type="button" onClick={() => setStep('search')} className="w-full flex items-center gap-2 px-4 h-12 rounded-xl bg-gray-100 text-gray-500 text-sm cursor-pointer">
                  <Search className="w-4 h-4" /> Buscar endereço e número
                </button>
                <button type="button" onClick={useMyLocation} disabled={locating} className="w-full flex items-center gap-3 px-1 py-2 text-left cursor-pointer" data-testid="use-location">
                  {locating ? <Loader2 className="w-5 h-5 animate-spin" style={{ color }} /> : <LocateFixed className="w-5 h-5" style={{ color }} />}
                  <span>
                    <span className="block text-sm font-bold text-gray-900">Usar localização atual</span>
                    <span className="block text-xs text-gray-500">Ative a localização do aparelho</span>
                  </span>
                </button>
              </div>
              <div className="border-t border-gray-100">
                {book.items.length === 0 ? (
                  <EmptyBlock icon={<MapPin className="w-7 h-7" />} title="Nenhum endereço salvo" text="Adicione um endereço para receber seus pedidos." />
                ) : (
                  book.items.map(a => {
                    const selected = a.id === book.selectedId;
                    return (
                      <div key={a.id} data-testid="saved-address" className={cn('flex items-center gap-3 px-4 py-3.5 border-b border-gray-100', selected && 'bg-gray-50')}>
                        <button type="button" onClick={() => choose(a)} className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer">
                          <span className="text-gray-700 shrink-0">{LABEL_ICON[a.label]}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-gray-900 truncate">{a.label === 'Outro' && a.nickname ? a.nickname : a.label} · {addressTitle(a)}</span>
                            <span className="block text-xs text-gray-500 truncate">{addressSubtitle(a)}</span>
                            {a.reference && <span className="block text-[11px] text-gray-400 truncate">Ref.: {a.reference}</span>}
                          </span>
                        </button>
                        {selected && <Check className="w-5 h-5 shrink-0" style={{ color }} data-testid="address-selected" />}
                        <button type="button" aria-label="Mais opções" onClick={() => setMenuFor(a)} className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 cursor-pointer shrink-0">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="p-4 border-t border-gray-100">
              <PrimaryButton color={color} onClick={() => { setDraft(emptyDraft()); setStep('search'); }}>
                <Plus className="w-4 h-4" /> Adicionar novo endereço
              </PrimaryButton>
            </div>
          </>
        )}

        {step === 'search' && (
          <>
            <ScreenHeader title="Buscar endereço" onBack={back} />
            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
              <AddressAutocompleteInput value={query} onChange={onQueryChange} onAddressSelect={onPicked} placeholder="Rua, avenida e número" />
              <button type="button" onClick={useMyLocation} disabled={locating} className="w-full flex items-center gap-3 px-1 py-2 text-left cursor-pointer">
                {locating ? <Loader2 className="w-5 h-5 animate-spin" style={{ color }} /> : <LocateFixed className="w-5 h-5" style={{ color }} />}
                <span>
                  <span className="block text-sm font-bold text-gray-900">Usar localização atual</span>
                  <span className="block text-xs text-gray-500">Mostramos no mapa para você confirmar</span>
                </span>
              </button>
              <p className="text-[11px] text-gray-400">Digite pelo menos 3 letras. Você confirma o ponto exato no mapa em seguida.</p>
            </div>
          </>
        )}

        {step === 'map' && (
          <>
            <ScreenHeader title="Confirme a localização" onBack={back} />
            <div className="flex-1 min-h-0 relative">
              <MapConfirm center={mapCenter} onCenterChange={onPinMoved} onLocateMe={useMyLocation} moving={setMapMoving} />
            </div>
            <div className="p-4 space-y-3 border-t border-gray-100 bg-white">
              <div className="min-h-[44px]" data-testid="map-address">
                <p className="text-sm font-extrabold text-gray-900 truncate">
                  {resolving || mapMoving ? 'Buscando endereço…' : draft.street ? `${draft.street}${draft.number ? `, ${draft.number}` : ''}` : 'Arraste o mapa até o pin ficar no local de entrega'}
                </p>
                <p className="text-xs text-gray-500 truncate">{[draft.neighborhood, [draft.city, draft.state].filter(Boolean).join(' - ')].filter(Boolean).join(', ')}</p>
              </div>
              <PrimaryButton color={color} disabled={mapMoving} onClick={() => setStep('details')} data-testid="confirm-location">
                Confirmar localização
              </PrimaryButton>
            </div>
          </>
        )}

        {step === 'details' && (
          <>
            <ScreenHeader title={draft.id ? 'Editar endereço' : 'Complete o endereço'} onBack={back} />
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-start gap-3">
                <MapPin className="w-5 h-5 shrink-0 mt-0.5" style={{ color }} />
                <div className="min-w-0 flex-1">
                  <input value={draft.street} onChange={e => setDraft(d => ({ ...d, street: e.target.value }))} aria-label="Rua"
                    className="w-full bg-transparent text-sm font-bold text-gray-900 focus:outline-none" placeholder="Rua" />
                  <p className="text-xs text-gray-500 truncate">{[draft.neighborhood, [draft.city, draft.state].filter(Boolean).join(' - ')].filter(Boolean).join(', ') || 'Bairro e cidade'}</p>
                </div>
                {draft.id && draft.point && (
                  <button type="button" className="text-xs font-bold cursor-pointer shrink-0" style={{ color }} onClick={() => setStep('map')}>Ajustar no mapa</button>
                )}
              </div>
              <div className="grid grid-cols-5 gap-3 items-end">
                <label className="col-span-3 block">
                  <span className="text-xs font-semibold text-gray-700">Número</span>
                  <input inputMode="numeric" value={draft.noNumber ? '' : draft.number} disabled={draft.noNumber} onChange={e => setDraft(d => ({ ...d, number: e.target.value }))}
                    data-testid="addr-number" className="mt-1 w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 disabled:bg-gray-100" placeholder="Ex.: 120" />
                </label>
                <label className="col-span-2 flex items-center gap-2 h-11 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={draft.noNumber} onChange={e => setDraft(d => ({ ...d, noNumber: e.target.checked }))} className="w-4 h-4" />
                  Sem número
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold text-gray-700">Complemento</span>
                <input value={draft.complement} onChange={e => setDraft(d => ({ ...d, complement: e.target.value }))} data-testid="addr-complement"
                  className="mt-1 w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2" placeholder="Apartamento, bloco, casa…" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-700">Ponto de referência</span>
                <input value={draft.reference} onChange={e => setDraft(d => ({ ...d, reference: e.target.value }))} data-testid="addr-reference"
                  className="mt-1 w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2" placeholder="Ex.: ao lado da padaria" />
              </label>
              <div>
                <span className="text-xs font-semibold text-gray-700">Favoritar como</span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(['Casa', 'Trabalho', 'Outro'] as AddressLabel[]).map(l => (
                    <button key={l} type="button" onClick={() => setDraft(d => ({ ...d, label: l }))}
                      className={cn('h-14 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors', draft.label === l ? 'text-white border-transparent' : 'border-gray-200 text-gray-700 bg-white')}
                      style={draft.label === l ? { backgroundColor: color } : undefined}>
                      {LABEL_ICON[l]}{l}
                    </button>
                  ))}
                </div>
                {draft.label === 'Outro' && (
                  <input value={draft.nickname} onChange={e => setDraft(d => ({ ...d, nickname: e.target.value }))}
                    className="mt-2 w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2" placeholder="Nome do local (ex.: Casa da mãe)" />
                )}
              </div>
            </div>
            <div className="p-4 border-t border-gray-100">
              <PrimaryButton color={color} onClick={save} data-testid="save-address">Salvar endereço</PrimaryButton>
            </div>
          </>
        )}
      </div>

      <BottomSheet open={Boolean(menuFor)} onClose={() => setMenuFor(null)} title={menuFor ? addressTitle(menuFor) : undefined}>
        <button type="button" onClick={() => menuFor && editAddress(menuFor)} className="w-full flex items-center gap-3 px-2 py-3.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 rounded-xl cursor-pointer">
          <Pencil className="w-4 h-4" /> Editar
        </button>
        <button type="button" onClick={() => { setConfirmDelete(menuFor); setMenuFor(null); }} className="w-full flex items-center gap-3 px-2 py-3.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 rounded-xl cursor-pointer">
          <Trash2 className="w-4 h-4" /> Excluir
        </button>
      </BottomSheet>
      <BottomSheet open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="Excluir endereço?">
        <p className="text-sm text-gray-600 px-1 mb-4">{confirmDelete ? `${addressTitle(confirmDelete)} será removido dos seus endereços salvos.` : ''}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setConfirmDelete(null)} className="h-11 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 cursor-pointer">Cancelar</button>
          <button type="button" onClick={() => { if (confirmDelete) { setBook(removeAddress(kv, userId, confirmDelete.id)); showToast({ type: 'success', title: 'Endereço excluído' }); } setConfirmDelete(null); }}
            className="h-11 rounded-xl bg-rose-600 text-white text-sm font-bold cursor-pointer">Excluir</button>
        </div>
      </BottomSheet>
    </div>
  );
};
