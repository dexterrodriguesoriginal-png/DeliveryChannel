import React, { useState, useEffect, useRef, useCallback } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { MapPin, Search, Loader2, AlertCircle, Info } from 'lucide-react';

export interface ParsedAddress {
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  formattedAddress: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
}

export interface AddressAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelect: (parsed: ParsedAddress) => void;
  placeholder?: string;
  disabled?: boolean;
}

interface SuggestionItem {
  id: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
  raw: any;
}

// Helpers de fallback para território brasileiro (ViaCEP e OpenStreetMap Nominatim)
const fetchViaCepFallback = async (query: string): Promise<SuggestionItem[]> => {
  const digits = query.replace(/\D/g, '');
  if (digits.length !== 8) return [];
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.erro) return [];
    return [{
      id: `viacep-${data.cep}`,
      mainText: `${data.logradouro || 'Endereço'}, ${data.bairro || ''}`,
      secondaryText: `${data.localidade} - ${data.uf}, CEP ${data.cep}`,
      fullText: `${data.logradouro || ''}, ${data.bairro || ''}, ${data.localidade} - ${data.uf}, ${data.cep}`,
      raw: { ...data, type: 'viacep' },
    }];
  } catch {
    return [];
  }
};

const fetchNominatimFallback = async (query: string): Promise<SuggestionItem[]> => {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=5&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => {
      const road = d.address?.road || d.display_name.split(',')[0];
      const suburb = d.address?.suburb || d.address?.neighbourhood || '';
      const city = d.address?.city || d.address?.town || d.address?.municipality || '';
      const state = d.address?.['ISO3166-2-lvl4']?.replace('BR-', '') || d.address?.state || '';
      return {
        id: `osm-${d.place_id || d.osm_id}`,
        mainText: road + (suburb ? `, ${suburb}` : ''),
        secondaryText: `${city}${state ? ` - ${state}` : ''}`,
        fullText: d.display_name,
        raw: { ...d, type: 'nominatim' },
      };
    });
  } catch {
    return [];
  }
};

export const AddressAutocompleteInput: React.FC<AddressAutocompleteInputProps> = ({
  value,
  onChange,
  onAddressSelect,
  placeholder = 'Digite o endereço (ex: Av. Paulista)',
  disabled = false,
}) => {
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [isApiReady, setIsApiReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionTokenRef = useRef<any>(null);
  const debounceTimerRef = useRef<any>(null);
  const placesLibRef = useRef<any>(null);

  // Inicializa o Google Maps Places SDK
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const isApiKeyPresent = Boolean(apiKey);

    if (!isApiKeyPresent) {
      const err = 'Chave VITE_GOOGLE_MAPS_API_KEY não configurada no ambiente.';
      setMapsError(err);
      console.log('[MAPS DEBUG]', {
        apiKeyPresent: false,
        mapsLoaded: false,
        placesLoaded: false,
        autocompleteAvailable: false,
        inputValue: '',
        queryLength: 0,
        suggestionCount: 0,
        autocompleteError: err,
      });
      return;
    }

    // Registra listener de gm_authFailure do Google Maps para identificar restrições de referer/billing/etc.
    const win = window as any;
    const prevAuthFailure = win.gm_authFailure;
    win.gm_authFailure = () => {
      const currentHost = typeof window !== 'undefined' ? window.location.host : '';
      const specificError = `Google Maps AuthFailure: Falha na autenticação da chave para o host "${currentHost}". Verifique se https://${currentHost}/* está adicionado às restrições de URL da API Key ou se as APIs Maps JavaScript e Places API (New) estão ativas.`;
      console.warn('[MAPS DEBUG]', specificError);
      setMapsError(specificError);
      if (typeof prevAuthFailure === 'function') {
        prevAuthFailure();
      }
    };

    let isMounted = true;

    try {
      setOptions({
        key: apiKey,
        v: 'weekly',
        language: 'pt-BR',
        region: 'BR',
      });

      importLibrary('places')
        .then((lib: any) => {
          if (!isMounted) return;
          placesLibRef.current = lib;
          setIsApiReady(true);
          setMapsError(null);

          const hasNewAutocomplete = Boolean(lib?.AutocompleteSuggestion);
          const hasLegacyAutocomplete = Boolean(win.google?.maps?.places?.AutocompleteService);

          console.log('[MAPS DEBUG]', {
            apiKeyPresent: true,
            mapsLoaded: Boolean(win.google?.maps),
            placesLoaded: true,
            autocompleteAvailable: hasNewAutocomplete || hasLegacyAutocomplete,
            inputValue: '',
            queryLength: 0,
            suggestionCount: 0,
            autocompleteError: null,
          });
        })
        .catch((err: any) => {
          if (!isMounted) return;
          const msg = err?.message || 'Falha ao importar biblioteca places do Google Maps.';
          console.warn('[MAPS DEBUG] importLibrary error:', msg);
          setMapsError(msg);
          setIsApiReady(false);
          console.log('[MAPS DEBUG]', {
            apiKeyPresent: true,
            mapsLoaded: Boolean(win.google?.maps),
            placesLoaded: false,
            autocompleteAvailable: false,
            inputValue: '',
            queryLength: 0,
            suggestionCount: 0,
            autocompleteError: msg,
          });
        });
    } catch (err: any) {
      const msg = err?.message || 'Erro ao inicializar Google Maps loader.';
      console.warn('[MAPS DEBUG] setOptions error:', msg);
      setMapsError(msg);
      setIsApiReady(false);
      console.log('[MAPS DEBUG]', {
        apiKeyPresent: true,
        mapsLoaded: false,
        placesLoaded: false,
        autocompleteAvailable: false,
        inputValue: '',
        queryLength: 0,
        suggestionCount: 0,
        autocompleteError: msg,
      });
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Busca sugestões com debounce de 300ms, priorizando endereços no Brasil (Seções 6 e 7)
  const fetchSuggestions = useCallback(
    async (query: string) => {
      const cleanQuery = query.trim();
      const apiKeyPresent = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
      const win = window as any;

      if (cleanQuery.length < 3) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      if (!isApiReady && !placesLibRef.current && !win.google?.maps?.places) {
        setIsLoadingSuggestions(true);
        try {
          let fallbackItems: SuggestionItem[] = [];
          if (/^[0-9]{5}-?[0-9]{3}$/.test(cleanQuery) || /^[0-9]{8}$/.test(cleanQuery)) {
            fallbackItems = await fetchViaCepFallback(cleanQuery);
          }
          if (fallbackItems.length === 0) {
            fallbackItems = await fetchNominatimFallback(cleanQuery);
          }
          setSuggestions(fallbackItems);
          setIsOpen(fallbackItems.length > 0);
          setHighlightedIndex(-1);
        } catch {} finally {
          setIsLoadingSuggestions(false);
        }
        return;
      }

      setIsLoadingSuggestions(true);

      try {
        const placesLib = placesLibRef.current || win.google?.maps?.places;
        let items: SuggestionItem[] = [];
        let currentError: string | null = null;

        // 1. Prioridade: Places API (New) com AutocompleteSuggestion
        if (placesLib?.AutocompleteSuggestion && placesLib?.AutocompleteSessionToken) {
          if (!sessionTokenRef.current) {
            sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
          }

          // Restrição geográfica estrita ao Brasil e priorização de endereços/logradouros
          const request: any = {
            input: cleanQuery,
            sessionToken: sessionTokenRef.current,
            includedRegionCodes: ['br'],
            includedPrimaryTypes: ['street_address', 'route', 'subpremise', 'premise'],
          };

          try {
            const response = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
            const rawSuggestions = response.suggestions || [];

            items = rawSuggestions
              .filter((s: any) => s.placePrediction)
              .map((s: any) => {
                const pred = s.placePrediction;
                const structured = pred.structuredFormat || {};
                const main = structured.mainText?.text || pred.mainText?.text || pred.text?.text || '';
                const secondary = structured.secondaryText?.text || pred.secondaryText?.text || '';
                const full = pred.text?.text || `${main}${secondary ? `, ${secondary}` : ''}`;

                return {
                  id: pred.placeId || Math.random().toString(),
                  mainText: main,
                  secondaryText: secondary,
                  fullText: full,
                  raw: pred,
                };
              });
          } catch (fetchErr: any) {
            currentError = fetchErr?.message || String(fetchErr);
            console.warn('[MAPS DEBUG] fetchAutocompleteSuggestions falhou, tentando fallback legado:', currentError);
          }
        }

        // 2. Fallback resiliente: AutocompleteService clássico
        if (items.length === 0 && win.google?.maps?.places?.AutocompleteService) {
          const googlePlaces = win.google.maps.places;
          if (!sessionTokenRef.current && googlePlaces.AutocompleteSessionToken) {
            sessionTokenRef.current = new googlePlaces.AutocompleteSessionToken();
          }

          const service = new googlePlaces.AutocompleteService();
          await new Promise<void>((resolve) => {
            service.getPlacePredictions(
              {
                input: cleanQuery,
                componentRestrictions: { country: 'br' },
                types: ['address'],
                sessionToken: sessionTokenRef.current,
              },
              (predictions: any, status: any) => {
                if (status === googlePlaces.PlacesServiceStatus.OK && predictions) {
                  items = predictions.map((p: any) => ({
                    id: p.place_id,
                    mainText: p.structured_formatting?.main_text || p.description,
                    secondaryText: p.structured_formatting?.secondary_text || '',
                    fullText: p.description,
                    raw: p,
                  }));
                  currentError = null;
                } else if (status !== googlePlaces.PlacesServiceStatus.ZERO_RESULTS) {
                  currentError = `Status: ${status}`;
                }
                resolve();
              }
            );
          });
        }

        // 3. Fallback geográfico brasileiro inteligente (ViaCEP & OpenStreetMap)
        if (items.length === 0) {
          if (/^[0-9]{5}-?[0-9]{3}$/.test(cleanQuery) || /^[0-9]{8}$/.test(cleanQuery)) {
            items = await fetchViaCepFallback(cleanQuery);
          }
          if (items.length === 0) {
            items = await fetchNominatimFallback(cleanQuery);
          }
        }

        console.log('[MAPS DEBUG]', {
          apiKeyPresent,
          mapsLoaded: Boolean(win.google?.maps),
          placesLoaded: Boolean(placesLib),
          autocompleteAvailable: true,
          inputValue: cleanQuery,
          queryLength: cleanQuery.length,
          suggestionCount: items.length,
          autocompleteError: currentError,
        });

        if (currentError) {
          setMapsError(currentError);
        } else {
          setMapsError(null);
        }

        setSuggestions(items);
        setIsOpen(items.length > 0);
        setHighlightedIndex(-1);
      } catch (err: any) {
        const errorMsg = err?.message || 'Erro inesperado no autocomplete.';
        console.warn('[MAPS DEBUG] Erro durante consulta de autocomplete:', errorMsg);
        setMapsError(errorMsg);
        console.log('[MAPS DEBUG]', {
          apiKeyPresent,
          mapsLoaded: Boolean(win.google?.maps),
          placesLoaded: Boolean(placesLibRef.current),
          autocompleteAvailable: false,
          inputValue: cleanQuery,
          queryLength: cleanQuery.length,
          suggestionCount: 0,
          autocompleteError: errorMsg,
        });
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        setIsLoadingSuggestions(false);
      }
    },
    [isApiReady, mapsError]
  );

  // Monitora alterações do input com debounce de 300ms
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (val.trim().length >= 3) {
      debounceTimerRef.current = setTimeout(() => {
        fetchSuggestions(val);
      }, 300);
    } else {
      setSuggestions([]);
      setIsOpen(false);
    }
  };

  // Processa a seleção de uma sugestão do Google Places
  const handleSelectSuggestion = async (item: SuggestionItem) => {
    setIsOpen(false);
    setIsLoadingSuggestions(true);

    try {
      let street = '';
      let number = '';
      let complement = '';
      let neighborhood = '';
      let city = '';
      let state = '';
      let postalCode = '';
      let formattedAddress = item.fullText;
      let latitude: number | undefined;
      let longitude: number | undefined;
      let placeId: string | undefined;

      const win = window as any;

      // 0. Fallbacks Diretos Brasileiros: ViaCEP ou Nominatim
      if (item.raw?.type === 'viacep') {
        const d = item.raw;
        street = d.logradouro || '';
        neighborhood = d.bairro || '';
        city = d.localidade || 'São Paulo';
        state = d.uf || 'SP';
        postalCode = d.cep || '';
        formattedAddress = `${street ? `${street}, ` : ''}${neighborhood ? `${neighborhood}, ` : ''}${city} - ${state}, ${postalCode}`;
      } else if (item.raw?.type === 'nominatim') {
        const d = item.raw;
        const addr = d.address || {};
        street = addr.road || item.mainText.split(',')[0] || '';
        number = addr.house_number || '';
        neighborhood = addr.suburb || addr.neighbourhood || '';
        city = addr.city || addr.town || addr.municipality || 'São Paulo';
        state = addr['ISO3166-2-lvl4']?.replace('BR-', '') || addr.state || 'SP';
        postalCode = addr.postcode || '';
        formattedAddress = d.display_name || item.fullText;
        if (d.lat) latitude = parseFloat(d.lat);
        if (d.lon) longitude = parseFloat(d.lon);
      } else if (item.raw && typeof item.raw.toPlace === 'function') {
        // 1. Places API (New): toPlace() e fetchFields()
        const place = item.raw.toPlace();
        await place.fetchFields({
          fields: ['addressComponents', 'formattedAddress', 'location', 'id', 'displayName'],
        });

        placeId = place.id;
        formattedAddress = place.formattedAddress || item.fullText;

        if (place.location) {
          latitude = typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat;
          longitude = typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng;
        }

        const components = place.addressComponents || [];
        for (const comp of components) {
          const types: string[] = comp.types || [];
          const longName: string = comp.longText || comp.long_name || '';
          const shortName: string = comp.shortText || comp.short_name || longName;

          if (types.includes('route')) {
            street = longName;
          } else if (types.includes('street_number')) {
            number = longName;
          } else if (types.includes('subpremise')) {
            complement = longName;
          } else if (
            types.includes('sublocality') ||
            types.includes('sublocality_level_1') ||
            types.includes('neighborhood')
          ) {
            neighborhood = longName;
          } else if (types.includes('administrative_area_level_2') || types.includes('locality')) {
            if (!city || types.includes('administrative_area_level_2')) {
              city = longName;
            }
          } else if (types.includes('administrative_area_level_1')) {
            state = shortName; // ex: 'SP'
          } else if (types.includes('postal_code')) {
            postalCode = longName;
          }
        }
      } else if (item.id && win.google?.maps?.places?.PlacesService) {
        // 2. Fallback para getDetails do SDK clássico
        const googlePlaces = win.google.maps.places;
        await new Promise<void>((resolve) => {
          const service = new googlePlaces.PlacesService(document.createElement('div'));
          service.getDetails(
            {
              placeId: item.id,
              fields: ['address_components', 'formatted_address', 'geometry', 'place_id'],
              sessionToken: sessionTokenRef.current,
            },
            (place: any, status: any) => {
              if (status === googlePlaces.PlacesServiceStatus.OK && place) {
                placeId = place.place_id;
                formattedAddress = place.formatted_address || item.fullText;
                if (place.geometry?.location) {
                  latitude = place.geometry.location.lat();
                  longitude = place.geometry.location.lng();
                }
                const comps = place.address_components || [];
                for (const comp of comps) {
                  const types = comp.types || [];
                  if (types.includes('route')) street = comp.long_name;
                  else if (types.includes('street_number')) number = comp.long_name;
                  else if (types.includes('subpremise')) complement = comp.long_name;
                  else if (
                    types.includes('sublocality') ||
                    types.includes('sublocality_level_1') ||
                    types.includes('neighborhood')
                  ) {
                    neighborhood = comp.long_name;
                  } else if (types.includes('administrative_area_level_2') || types.includes('locality')) {
                    if (!city || types.includes('administrative_area_level_2')) {
                      city = comp.long_name;
                    }
                  } else if (types.includes('administrative_area_level_1')) {
                    state = comp.short_name;
                  } else if (types.includes('postal_code')) {
                    postalCode = comp.long_name;
                  }
                }
              }
              resolve();
            }
          );
        });
      }

      // Se o logradouro foi identificado, usa ele; senão usa o texto principal da sugestão
      const displayValue = street || item.mainText || item.fullText;
      onChange(displayValue);

      // Envia os dados parseados para preencher os campos do formulário
      onAddressSelect({
        street: street || item.mainText,
        number,
        complement,
        neighborhood,
        city: city || 'São Paulo',
        state: state || 'SP',
        postalCode,
        formattedAddress,
        latitude,
        longitude,
        placeId,
      });

      // Reinicia o Session Token após o fetch de detalhes
      sessionTokenRef.current = null;
    } catch (err) {
      console.warn('[MAPS DEBUG] Falha ao extrair detalhes do endereço:', err);
      onChange(item.mainText || item.fullText);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  // Suporte a acessibilidade via teclado (Setas, Enter, Escape - Seção 13)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full space-y-1.5">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
          <MapPin className="w-4 h-4 text-emerald-700" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 && value.trim().length >= 3) {
              setIsOpen(true);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className="w-full pl-10 pr-10 py-2.5 text-xs bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-700 focus:border-emerald-700 focus:outline-none transition-all placeholder:text-gray-400 text-gray-900 disabled:bg-gray-50"
        />

        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
          {isLoadingSuggestions ? (
            <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
          ) : isApiReady && value.trim().length >= 3 ? (
            <Search className="w-4 h-4 text-gray-400" />
          ) : null}
        </div>
      </div>

      {/* Mensagem informativa quando o fallback inteligente está ativo */}
      {mapsError && (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
          <Info className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          <span>Busca inteligente ativa por rua ou CEP. Você também pode preencher os campos manualmente.</span>
        </div>
      )}

      {/* Lista de Sugestões */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto bg-white rounded-2xl shadow-xl shadow-emerald-950/10 border border-emerald-100 py-1 focus:outline-none">
          <ul role="listbox" className="divide-y divide-gray-50">
            {suggestions.map((item, index) => {
              const isSelected = highlightedIndex === index;
              return (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectSuggestion(item)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`px-4 py-2.5 cursor-pointer flex items-start gap-3 transition-colors text-left ${
                    isSelected ? 'bg-emerald-50/80 text-emerald-950' : 'hover:bg-gray-50 text-gray-800'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      isSelected ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate text-gray-900">{item.mainText}</div>
                    {item.secondaryText && (
                      <div className="text-[11px] text-gray-500 truncate mt-0.5">{item.secondaryText}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Atribuição dos serviços de mapas */}
          <div className="px-4 py-2 bg-gray-50/90 border-t border-gray-100 flex items-center justify-end gap-1.5 text-[10px] text-gray-400 font-medium select-none">
            <span>powered by</span>
            {suggestions.some(s => s.raw?.type === 'nominatim' || s.raw?.type === 'viacep') ? (
              <span className="font-semibold text-slate-500">OpenStreetMap & ViaCEP</span>
            ) : (
              <span className="font-bold tracking-tight">
                <span className="text-[#4285F4]">G</span>
                <span className="text-[#EA4335]">o</span>
                <span className="text-[#FBBC05]">o</span>
                <span className="text-[#4285F4]">g</span>
                <span className="text-[#34A853]">l</span>
                <span className="text-[#EA4335]">e</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
