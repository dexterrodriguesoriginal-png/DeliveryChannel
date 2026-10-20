import React, { useState, useRef } from 'react';
import {
  Upload,
  Link as LinkIcon,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Image as ImageIcon,
  Ban,
  Maximize2,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
  ThemeImageType,
  THEME_STORAGE_BUCKET,
  THEME_IMAGE_CONFIGS,
  validateThemeImageFile,
  buildThemeStoragePath,
  validateAndSanitizeThemeImageUrl,
} from '../../../lib/theme/themeUploads';

export interface ThemeImageUploaderProps {
  tenantId: string;
  imageType: ThemeImageType;
  label: string;
  value?: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}

export const ThemeImageUploader: React.FC<ThemeImageUploaderProps> = ({
  tenantId,
  imageType,
  label,
  value = '',
  onChange,
  disabled = false,
}) => {
  const config = THEME_IMAGE_CONFIGS[imageType];
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [urlInput, setUrlInput] = useState(value);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Manipulador de upload de arquivo
  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setUploadSuccess(false);

    // 1. Validação prévia de formato e tamanho
    const validation = validateThemeImageFile(file, imageType);
    if (!validation.valid) {
      setUploadError(validation.error || 'Arquivo inválido.');
      return;
    }

    if (!tenantId) {
      setUploadError('Identificador da loja não encontrado.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(15);

    // Configura controlador para cancelamento do envio
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // 2. Caminho oficial sob o ID da loja: <tenantId>/theme/<tipo>-<timestamp>.<ext>
      const filePath = buildThemeStoragePath(tenantId, imageType, file.name);

      // Simulação de progresso gradual para feedback visual transparente
      const progressTimer = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 85) {
            clearInterval(progressTimer);
            return prev;
          }
          return prev + 15;
        });
      }, 150);

      // 3. Upload para o bucket 'catalog' no Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from(THEME_STORAGE_BUCKET)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        });

      clearInterval(progressTimer);

      if (controller.signal.aborted) {
        setUploadError('Envio cancelado pelo usuário.');
        setIsUploading(false);
        setUploadProgress(0);
        return;
      }

      if (uploadErr) {
        console.error('[ThemeImageUploader] Falha no upload para Storage:', uploadErr);
        throw new Error(uploadErr.message || 'Falha ao gravar arquivo no armazenamento.');
      }

      setUploadProgress(100);

      // 4. Obtenção da URL pública
      const { data: publicUrlData } = supabase.storage
        .from(THEME_STORAGE_BUCKET)
        .getPublicUrl(filePath);

      if (!publicUrlData?.publicUrl) {
        throw new Error('Não foi possível obter o endereço público da imagem enviada.');
      }

      // 5. Higienização da URL via safeImageUrl
      const sanitizedUrl = validateAndSanitizeThemeImageUrl(publicUrlData.publicUrl);
      if (!sanitizedUrl) {
        throw new Error('A URL gerada foi rejeitada pela validação de segurança.');
      }

      setUrlInput(sanitizedUrl);
      onChange(sanitizedUrl);
      setUploadSuccess(true);
    } catch (err: any) {
      if (controller.signal.aborted) {
        setUploadError('Envio cancelado.');
      } else {
        setUploadError(err.message || 'Erro inesperado ao processar o upload.');
      }
    } finally {
      setIsUploading(false);
      abortControllerRef.current = null;
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Botão de cancelamento durante o envio
  const handleCancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsUploading(false);
    setUploadProgress(0);
    setUploadError('Envio interrompido.');
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || isUploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Aplicação manual de URL direta
  const handleUrlApply = () => {
    const raw = urlInput.trim();
    setUploadError(null);
    if (!raw) {
      onChange('');
      return;
    }

    const sanitized = validateAndSanitizeThemeImageUrl(raw);
    if (!sanitized) {
      setUploadError('URL inválida ou insegura. Informe um endereço HTTPS válido (ex: https://images.unsplash.com/...).');
      return;
    }

    onChange(sanitized);
    setUploadSuccess(true);
  };

  // Remover imagem do campo sem apagar do storage (requisito da spec)
  const handleClearImage = () => {
    setUrlInput('');
    onChange('');
    setUploadError(null);
    setUploadSuccess(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Cabeçalho do campo com dimensões recomendadas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
        <div>
          <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
            {label}
          </label>
          <div className="flex items-center gap-2 text-[10px] text-gray-500 pt-0.5">
            <span className="font-semibold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
              Recomendado: {config.recommendedDimensions}
            </span>
            <span>·</span>
            <span>{config.recommendedAspect}</span>
            <span>·</span>
            <span>Máx {config.maxSizeMb} MB</span>
          </div>
        </div>

        {/* Alternador de Modo: Upload vs URL */}
        <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setMode('upload');
              setUploadError(null);
            }}
            disabled={disabled || isUploading}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
              mode === 'upload'
                ? 'bg-white text-emerald-900 shadow-2xs font-bold'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <Upload className="w-3 h-3" />
            Upload
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('url');
              setUploadError(null);
            }}
            disabled={disabled || isUploading}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
              mode === 'url'
                ? 'bg-white text-emerald-900 shadow-2xs font-bold'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <LinkIcon className="w-3 h-3" />
            Link
          </button>
        </div>
      </div>

      {/* Pré-visualização da Imagem Atual */}
      {value && (
        <div className="flex items-center gap-3 p-2.5 bg-gray-50 border border-gray-200 rounded-xl shadow-2xs">
          <div
            className={`bg-gray-200 overflow-hidden shrink-0 border border-gray-300 ${
              imageType === 'logo'
                ? 'w-12 h-12 rounded-full'
                : imageType === 'banner'
                ? 'w-24 h-12 rounded-lg'
                : 'w-12 h-16 rounded-lg'
            }`}
          >
            <img
              src={value}
              alt="Pré-visualização"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src =
                  'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=200&h=200&fit=crop';
              }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-gray-800 truncate" title={value}>
              {value.includes('/catalog/')
                ? 'Imagem no Storage Delivery Channel'
                : 'Imagem Externa'}
            </p>
            <p className="text-[10px] text-gray-400 truncate font-mono">
              {value}
            </p>
          </div>

          <button
            type="button"
            onClick={handleClearImage}
            disabled={disabled || isUploading}
            title="Remover imagem do tema"
            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modo Upload de Arquivo com Barra de Progresso e Cancelar */}
      {mode === 'upload' && (
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            onChange={onFileInputChange}
            disabled={disabled || isUploading}
            className="hidden"
          />

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => {
              if (!disabled && !isUploading) {
                fileInputRef.current?.click();
              }
            }}
            className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-emerald-500 bg-emerald-50/60'
                : 'border-gray-300 hover:border-emerald-400 hover:bg-gray-50/70 bg-white'
            } ${disabled || isUploading ? 'opacity-80 cursor-default' : ''}`}
          >
            <div className="flex flex-col items-center justify-center gap-2">
              {isUploading ? (
                <div className="w-full space-y-2.5 max-w-xs">
                  <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                      Enviando imagem...
                    </span>
                    <span className="font-mono text-emerald-800">{uploadProgress}%</span>
                  </div>

                  {/* Barra de Progresso Real */}
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-all duration-200 rounded-full"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancelUpload();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors cursor-pointer"
                  >
                    <Ban className="w-3 h-3" />
                    Cancelar envio
                  </button>
                </div>
              ) : uploadSuccess ? (
                <>
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  <span className="text-xs text-emerald-800 font-bold">
                    Imagem enviada e pronta no rascunho!
                  </span>
                  <span className="text-[11px] text-gray-400">
                    Clique para selecionar outro arquivo se desejar substituir
                  </span>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div className="text-xs text-gray-700">
                    <span className="font-bold text-emerald-700">Clique para enviar</span> ou arraste o arquivo aqui
                  </div>
                  <span className="text-[10px] text-gray-400">
                    Formatos: PNG, JPG ou WEBP até {config.maxSizeMb} MB
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modo URL Externa (Link como alternativa) */}
      {mode === 'url' && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="https://images.unsplash.com/..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleUrlApply();
                }
              }}
              disabled={disabled || isUploading}
              className="flex-1 text-xs px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 bg-white"
            />
            <button
              type="button"
              onClick={handleUrlApply}
              disabled={disabled || isUploading}
              className="px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shrink-0"
            >
              Aplicar Link
            </button>
          </div>
          <span className="text-[10px] text-gray-400 block">
            Informe uma URL direta segura com HTTPS.
          </span>
        </div>
      )}

      {/* Alerta de Erro de Validação ou Envio */}
      {uploadError && (
        <div className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
};
