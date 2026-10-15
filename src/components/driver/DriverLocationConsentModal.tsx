import React from 'react';
import { ShieldCheck, MapPin, Clock, EyeOff, Check, X } from 'lucide-react';
import { Button } from '../ui/Button';

interface DriverLocationConsentModalProps {
  isOpen: boolean;
  onAccept: () => void;
  onReject: () => void;
}

export const DriverLocationConsentModal: React.FC<DriverLocationConsentModalProps> = ({
  isOpen,
  onAccept,
  onReject,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-gray-100 overflow-hidden flex flex-col">
        {/* Header com ícone de proteção */}
        <div className="p-5 bg-linear-to-b from-emerald-50 to-white border-b border-gray-100 flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded-full inline-block mb-1">
              Privacidade & LGPD
            </span>
            <h3 className="font-bold text-base text-gray-900 leading-snug">
              Compartilhamento de Localização
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Transparência total sobre o uso do seu GPS durante as entregas.
            </p>
          </div>
        </div>

        {/* 3 Pilares LGPD: Para que serve, Quando é enviada, Como parar */}
        <div className="p-5 space-y-3.5 text-xs text-gray-700">
          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 border border-blue-200/60">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-gray-900">Para que serve?</p>
              <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                Permite ao estabelecimento acompanhar o trajeto da entrega em andamento e apoiar você com suporte na rota.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200/60">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-gray-900">Quando é transmitida?</p>
              <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                A cada <strong>15 segundos</strong> quando você estiver em rota de entrega e a cada <strong>60 segundos</strong> enquanto disponível. Nenhuma posição é enviada quando indisponível ou fora do aplicativo.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 border border-amber-200/60">
              <EyeOff className="w-4 h-4" />
            </div>
            <div>
              <p className="font-bold text-gray-900">Como pausar ou parar?</p>
              <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                Você pode pausar o compartilhamento a qualquer instante pelo botão <strong>Pausar</strong> na tela principal.
              </p>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 text-center pt-1">
            Se optar por não compartilhar agora, o aplicativo funcionará normalmente sem envio de localização em segundo plano.
          </p>
        </div>

        {/* Botões de Ação */}
        <div className="p-4 bg-gray-50/80 border-t border-gray-100 flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={onReject}
            className="flex-1 text-xs py-2.5 text-gray-600 border-gray-200 hover:bg-gray-100 cursor-pointer"
          >
            Agora não
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={onAccept}
            leftIcon={<Check className="w-4 h-4" />}
            className="flex-1 text-xs py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
          >
            Concordar e Ativar
          </Button>
        </div>
      </div>
    </div>
  );
};
