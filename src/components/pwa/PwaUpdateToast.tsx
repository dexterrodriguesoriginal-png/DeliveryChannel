import React, { useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { getIconNoticeVisible, subscribeIconNotice } from '../client/IconUpdateNotice';
import { isInstallSession, isVisualUpdateSession } from '../../lib/pwa/installSession';
import {
  PWA_UPDATE_TOAST_TEXT,
  applySwUpdate,
  isSwUpdateAvailable,
  subscribeSwUpdate,
} from '../../lib/pwa/registerSw';

export const PwaUpdateToast: React.FC = () => {
  const visible = useSyncExternalStore(subscribeSwUpdate, isSwUpdateAvailable, () => false);
  const iconNoticeVisible = useSyncExternalStore(subscribeIconNotice, getIconNoticeVisible, () => false);
  if (!visible || iconNoticeVisible || isInstallSession(window.location.search) || isVisualUpdateSession(window.location.search)) return null;

  return (
    <div
      data-testid="pwa-update-toast"
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-[140] flex justify-center px-3 pointer-events-none"
    >
      <button
        type="button"
        onClick={() => applySwUpdate()}
        data-testid="pwa-update-action"
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xl ring-1 ring-white/15 hover:bg-slate-800 active:scale-95 transition cursor-pointer"
      >
        <RefreshCw className="h-4 w-4 text-emerald-400 shrink-0" />
        <span>{PWA_UPDATE_TOAST_TEXT}</span>
      </button>
    </div>
  );
};

