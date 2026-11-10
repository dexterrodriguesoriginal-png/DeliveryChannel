import { useEffect, useState } from 'react';
import { totemAccessRepository } from '../../../../repositories/totemAccessRepository';
import { terminalProviders } from '../../../../lib/totem/TotemPaymentProvider';

interface Settings { provider: string; timeoutSeconds: number; autoPrintTotem: boolean; autoPrintStore: boolean }
const defaults: Settings = { provider: 'manual', timeoutSeconds: 240, autoPrintTotem: false, autoPrintStore: false };

export function TotemPaymentSettings({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void totemAccessRepository.getPaymentSettings(tenantId).then(value => {
      if (active) setSettings(value);
    }).catch(() => { if (active) setNotice('Configuração de pagamento indisponível até aplicar a migration.'); });
    return () => { active = false; };
  }, [tenantId]);
  return (
    <section className="menu-design-section" data-testid="totem-payment-settings">
      <h2>Pagamento no totem</h2>
      <p>O cliente paga na maquininha ao lado. No modo manual, o caixa confirma o recebimento no PDV antes da senha ser liberada.</p>
      <label>Provedor
        <select value={settings.provider} onChange={event => setSettings(v => ({ ...v, provider: event.target.value }))}>
          <option value="manual">Manual — qualquer maquininha</option>
          {terminalProviders.map(provider => (
            <option key={provider.id} value={provider.id} disabled={!provider.isAvailable()}>
              {provider.label} — integração indisponível
            </option>
          ))}
        </select>
      </label>
      <label>Tempo para pagar
        <select value={settings.timeoutSeconds} onChange={event => setSettings(v => ({ ...v, timeoutSeconds: Number(event.target.value) }))}>
          <option value={120}>2 minutos</option><option value={180}>3 minutos</option>
          <option value={240}>4 minutos</option><option value={300}>5 minutos</option>
        </select>
      </label>
      <label><input type="checkbox" checked={settings.autoPrintTotem} onChange={event => setSettings(v => ({ ...v, autoPrintTotem: event.target.checked }))} /> Imprimir automaticamente no totem após a aprovação</label>
      <label><input type="checkbox" checked={settings.autoPrintStore} onChange={event => setSettings(v => ({ ...v, autoPrintStore: event.target.checked }))} /> Imprimir automaticamente na loja após a aprovação (depende da impressora configurada)</label>
      <button className="theme-primary" type="button" disabled={saving} onClick={() => {
        setSaving(true); setNotice('');
        void totemAccessRepository.setPaymentSettings(tenantId, settings)
          .then(() => setNotice('Preferências salvas.'))
          .catch(err => setNotice(err instanceof Error ? err.message : 'Falha ao salvar.'))
          .finally(() => setSaving(false));
      }}>{saving ? 'Salvando…' : 'Salvar pagamento do totem'}</button>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
