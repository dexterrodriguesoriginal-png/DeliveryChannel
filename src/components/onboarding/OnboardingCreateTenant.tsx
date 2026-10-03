import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teamRepository } from '../../repositories/teamRepository';
import { TeamInvite } from '../../types';
import { getPublicStoreUrl, isValidStoreSlug } from '../../utils/publicStoreUrl';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AddressAutocompleteInput, ParsedAddress } from './AddressAutocompleteInput';
import { 
  Store, 
  Building2, 
  FileText, 
  Phone, 
  Mail, 
  MapPin, 
  MessageSquare, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw,
  LogOut,
  Sparkles,
  Check
} from 'lucide-react';

interface OnboardingCreateTenantProps {
  onOpenAccountModal?: () => void;
}

export const OnboardingCreateTenant: React.FC<OnboardingCreateTenantProps> = ({
  onOpenAccountModal,
}) => {
  const { currentUser, createFirstTenant, signOut, refreshSession } = useAuth();

  const [receivedInvites, setReceivedInvites] = useState<Array<TeamInvite & { tenantName?: string }>>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [acceptingInviteId, setAcceptingInviteId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [isSlugCustomized, setIsSlugCustomized] = useState(false);
  const [document, setDocument] = useState('');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [category, setCategory] = useState('ADEGA');
  const [addressSearch, setAddressSearch] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('São Paulo');
  const [stateUf, setStateUf] = useState('SP');
  const [postalCode, setPostalCode] = useState('');

  // Coordenadas e identificadores auxiliares no estado do formulário (Seção 10)
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);

  const [phoneWhatsApp, setPhoneWhatsApp] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadInvites() {
      setIsLoadingInvites(true);
      try {
        const invites = await teamRepository.listMyReceivedInvites();
        if (isMounted) {
          setReceivedInvites(invites);
        }
      } catch (err) {
        console.warn('[OnboardingCreateTenant] Erro ao buscar convites pendentes:', err);
      } finally {
        if (isMounted) setIsLoadingInvites(false);
      }
    }
    loadInvites();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleAcceptInvite = async (inviteId: string) => {
    setAcceptingInviteId(inviteId);
    setErrorMsg(null);
    try {
      await teamRepository.acceptInvite(inviteId);
      await refreshSession();
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao aceitar convite.');
      setAcceptingInviteId(null);
    }
  };

  // Auto-gera slug limpo a partir do nome se o usuário não tiver customizado manualmente
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    if (!isSlugCustomized) {
      const generated = val
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      setSlug(generated);
    }
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSlugCustomized(true);
    const clean = e.target.value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '');
    setSlug(clean);
  };

  // Callback de seleção do Autocomplete do Google Places (Seções 5, 6, 7, 8, 9, 10, 11)
  const handleAddressSelect = (parsed: ParsedAddress) => {
    if (parsed.street) {
      setStreet(parsed.street);
      setAddressSearch(parsed.street);
    }
    if (parsed.number) setNumber(parsed.number);
    if (parsed.complement) setComplement(parsed.complement);
    if (parsed.neighborhood) setNeighborhood(parsed.neighborhood);
    if (parsed.city) setCity(parsed.city);
    if (parsed.state) setStateUf(parsed.state);
    if (parsed.postalCode) setPostalCode(parsed.postalCode);
    if (parsed.latitude !== undefined) setLatitude(parsed.latitude);
    if (parsed.longitude !== undefined) setLongitude(parsed.longitude);
    if (parsed.placeId) setPlaceId(parsed.placeId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || isSuccess) return;
    setErrorMsg(null);

    // Validações comerciais preliminares
    if (!name.trim()) {
      setErrorMsg('Informe o nome do estabelecimento.');
      return;
    }
    if (!slug.trim() || slug.length < 3) {
      setErrorMsg('O identificador (link) é obrigatório e deve ter no mínimo 3 caracteres (ex: adega-prime).');
      return;
    }
    const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (!slugRegex.test(slug)) {
      setErrorMsg('O identificador deve conter apenas letras minúsculas, números e hífens.');
      return;
    }
    if (!document.trim()) {
      setErrorMsg('Informe o CPF ou CNPJ do responsável.');
      return;
    }
    if (!phone.trim()) {
      setErrorMsg('Informe o telefone de contato.');
      return;
    }
    if (!email.trim()) {
      setErrorMsg('Informe o e-mail comercial.');
      return;
    }
    
    // Validação estrita de endereço
    const resolvedStreet = street.trim() || addressSearch.trim();
    if (!resolvedStreet) {
      setErrorMsg('Informe o endereço (rua/logradouro) do estabelecimento.');
      return;
    }
    if (!number.trim()) {
      setErrorMsg('Informe o número do estabelecimento (ou S/N caso não possua número).');
      return;
    }
    if (!city.trim()) {
      setErrorMsg('Informe a cidade do estabelecimento.');
      return;
    }
    if (!phoneWhatsApp.trim()) {
      setErrorMsg('Informe o número de WhatsApp para recebimento de pedidos.');
      return;
    }

    // Formatação final legível do endereço (Seções 11 e 15):
    // Exemplo: Av. Paulista, 1000, Apto 42 - Bela Vista, CEP 01310-100
    // Cidade: São Paulo - SP
    let mainAddress = `${resolvedStreet}, ${number.trim()}`;
    if (complement.trim()) {
      mainAddress += `, ${complement.trim()}`;
    }
    if (neighborhood.trim()) {
      mainAddress += ` - ${neighborhood.trim()}`;
    }
    if (postalCode.trim()) {
      mainAddress += `, CEP ${postalCode.trim()}`;
    }

    const finalCity = stateUf.trim() ? `${city.trim()} - ${stateUf.trim()}` : city.trim();

    setLoading(true);

    try {
      const res = await createFirstTenant({
        name: name.trim(),
        slug: slug.trim(),
        document: document.trim(),
        phone: phone.trim(),
        email: email.trim(),
        category,
        address: mainAddress,
        city: finalCity,
        phoneWhatsApp: phoneWhatsApp.trim(),
      });

      if (!res.success) {
        setErrorMsg(res.error || 'Falha ao criar estabelecimento. Verifique os dados informados.');
        setLoading(false);
      } else {
        setIsSuccess(true);
        // O AuthContext atualiza atomicamente hasTenantMembership=true, activeTenant e activeRole='OWNER',
        // fazendo com que o App desmonte automaticamente a tela de onboarding.
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro inesperado ao cadastrar estabelecimento.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-900 via-gray-950 to-emerald-950 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
        {/* Header Comercial */}
        <div className="bg-linear-to-r from-emerald-800 to-emerald-700 p-6 sm:p-8 text-white relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-xs flex items-center justify-center border border-white/20">
                <Store className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-200 font-mono">
                  AdegaFood • Comece Agora
                </span>
                <h1 className="text-xl sm:text-2xl font-black">Crie seu estabelecimento</h1>
              </div>
            </div>

            {onOpenAccountModal && (
              <button
                type="button"
                onClick={onOpenAccountModal}
                className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-xl border border-white/20 transition-colors font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <span>Minha Conta</span>
              </button>
            )}
          </div>

          <p className="text-xs sm:text-sm text-emerald-100/90 mt-3 leading-relaxed">
            Olá, <strong>{currentUser?.name || 'Comerciante'}</strong>! Configure as informações do seu negócio para iniciar seu catálogo digital, receber pedidos com impressão automática e organizar suas entregas.
          </p>
        </div>

        {/* Formulário / Sucesso */}
        {isSuccess ? (
          <div className="p-8 sm:p-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-9 h-9 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-extrabold text-gray-900">Estabelecimento criado com sucesso!</h2>
              <p className="text-sm text-gray-500">Preparando seu painel...</p>
            </div>
            <div className="pt-4 flex justify-center">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-200">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Carregando seu painel de controle...</span>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
            {receivedInvites.length > 0 && (
              <div className="p-5 bg-emerald-50/90 border-2 border-emerald-500/30 rounded-2xl space-y-3">
                <div className="flex items-center gap-2 text-emerald-950 font-bold text-sm">
                  <Sparkles className="w-5 h-5 text-emerald-700 shrink-0" />
                  <span>Você possui convite pendente para entrar em uma equipe!</span>
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  Você foi formalmente convidado para colaborar em um estabelecimento parceiro no AdegaFood:
                </p>
                <div className="space-y-2">
                  {receivedInvites.map((inv) => (
                    <div 
                      key={inv.id} 
                      className="p-3.5 bg-white rounded-xl border border-emerald-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold text-xs text-gray-900">{inv.tenantName}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          Função: <strong className="text-emerald-700">{inv.roleId === 'DRIVER' ? 'Entregador / Motorista' : inv.roleId}</strong>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => handleAcceptInvite(inv.id)}
                        disabled={acceptingInviteId === inv.id}
                        className="text-xs"
                      >
                        {acceptingInviteId === inv.id ? 'Entrando...' : 'Aceitar Convite e Entrar'}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-gray-500 pt-2 border-t border-emerald-200/60">
                  Ou preencha o formulário abaixo caso prefira registrar um novo estabelecimento próprio.
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800 text-xs">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Não foi possível criar o estabelecimento:</p>
                  <p className="text-rose-700">{errorMsg}</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider font-mono">
                Dados do Estabelecimento
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Input
                    label="Nome do Estabelecimento *"
                    placeholder="Ex: Adega Prime & Conveniência"
                    value={name}
                    onChange={handleNameChange}
                    leftIcon={<Building2 className="w-4 h-4" />}
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <Input
                    label="Link do Catálogo Digital *"
                    placeholder="ex: adega-prime"
                    value={slug}
                    onChange={handleSlugChange}
                    helperText={
                      slug
                        ? (isValidStoreSlug(slug)
                          ? `Link do seu catálogo: ${getPublicStoreUrl(slug)}`
                          : 'O identificador deve conter apenas letras minúsculas, números e hífens.')
                        : 'Informe o identificador exclusivo da sua loja para o link público.'
                    }
                    leftIcon={<Store className="w-4 h-4" />}
                    required
                  />
                </div>

                <div>
                  <Input
                    label="CPF ou CNPJ *"
                    placeholder="00.000.000/0001-00"
                    value={document}
                    onChange={e => setDocument(e.target.value)}
                    leftIcon={<FileText className="w-4 h-4" />}
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 select-none block mb-1.5">
                    Segmento Principal *
                  </label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-700 focus:outline-none"
                  >
                    <option value="ADEGA">Adega de Bebidas</option>
                    <option value="DISTRIBUIDORA">Distribuidora</option>
                    <option value="CONVENIENCIA">Loja de Conveniência</option>
                    <option value="BAR">Bar & Petiscaria</option>
                    <option value="MERCADO">Mercado / Mercearia</option>
                    <option value="RESTAURANTE">Restaurante / Lanchonete</option>
                  </select>
                </div>

                <div>
                  <Input
                    label="Telefone de Contato *"
                    placeholder="(11) 3456-7890"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    leftIcon={<Phone className="w-4 h-4" />}
                    required
                  />
                </div>

                <div>
                  <Input
                    label="WhatsApp para Pedidos *"
                    placeholder="(11) 98765-4321"
                    value={phoneWhatsApp}
                    onChange={e => setPhoneWhatsApp(e.target.value)}
                    leftIcon={<MessageSquare className="w-4 h-4" />}
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <Input
                    label="E-mail Comercial do Estabelecimento *"
                    type="email"
                    placeholder="contato@adegaprime.com.br"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    helperText={`E-mail comercial para contato público. Enviaremos o link de confirmação para o e-mail da sua conta (${currentUser?.email || 'sua conta'}).`}
                    leftIcon={<Mail className="w-4 h-4" />}
                    required
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider font-mono">
                  Localização do Estabelecimento
                </h2>
                <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-emerald-600" />
                  Preenchimento Inteligente
                </span>
              </div>

              {/* Campos Estruturados para Ajuste e Edição Manual (Seções 6, 7, 8, 9, 12, 19) */}
              <div className="space-y-3 pt-1">
                {/* Linha 1: Endereço / Logradouro (com Autocomplete Inteligente) e Número */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-8">
                    <label className="text-xs font-semibold text-gray-700 select-none block mb-1.5">
                      Endereço / Logradouro *
                    </label>
                    <AddressAutocompleteInput
                      value={addressSearch || street}
                      onChange={(val) => {
                        setAddressSearch(val);
                        setStreet(val);
                      }}
                      onAddressSelect={handleAddressSelect}
                      placeholder="Av. Paulista..."
                      disabled={loading}
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <Input
                      label="Número *"
                      placeholder="1000 ou S/N"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Linha 2: Complemento e Bairro */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Input
                      label="Complemento"
                      placeholder="Apto 42, Bloco B, Sala 10..."
                      value={complement}
                      onChange={(e) => setComplement(e.target.value)}
                    />
                  </div>

                  <div>
                    <Input
                      label="Bairro"
                      placeholder="Bela Vista"
                      value={neighborhood}
                      onChange={(e) => setNeighborhood(e.target.value)}
                    />
                  </div>
                </div>

                {/* Linha 3: Cidade e Estado (UF) */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-8">
                    <Input
                      label="Cidade *"
                      placeholder="São Paulo"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <Input
                      label="Estado (UF) *"
                      placeholder="SP"
                      value={stateUf}
                      onChange={(e) => setStateUf(e.target.value.toUpperCase())}
                      maxLength={2}
                      required
                    />
                  </div>
                </div>

                {/* Linha 4: CEP */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Input
                      label="CEP"
                      placeholder="01310-100"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                    />
                  </div>
                </div>

                {/* Formato final legível do endereço (Seções 11 e 15) */}
                {(street.trim() || addressSearch.trim()) && (
                  <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 text-xs text-gray-700 flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-semibold text-emerald-950">Endereço formatado: </span>
                      <span className="text-gray-800">
                        {street.trim() || addressSearch.trim()}
                        {number.trim() ? `, ${number.trim()}` : ''}
                        {complement.trim() ? `, ${complement.trim()}` : ''}
                        {neighborhood.trim() ? ` - ${neighborhood.trim()}` : ''}
                        {postalCode.trim() ? `, CEP ${postalCode.trim()}` : ''} • {city.trim()} - {stateUf.trim()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Banner comercial amigável (sem menções técnicas a RPC/PostgreSQL/RLS/OWNER) */}
            <div className="p-3.5 bg-emerald-50/70 border border-emerald-200/60 rounded-xl text-xs text-emerald-950 flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-full bg-emerald-200/70 text-emerald-800 flex items-center justify-center shrink-0">
                <Check className="w-3.5 h-3.5" />
              </div>
              <p className="leading-relaxed text-gray-700">
                Seu estabelecimento será configurado automaticamente com uma estrutura inicial pronta para começar.
              </p>
            </div>

            {/* Botões de Ação */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <Button
                type="submit"
                className="w-full sm:flex-1 py-3 text-xs font-bold cursor-pointer shadow-md bg-emerald-700 hover:bg-emerald-800"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    <span>Configurando seu estabelecimento...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    <span>Criar Estabelecimento & Acessar Painel</span>
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => signOut()}
                className="w-full sm:w-auto text-xs py-3 text-gray-600 hover:text-gray-900"
                disabled={loading}
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Sair
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
