import { useEffect, useState } from 'react';
import { storeInitials, safeColor, FALLBACK_THEME_COLOR } from '../../lib/pwa/storeManifest';
import { isUsableLogoUrl } from '../../lib/pwa/storeLogo';

interface Props { logoUrl?: string; name: string; color?: string; className?: string; }

/** Logo da própria loja; se ausente, inválido ou falhar ao carregar, mostra iniciais nas cores da loja. */
export function StoreLogo({ logoUrl, name, color, className = 'w-10 h-10' }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl]);
  if (isUsableLogoUrl(logoUrl) && !failed) {
    return (
      <img src={logoUrl!.trim()} alt={name} onError={() => setFailed(true)}
        className={`${className} rounded-xl object-cover border border-gray-200 shadow-2xs`} />
    );
  }
  return (
    <div role="img" aria-label={name} data-testid="store-logo-fallback"
      className={`${className} rounded-xl flex items-center justify-center text-white font-bold text-base shadow-xs shrink-0`}
      style={{ backgroundColor: safeColor(color, FALLBACK_THEME_COLOR) }}>
      {storeInitials(name)}
    </div>
  );
}
