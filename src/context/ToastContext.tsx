import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (toastOrTitle: Omit<Toast, 'id'> | string, type?: ToastType, message?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((toastOrTitle: Omit<Toast, 'id'> | string, type: ToastType = 'info', message?: string) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: Toast = typeof toastOrTitle === 'string'
      ? { id, title: toastOrTitle, type, message }
      : { ...toastOrTitle, id };
    setToasts(prev => [...prev, newToast]);

    const duration = typeof toastOrTitle === 'object' && toastOrTitle.duration ? toastOrTitle.duration : 4500;
    setTimeout(() => {
      removeToast(id);
    }, duration);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      {/* Toast Render Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none px-4">
        {toasts.map(t => {
          const icons = {
            success: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />,
            warning: <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />,
            error: <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />,
            info: <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />,
          };

          const borderColors = {
            success: 'border-emerald-200 bg-white shadow-emerald-900/5',
            warning: 'border-amber-200 bg-white shadow-amber-900/5',
            error: 'border-rose-200 bg-white shadow-rose-900/5',
            info: 'border-blue-200 bg-white shadow-blue-900/5',
          };

          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg transition-all animate-in fade-in slide-in-from-bottom-2 ${borderColors[t.type]}`}
            >
              {icons[t.type]}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-900 leading-tight">{t.title}</h4>
                {t.message && (
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{t.message}</p>
                )}
              </div>
              <button
                onClick={() => removeToast(t.id)}
                className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 p-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
