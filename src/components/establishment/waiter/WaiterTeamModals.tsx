import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, Wand2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import {
  cleanWaiterPhone, generateWaiterPassword, isValidWaiterPassword, isValidWaiterUsername, normalizeWaiterUsername,
} from '../../../lib/waiter/waiterIdentity';
import { fileToWaiterPhoto } from '../../../lib/waiter/photo';
import { initials } from '../../../lib/waiter/waiterRouting';
import { WaiterAdminError, waiterV2Repository, type DirectoryMember } from '../../../repositories/waiterV2Repository';

const randomInt = (max: number) => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
};

/** Campo de senha com "mostrar" e "gerar". A senha só existe neste estado local e na chamada à Edge Function. */
export const PasswordField: React.FC<{ value: string; onChange: (v: string) => void; label?: string }> = ({ value, onChange, label = 'Senha * (mín. 6)' }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="mb-1 block font-semibold text-gray-700" htmlFor="waiter-password">{label}</label>
      <div className="flex gap-2">
        <input
          id="waiter-password" aria-label="Senha" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={6} required
          value={value} onChange={e => onChange(e.target.value)}
          className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-xs outline-none focus:border-emerald-600"
        />
        <button type="button" onClick={() => setVisible(v => !v)} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={visible} className="rounded-xl border border-gray-200 px-3 text-gray-600 hover:bg-gray-50">
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => { onChange(generateWaiterPassword(randomInt)); setVisible(true); }} className="flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100">
          <Wand2 className="h-3.5 w-3.5" />Gerar
        </button>
      </div>
    </div>
  );
};

const PhotoPicker: React.FC<{ name: string; preview: string | null; onPick: (dataUrl: string) => void; onError: (m: string) => void }> = ({ name, preview, onPick, onError }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      {preview
        ? <img src={preview} alt="Foto do garçom" className="h-12 w-12 rounded-xl object-cover" />
        : <span className="grid h-12 w-12 place-items-center rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-800">{initials(name)}</span>}
      <button type="button" onClick={() => ref.current?.click()} className="rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-bold text-gray-700 hover:bg-gray-50">{preview ? 'Trocar foto' : 'Adicionar foto (opcional)'}</button>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Foto do garçom"
        onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { onPick(await fileToWaiterPhoto(f)); } catch (err) { onError(err instanceof Error ? err.message : 'Foto inválida.'); } }} />
    </div>
  );
};

interface CreateProps { isOpen: boolean; onClose: () => void; tenantId: string; storeSlug?: string | null; onDone: (created: { username: string }) => void }

/** "Convidar garçom": Nome*, Telefone*, E-mail (opcional), Usuário*, Senha* (mostrar/gerar), Foto (opcional). */
export const CreateWaiterModal: React.FC<CreateProps> = ({ isOpen, onClose, tenantId, storeSlug, onDone }) => {
  const [form, setForm] = useState({ name: '', phone: '', email: '', username: '', password: '' });
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reactivate, setReactivate] = useState<{ userId: string } | null>(null);
  useEffect(() => { if (isOpen) { setForm({ name: '', phone: '', email: '', username: '', password: '' }); setPhoto(null); setError(''); setReactivate(null); setUsernameTouched(false); } }, [isOpen]);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setReactivate(null);
    const username = normalizeWaiterUsername(form.username);
    if (form.name.trim().length < 2) return setError('Informe o nome do garçom.');
    if (!cleanWaiterPhone(form.phone)) return setError('Informe um telefone válido com DDD.');
    if (!isValidWaiterUsername(username)) return setError('Usuário: 3 a 24 caracteres (letras, números ou _).');
    if (!isValidWaiterPassword(form.password)) return setError('A senha precisa ter pelo menos 6 caracteres.');
    setBusy(true);
    try {
      await waiterV2Repository.createWaiter({ tenantId, name: form.name.trim(), phone: form.phone, username, password: form.password, contactEmail: form.email.trim() || undefined, photoDataUrl: photo || undefined });
      onDone({ username });
    } catch (err) {
      if (err instanceof WaiterAdminError && err.canReactivate && err.userId) setReactivate({ userId: err.userId });
      setError(err instanceof Error ? err.message : 'Não foi possível cadastrar o garçom.');
    } finally { setBusy(false); }
  };
  const doReactivate = async () => {
    if (!reactivate) return;
    setBusy(true);
    try { await waiterV2Repository.reactivateWaiter(tenantId, reactivate.userId, form.password); onDone({ username: normalizeWaiterUsername(form.username) }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível reativar.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Convidar garçom" description="O garçom entra com usuário e senha, sem e-mail. Você pode redefinir a senha a qualquer momento." size="md">
      <form onSubmit={submit} className="space-y-3 text-xs" data-testid="waiter-create-form">
        <Input label="Nome *" value={form.name} onChange={e => { set('name', e.target.value); if (!usernameTouched) set('username', normalizeWaiterUsername(e.target.value.split(' ')[0])); }} required />
        <Input label="Telefone *" type="tel" inputMode="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(11) 99999-0000" required />
        <Input label="E-mail (opcional)" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="só para contato" />
        <div>
          <Input label="Usuário * (único na loja)" value={form.username} onChange={e => { setUsernameTouched(true); set('username', normalizeWaiterUsername(e.target.value)); }} placeholder="joao" autoCapitalize="none" autoComplete="off" required />
          {storeSlug && <p className="mt-1 text-[10px] text-gray-400">Login: loja <strong>{storeSlug}</strong> + usuário + senha.</p>}
        </div>
        <PasswordField value={form.password} onChange={v => set('password', v)} />
        <PhotoPicker name={form.name} preview={photo} onPick={setPhoto} onError={setError} />
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-rose-700">{error}</p>}
        {reactivate && <Button type="button" variant="outline" onClick={doReactivate} disabled={busy}>Reativar este garçom{form.password ? ' (com a senha informada)' : ''}</Button>}
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Cadastrando…' : 'Cadastrar garçom'}</Button>
        </div>
      </form>
    </Modal>
  );
};

interface EditProps { member: DirectoryMember | null; onClose: () => void; tenantId: string; onDone: () => void }

/** Editar nome/telefone/foto do garçom. */
export const EditWaiterModal: React.FC<EditProps> = ({ member, onClose, tenantId, onDone }) => {
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<string | null>(null); const [photoChanged, setPhotoChanged] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (member) { setName(member.name); setPhone(member.phone); setPhoto(member.photoUrl); setPhotoChanged(false); setError(''); } }, [member]);
  if (!member) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (name.trim().length < 2) return setError('Informe o nome do garçom.');
    if (!cleanWaiterPhone(phone)) return setError('Informe um telefone válido com DDD.');
    setBusy(true);
    try {
      await waiterV2Repository.updateWaiter(tenantId, member.userId, { name: name.trim(), phone, ...(photoChanged ? (photo ? { photoDataUrl: photo } : { removePhoto: true }) : {}) });
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Editar ${member.name}`} description={member.username ? `Usuário de login: ${member.username} (não muda)` : undefined} size="md">
      <form onSubmit={submit} className="space-y-3 text-xs" data-testid="waiter-edit-form">
        <Input label="Nome *" value={name} onChange={e => setName(e.target.value)} required />
        <Input label="Telefone *" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required />
        <PhotoPicker name={name} preview={photo} onPick={d => { setPhoto(d); setPhotoChanged(true); }} onError={setError} />
        {photo && <button type="button" onClick={() => { setPhoto(null); setPhotoChanged(true); }} className="text-[11px] font-bold text-rose-600">Remover foto</button>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  );
};

interface ResetProps { member: DirectoryMember | null; onClose: () => void; tenantId: string; onDone: () => void }

export const ResetWaiterPasswordModal: React.FC<ResetProps> = ({ member, onClose, tenantId, onDone }) => {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setPassword(''); setError(''); }, [member]);
  if (!member) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidWaiterPassword(password)) return setError('A senha precisa ter pelo menos 6 caracteres.');
    setBusy(true); setError('');
    try { await waiterV2Repository.resetPassword(tenantId, member.userId, password); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível redefinir.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Redefinir senha de ${member.name}`} description="As sessões abertas do garçom serão encerradas. Passe a nova senha pessoalmente." size="sm">
      <form onSubmit={submit} className="space-y-3 text-xs" data-testid="waiter-reset-form">
        <PasswordField value={password} onChange={setPassword} label="Nova senha * (mín. 6)" />
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy} leftIcon={<KeyRound className="h-3.5 w-3.5" />}>{busy ? 'Salvando…' : 'Redefinir senha'}</Button>
        </div>
      </form>
    </Modal>
  );
};
