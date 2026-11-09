import { Download } from 'lucide-react';
import { totemInstallUrl } from '../../lib/menu/totemAccess';
import { totemInstallPath } from '../../lib/pwa/totemManifest';
import './instalarTotemButton.css';

export function InstalarTotemButton({
  slug,
  origin,
  className,
}: {
  slug?: string;
  origin?: string;
  className?: string;
}) {
  const currentOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const href = slug ? (totemInstallUrl(currentOrigin, slug) || totemInstallPath(slug)) : '';
  if (!href) return null;
  return (
    <a
      href={href}
      data-testid="instalar-totem"
      className={className ?? 'dc-instalar-totem'}
    >
      <Download size={16} aria-hidden="true" />
      Instalar totem
    </a>
  );
}
