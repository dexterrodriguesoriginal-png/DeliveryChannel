import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert, LogOut, FileText } from 'lucide-react';
import { Button } from '../ui/Button';

export const CeoSupportBanner: React.FC = () => {
  const { isCeoSupportMode, activeTenant, exitCeoSupportMode } = useAuth();

  if (!isCeoSupportMode || !activeTenant) {
    return null;
  }

  return (
    <div className="bg-amber-500 text-gray-950 px-4 py-2.5 sm:px-6 shadow-md border-b border-amber-600/40 sticky top-0 z-50 transition-all">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-2.5 font-bold tracking-tight">
          <div className="w-7 h-7 rounded-lg bg-black/15 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4 text-black animate-pulse" />
          </div>
          <div>
            <span className="uppercase tracking-wider font-extrabold bg-black text-amber-400 px-2 py-0.5 rounded-md text-[11px] mr-2">
              MODO SUPORTE CEO
            </span>
            <span>
              Acesso assistido ao estabelecimento: <strong className="underline underline-offset-2">{activeTenant.name}</strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <span className="text-[11px] text-gray-900/80 hidden md:inline-flex items-center gap-1 font-medium">
            <FileText className="w-3.5 h-3.5" />
            Todas as alterações estão sendo registradas no Audit Log
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={exitCeoSupportMode}
            leftIcon={<LogOut className="w-3.5 h-3.5 text-gray-900" />}
            className="bg-white/90 hover:bg-white text-gray-900 border-black/20 text-xs font-bold py-1 h-8"
          >
            Sair do Modo Suporte
          </Button>
        </div>
      </div>
    </div>
  );
};
