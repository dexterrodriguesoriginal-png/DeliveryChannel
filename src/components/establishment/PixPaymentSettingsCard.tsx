import React, { useEffect, useState } from 'react';
import { tenantRepository } from '../../repositories/tenantRepository';
import { TenantPaymentSettings } from '../../types';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { QrCode, Save, ShieldCheck } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

/**
 * Configuração de recebimento PIX (N1). Somente OWNER/MANAGER (RLS + RPC).
 * A chave completa nunca é exibida após salva (apenas mascarada). O BR Code de cada
 * pedido é gerado pelo servidor (get_order_pix_payload), com CRC16 calculado no PostgreSQL.
 */
export const PixPaymentSettingsCard: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const { showToast } = useToast();
  const [current, setCurrent] = useState<TenantPaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pixEnabled, setPixEnabled] = useState(false);
  const [pixKeyType, setPixKeyType] = useState<string>('EVP');
  const [pixKey, setPixKey] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [merchantCity, setMerchantCity] = useState('');

  useEffect(() => {
    let alive = true;
    if (!canEdit) {
      setLoading(false);
      return;
    }
    setLoading(true);
    tenantRepository
      .getPaymentSettings(tenantId)
      .then(ps => {
        if (!alive) return;
        setCurrent(ps);
        setPixEnabled(Boolean(ps?.pixEnabled));
        setPixKeyType(ps?.pixKeyType || 'EVP');
        setMerchantName(ps?.merchantName || '');
        setMerchantCity(ps?.merchantCity || '');
      })
      .catch(err => alive && setError(err.message || 'Falha ao carregar configuração PIX.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tenantId, canEdit]);

  if (!canEdit) {
    return (
      <Card className="p-5 space-y-2">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <QrCode className="w-4 h-4 text-emerald-700" /> Recebimento PIX
        </h3>
        <p className="text-xs text-gray-500">Somente o proprietário ou gerente da loja pode ver e alterar a configuração PIX.</p>
      </Card>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // O servidor grava exatamente o que recebe (não há "manter chave"): a chave salva não é
    // devolvida ao navegador, então ela precisa ser reinformada a cada alteração.
    const keyBlank = !pixKey.trim();
    if (keyBlank && (pixEnabled || current?.pixKeyMasked)) {
      setError('Informe a chave PIX. Por segurança a chave salva não é exibida; reinforme-a para salvar.');
      return;
    }
    setSaving(true);
    try {
      const saved = await tenantRepository.savePaymentSettings(tenantId, {
        pixEnabled,
        pixKeyType: keyBlank ? undefined : pixKeyType,
        pixKey: keyBlank ? undefined : pixKey.trim(),
        merchantName,
        merchantCity,
      });
      setCurrent(saved);
      setPixKey('');
      showToast({ type: 'success', title: 'PIX salvo', message: 'Configuração de recebimento PIX atualizada.' });
    } catch (err: any) {
      setError(err.message || 'Falha ao salvar a configuração PIX.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-sm font-bold text-gray-900 pb-2 border-b border-gray-100 flex items-center gap-2">
        <QrCode className="w-4 h-4 text-emerald-700" /> Recebimento PIX
      </h3>
      {loading ? (
        <p className="text-xs text-gray-500">Carregando…</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <input type="checkbox" checked={pixEnabled} onChange={e => setPixEnabled(e.target.checked)} />
            Aceitar PIX nos pedidos
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">Tipo de chave</label>
              <select
                value={pixKeyType}
                onChange={e => setPixKeyType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300"
              >
                <option value="EVP">Aleatória (EVP)</option>
                <option value="CPF">CPF</option>
                <option value="CNPJ">CNPJ</option>
                <option value="EMAIL">E-mail</option>
                <option value="PHONE">Telefone (+55…)</option>
              </select>
            </div>
            <Input
              label={current?.pixKeyMasked ? `Chave PIX (salva: ${current.pixKeyMasked})` : 'Chave PIX'}
              value={pixKey}
              onChange={e => setPixKey(e.target.value)}
              placeholder={current?.pixKeyMasked ? 'Reinforme a chave para salvar' : ''}
              autoComplete="off"
            />
            <Input label="Nome do recebedor (até 25)" value={merchantName} maxLength={25} onChange={e => setMerchantName(e.target.value)} />
            <Input label="Cidade do recebedor (até 15)" value={merchantCity} maxLength={15} onChange={e => setMerchantCity(e.target.value)} />
          </div>
          {error && <p className="text-[11px] font-semibold text-rose-600">{error}</p>}
          <p className="text-[11px] text-gray-500 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            O código PIX de cada pedido é gerado no servidor com o valor exato do pedido.
          </p>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" isLoading={saving} leftIcon={<Save className="w-3.5 h-3.5" />}>
              Salvar PIX
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
};
