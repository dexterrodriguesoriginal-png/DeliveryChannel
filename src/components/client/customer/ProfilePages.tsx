import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronDown, Heart, MessageCircle, ThumbsDown, ThumbsUp, Ticket, Copy, AlertTriangle, Package } from 'lucide-react';
import type { ProfileScreenProps } from './ProfileScreen';
import { EmptyBlock, PrimaryButton, ScreenHeader, SkeletonRows, BottomSheet } from './ui';
import { ProductRow } from './ProductRow';
import { catalogUnitPrice } from '../../../lib/pricing/purchaseOrigin';
import { formatBRL } from '../../../lib/pricing/money';
import { couponCountdownLabel } from '../../../lib/customer/couponCountdown';
import { cpfDigits, formatCPF, isValidCPF } from '../../../lib/customer/cpf';
import { formatBRPhone, normalizeBRPhone } from '../../../lib/phone/brPhone';
import { FAQ_SECTIONS, LEGAL_REVIEW_NOTE, PRIVACY_POLICY, TERMS_OF_USE } from '../../../lib/customer/helpContent';
import { defaultKV, loadNotificationPrefs, NotificationPrefs, saveNotificationPrefs } from '../../../lib/customer/localStore';
import { StoreCoupon } from '../../../repositories/customerAppRepository';
import { useToast } from '../../../context/ToastContext';
import { cn } from '../../../utils/cn';

type P = ProfileScreenProps & { onBack: () => void };

const relTime = (iso: string, nowMs: number) => {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
};

// ------------------------------------------------------------------------------------------- Notificações
export const NotificationsPage: React.FC<P> = ({ onBack, notifications, onNotificationsSeen, onOpenOrder, user, onLogin, color, nowMs }) => {
  // Mostra os pontos de "não lida" nesta visita e marca como lidas ao sair.
  const [snapshot] = useState(notifications);
  useEffect(() => () => onNotificationsSeen(), [onNotificationsSeen]);
  const list = snapshot.length ? snapshot : notifications;
  return (
    <div className="max-w-lg mx-auto bg-white min-h-[70vh] dc-screen-in" data-testid="notifications-page">
      <ScreenHeader title="Notificações" onBack={onBack} />
      {!user ? (
        <EmptyBlock icon={<Bell className="w-7 h-7" />} title="Entre para ver suas notificações" text="Avisamos aqui cada etapa dos seus pedidos."
          action={<div className="max-w-xs mx-auto pt-2"><PrimaryButton color={color} onClick={onLogin}>Entrar</PrimaryButton></div>} />
      ) : list.length === 0 ? (
        <EmptyBlock testId="notifications-empty" icon={<Bell className="w-7 h-7" />} title="Nenhuma notificação" text="Quando você fizer um pedido, as atualizações aparecem aqui." />
      ) : (
        <ul className="divide-y divide-gray-100">
          {list.map(n => (
            <li key={n.id}>
              <button type="button" onClick={() => onOpenOrder(n.orderId)} data-testid="notification-item" data-unread={n.unread ? '1' : '0'}
                className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-gray-50 cursor-pointer">
                <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}1a`, color }}><Package className="w-5 h-5" /></span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{n.title}</span>
                    {n.unread && <span className="w-2 h-2 rounded-full bg-rose-600" aria-label="não lida" />}
                  </span>
                  <span className="block text-xs text-gray-600 mt-0.5">{n.body}</span>
                  <span className="block text-[11px] text-gray-400 mt-1">{relTime(n.at, nowMs)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ------------------------------------------------------------------------------------------- Meus cupons
const couponValue = (c: StoreCoupon) => (c.discountType === 'PERCENTAGE' ? `${c.discountValue}% OFF` : `${formatBRL(c.discountValue)} OFF`);

export const CouponsPage: React.FC<P> = ({ onBack, storeSlug, campaigns, loadCoupons, color, nowMs, onUseCoupon }) => {
  const [coupons, setCoupons] = useState<StoreCoupon[] | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const { showToast } = useToast();
  useEffect(() => {
    let alive = true;
    loadCoupons(storeSlug, campaigns).then(c => alive && setCoupons(c)).catch(() => alive && setCoupons([]));
    return () => { alive = false; };
  }, [storeSlug, campaigns, loadCoupons]);
  const visible = (coupons || []).filter(c => !couponCountdownLabel(c.endsAt, nowMs)?.expired);
  return (
    <div className="max-w-lg mx-auto min-h-[70vh] dc-screen-in" data-testid="coupons-page">
      <ScreenHeader title="Meus cupons" onBack={onBack} />
      <div className="p-4 space-y-3">
        {coupons === null ? <SkeletonRows rows={3} withImage={false} /> : visible.length === 0 ? (
          <EmptyBlock testId="coupons-empty" icon={<Ticket className="w-7 h-7" />} title="Nenhum cupom disponível" text="Quando a loja liberar cupons, eles aparecem aqui. Se você tem um código, use-o na sacola." />
        ) : visible.map(c => {
          const cd = couponCountdownLabel(c.endsAt, nowMs);
          const open = openCode === c.code;
          return (
            <div key={c.code} className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden" data-testid="coupon-card">
              <div className="flex">
                <div className="w-24 shrink-0 flex flex-col items-center justify-center text-white p-2 text-center" style={{ backgroundColor: color }}>
                  <Ticket className="w-5 h-5 mb-1" />
                  <span className="text-sm font-black leading-tight" data-testid="coupon-value">{couponValue(c)}</span>
                </div>
                <div className="flex-1 min-w-0 p-3">
                  <p className="text-sm font-extrabold text-gray-900 truncate">{c.description || 'Cupom da loja'}</p>
                  <p className="text-xs text-gray-500">{c.minOrderValue ? `Pedido mínimo ${formatBRL(c.minOrderValue)}` : 'Sem pedido mínimo'}</p>
                  {cd && <p className={cn('text-xs font-bold mt-0.5', cd.urgent ? 'text-rose-600' : 'text-gray-500')} data-testid="coupon-countdown">{cd.label}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(c.code).catch(() => {}); showToast({ type: 'success', title: 'Código copiado', message: c.code }); }}
                      className="px-2 h-7 rounded-lg border border-dashed border-gray-300 text-xs font-mono font-bold text-gray-800 flex items-center gap-1 cursor-pointer">
                      {c.code}<Copy className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => onUseCoupon(c.code)} className="ml-auto px-3 h-7 rounded-lg text-xs font-bold text-white cursor-pointer" style={{ backgroundColor: color }} data-testid="coupon-use">Usar</button>
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setOpenCode(open ? null : c.code)} className="w-full px-3 py-2 border-t border-gray-100 text-xs font-semibold text-gray-600 flex items-center justify-between cursor-pointer">
                Regras <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
              </button>
              <div className={cn('grid transition-[grid-template-rows] duration-300', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                <div className="overflow-hidden">
                  <ul className="px-4 pb-3 text-xs text-gray-600 list-disc pl-8 space-y-1" data-testid="coupon-rules">
                    <li>{c.discountType === 'PERCENTAGE' ? `${c.discountValue}% de desconto nos itens` : `${formatBRL(c.discountValue)} de desconto`}{c.maxDiscountAmount ? `, até ${formatBRL(c.maxDiscountAmount)}` : ''}.</li>
                    <li>{c.minOrderValue ? `Vale para pedidos a partir de ${formatBRL(c.minOrderValue)}.` : 'Vale para qualquer valor de pedido.'}</li>
                    {c.firstOrderOnly && <li>Somente na primeira compra nesta loja.</li>}
                    {typeof c.remainingUses === 'number' && <li>Restam {c.remainingUses} uso(s).</li>}
                    <li>{c.endsAt ? `Válido até ${new Date(c.endsAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })}.` : 'Sem data de término definida.'}</li>
                    <li>O desconto é confirmado pela loja no momento do pedido e pode não acumular com outras promoções.</li>
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------- Dados da conta
export const AccountDataPage: React.FC<P> = ({ onBack, customerName, customerPhone, user, loadCpf, onSaveProfile, color }) => {
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(formatBRPhone(customerPhone));
  const [cpf, setCpf] = useState('');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  // Carrega o CPF salvo UMA vez e nunca sobrescreve o que o cliente já começou a digitar.
  const cpfEdited = useRef(false);
  const loadCpfRef = useRef(loadCpf);
  useEffect(() => {
    let alive = true;
    loadCpfRef.current().then(v => { if (alive && v && !cpfEdited.current) setCpf(formatCPF(v)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const cpfErr = cpfDigits(cpf).length > 0 && !isValidCPF(cpf) ? 'CPF inválido. Confira os números.' : '';
  const phoneErr = phone.trim() && normalizeBRPhone(phone) === null ? 'Informe DDD + número.' : '';
  const nameErr = touched && name.trim().length < 2 ? 'Informe seu nome.' : '';
  const submit = async () => {
    setTouched(true);
    if (name.trim().length < 2 || cpfErr || phoneErr) return;
    setSaving(true);
    try { await onSaveProfile({ name: name.trim(), phone, cpf: cpfDigits(cpf) }); } finally { setSaving(false); }
  };
  const field = 'mt-1 w-full h-11 px-3 rounded-xl border text-sm focus:outline-none focus:ring-2';
  return (
    <div className="max-w-lg mx-auto bg-white min-h-[70vh] dc-screen-in" data-testid="account-data-page">
      <ScreenHeader title="Dados da conta" onBack={onBack} />
      <div className="p-4 space-y-4">
        <label className="block"><span className="text-xs font-semibold text-gray-700">Nome completo</span>
          <input value={name} onChange={e => setName(e.target.value)} className={cn(field, nameErr ? 'border-rose-400' : 'border-gray-200')} data-testid="acc-name" />
          {nameErr && <span className="text-xs text-rose-600">{nameErr}</span>}
        </label>
        <label className="block"><span className="text-xs font-semibold text-gray-700">E-mail</span>
          <input value={user?.email || ''} disabled className={cn(field, 'border-gray-200 bg-gray-50 text-gray-500')} />
        </label>
        <label className="block"><span className="text-xs font-semibold text-gray-700">CPF (opcional, para nota fiscal)</span>
          <input value={cpf} inputMode="numeric" onChange={e => { cpfEdited.current = true; setCpf(formatCPF(e.target.value)); }} placeholder="000.000.000-00" className={cn(field, cpfErr ? 'border-rose-400' : 'border-gray-200')} data-testid="acc-cpf" />
          {cpfErr && <span className="text-xs text-rose-600" data-testid="acc-cpf-error">{cpfErr}</span>}
        </label>
        <label className="block"><span className="text-xs font-semibold text-gray-700">Celular / WhatsApp</span>
          <input value={phone} inputMode="tel" onChange={e => setPhone(formatBRPhone(e.target.value))} placeholder="(11) 91234-5678" className={cn(field, phoneErr ? 'border-rose-400' : 'border-gray-200')} data-testid="acc-phone" />
          {phoneErr && <span className="text-xs text-rose-600">{phoneErr}</span>}
        </label>
        <PrimaryButton color={color} loading={saving} onClick={submit} data-testid="acc-save">Salvar</PrimaryButton>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------- Favoritos
export const FavoritesPage: React.FC<P> = ({ onBack, favoriteProducts, qtyOf, onAdd, onRemove, onOpenProduct, onToggleFavorite, color }) => (
  <div className="max-w-lg mx-auto min-h-[70vh] dc-screen-in" data-testid="favorites-page">
    <ScreenHeader title="Favoritos" onBack={onBack} />
    <div className="p-4 space-y-3">
      {favoriteProducts.length === 0 ? (
        <EmptyBlock testId="favorites-empty" icon={<Heart className="w-7 h-7" />} title="Nenhum favorito ainda" text="Toque no coração de um produto na busca para guardar aqui." />
      ) : favoriteProducts.map(p => {
        const c = catalogUnitPrice(p);
        return <ProductRow key={p.id} product={p} price={c.unitPrice} originalPrice={c.isPromotional ? p.price : undefined} qty={qtyOf(p.id)} color={color}
          onOpen={() => onOpenProduct(p)} onAdd={() => onAdd(p)} onRemove={() => onRemove(p)} favorite onToggleFavorite={() => onToggleFavorite(p.id)} />;
      })}
    </div>
  </div>
);

// ------------------------------------------------------------------------------------------- Gerenciar notificações
const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; color: string; testId?: string }> = ({ on, onChange, color, testId }) => (
  <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} data-testid={testId}
    className="w-11 h-6 rounded-full relative transition-colors cursor-pointer shrink-0" style={{ backgroundColor: on ? color : '#d1d5db' }}>
    <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
  </button>
);

export const NotificationSettingsPage: React.FC<P> = ({ onBack, user, color }) => {
  const kv = useMemo(() => defaultKV(), []);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => loadNotificationPrefs(kv, user?.id));
  const [perm, setPerm] = useState<string>(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  const { showToast } = useToast();
  const set = (k: keyof NotificationPrefs, v: boolean) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    saveNotificationPrefs(kv, user?.id, next);
    showToast({ type: 'success', title: 'Preferência salva' });
  };
  const ask = async () => {
    if (typeof Notification === 'undefined') return;
    const r = await Notification.requestPermission();
    setPerm(r);
  };
  const rows: Array<{ k: keyof NotificationPrefs; t: string; s: string }> = [
    { k: 'orderStatus', t: 'Status dos pedidos', s: 'Confirmação, preparo, saída para entrega e entrega' },
    { k: 'promotions', t: 'Promoções e cupons', s: 'Ofertas desta loja' },
    { k: 'whatsapp', t: 'Mensagens no WhatsApp', s: 'A loja pode falar com você sobre o pedido' },
  ];
  return (
    <div className="max-w-lg mx-auto bg-white min-h-[70vh] dc-screen-in" data-testid="notif-settings-page">
      <ScreenHeader title="Gerenciar notificações" onBack={onBack} />
      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.k} className="px-4 py-3.5 flex items-center gap-3">
            <div className="flex-1 min-w-0"><p className="text-sm font-semibold text-gray-900">{r.t}</p><p className="text-xs text-gray-500">{r.s}</p></div>
            <Toggle on={prefs[r.k]} onChange={v => set(r.k, v)} color={color} testId={`toggle-${r.k}`} />
          </div>
        ))}
      </div>
      <div className="m-4 p-3 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-600 space-y-2">
        <p><strong>Notificações do aparelho:</strong> {perm === 'granted' ? 'ativadas' : perm === 'denied' ? 'bloqueadas nas configurações do navegador' : perm === 'unsupported' ? 'não suportadas neste navegador' : 'ainda não ativadas'}.</p>
        {perm === 'default' && <button type="button" onClick={ask} className="font-bold cursor-pointer" style={{ color }}>Ativar agora</button>}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------- Ajuda
export const HelpPage: React.FC<P> = ({ onBack, storeName, onWhatsApp, helpOrder, color }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [vote, setVote] = useState<Record<string, 'up' | 'down'>>({});
  const { showToast } = useToast();
  return (
    <div className="max-w-lg mx-auto min-h-[70vh] pb-28 dc-screen-in" data-testid="help-page">
      <ScreenHeader title={helpOrder ? `Ajuda com o pedido #${helpOrder.orderNumber}` : 'Ajuda'} onBack={onBack} />
      {helpOrder && (
        <div className="m-4 p-4 rounded-2xl bg-white border border-gray-100 space-y-3" data-testid="order-help">
          <p className="text-sm text-gray-700">Pedido <strong>#{helpOrder.orderNumber}</strong> · {formatBRL(helpOrder.totalAmount)} · {new Date(helpOrder.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })}</p>
          <div className="grid gap-2">
            {[
              ['Meu pedido está atrasado', `Olá! Meu pedido #${helpOrder.orderNumber} está demorando. Pode me dar uma previsão?`],
              ['Veio item errado ou faltando', `Olá! No pedido #${helpOrder.orderNumber} veio item errado ou faltando.`],
              ['Problema com o pagamento', `Olá! Tive um problema com o pagamento do pedido #${helpOrder.orderNumber}.`],
              ['Outro assunto', `Olá! Preciso de ajuda com o pedido #${helpOrder.orderNumber}.`],
            ].map(([t, msg]) => (
              <button key={t} type="button" onClick={() => onWhatsApp(msg)} className="w-full flex items-center justify-between px-3 h-11 rounded-xl border border-gray-200 text-sm font-semibold text-gray-800 hover:bg-gray-50 cursor-pointer">
                {t}<MessageCircle className="w-4 h-4 text-emerald-600" />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="px-4 pt-2 space-y-4">
        {FAQ_SECTIONS.map(sec => (
          <section key={sec.id} data-testid={`faq-${sec.id}`}>
            <h3 className="text-sm font-extrabold text-gray-900 mb-2">{sec.title}</h3>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
              {sec.items.map(it => {
                const id = `${sec.id}.${it.id}`;
                const isOpen = open === id;
                return (
                  <div key={id} data-testid="faq-item" data-open={isOpen ? 'true' : 'false'}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} className="w-full px-4 py-3 flex items-center gap-2 text-left text-sm font-semibold text-gray-800 cursor-pointer">
                      <span className="flex-1">{it.q}</span><ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
                    </button>
                    <div inert={!isOpen} className={cn('grid transition-[grid-template-rows] duration-300', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                      <div className="overflow-hidden">
                        <div className="px-4 pb-3 space-y-3">
                          <p className="text-sm text-gray-600 leading-relaxed" data-testid="faq-answer">{it.a}</p>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            {vote[id] ? <span className="font-semibold" data-testid="faq-thanks">Obrigado pelo retorno!</span> : (
                              <>
                                <span>Essa informação foi útil?</span>
                                <button type="button" aria-label="Sim" onClick={() => { setVote(v => ({ ...v, [id]: 'up' })); }} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 cursor-pointer" data-testid="faq-up"><ThumbsUp className="w-4 h-4" /></button>
                                <button type="button" aria-label="Não" onClick={() => { setVote(v => ({ ...v, [id]: 'down' })); showToast({ type: 'info', title: 'Que pena!', message: `Fale com ${storeName} pelo WhatsApp que a gente resolve.` }); }} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 cursor-pointer"><ThumbsDown className="w-4 h-4" /></button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <div className="p-4 rounded-2xl bg-white border border-gray-100 text-center space-y-2">
          <p className="text-sm font-bold text-gray-900">Não achou o que procurava?</p>
          <PrimaryButton color="#16a34a" onClick={() => onWhatsApp()} data-testid="help-whatsapp"><MessageCircle className="w-4 h-4" /> Falar com a loja no WhatsApp</PrimaryButton>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------- Termos / Privacidade
export const LegalPage: React.FC<{ kind: 'terms' | 'privacy'; onBack: () => void }> = ({ kind, onBack }) => {
  const doc = kind === 'terms' ? TERMS_OF_USE : PRIVACY_POLICY;
  return (
    <div className="max-w-lg mx-auto bg-white min-h-[70vh] pb-28 dc-screen-in" data-testid={`legal-${kind}`}>
      <ScreenHeader title={kind === 'terms' ? 'Termos de uso' : 'Política de privacidade'} onBack={onBack} />
      <div className="p-4 space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 inline-block">{LEGAL_REVIEW_NOTE}</p>
        {doc.map(s => (
          <section key={s.h}><h3 className="text-sm font-extrabold text-gray-900">{s.h}</h3><p className="text-sm text-gray-600 leading-relaxed mt-1">{s.p}</p></section>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------- Excluir conta (LGPD)
export const DeleteAccountSheet: React.FC<{ open: boolean; onClose: () => void; color: string; onConfirm: (reason: string) => Promise<{ ok: boolean; message?: string }> }> = ({ open, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setReason(''); setAgree(false); setError(null); } }, [open]);
  return (
    <BottomSheet open={open} onClose={onClose} title="Excluir minha conta">
      <div className="space-y-3 px-1" data-testid="delete-account-sheet">
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>Vamos registrar seu pedido de exclusão. Seus dados pessoais (nome, telefone, e-mail, CPF e endereços) serão anonimizados. O histórico dos pedidos continua guardado <strong>sem identificar você</strong>, como a lei exige. Isso não pode ser desfeito.</p>
        </div>
        <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={2} placeholder="Quer contar o motivo? (opcional)" className="w-full p-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2" />
        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="w-4 h-4 mt-0.5" data-testid="delete-agree" />
          Entendo e quero excluir minha conta.
        </label>
        {error && <p className="text-xs text-rose-600" data-testid="delete-error">{error}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-11 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 cursor-pointer">Cancelar</button>
          <button type="button" disabled={!agree || busy} data-testid="delete-confirm"
            onClick={async () => { setBusy(true); setError(null); try { const r = await onConfirm(reason.trim()); if (r.ok) onClose(); else setError(r.message || 'Não foi possível registrar.'); } finally { setBusy(false); } }}
            className="h-11 rounded-xl bg-rose-600 text-white text-sm font-bold disabled:opacity-50 cursor-pointer">{busy ? 'Enviando…' : 'Excluir conta'}</button>
        </div>
      </div>
    </BottomSheet>
  );
};
