import React, { useState, useRef } from 'react';
import { Upload, Link as LinkIcon, Image as ImageIcon, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export interface ImageUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  tenantId: string;
  entityType: 'categories' | 'products' | 'offers';
  label?: string;
  description?: string;
  disabled?: boolean;
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  value,
  onChange,
  tenantId,
  entityType,
  label = 'Imagem',
  description,
  disabled = false,
}) => {
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [urlInput, setUrlInput] = useState(value || '');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    setUploadError(null);
    setUploadSuccess(false);

    // 1. Validação de formato
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError('Formato não suportado. Utilize arquivos JPG, PNG ou WEBP.');
      return;
    }

    // 2. Validação de tamanho (máximo 5MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setUploadError(`Arquivo muito grande (${sizeMb} MB). O tamanho máximo permitido é de 5 MB.`);
      return;
    }

    if (!tenantId) {
      setUploadError('Identificador do estabelecimento não encontrado.');
      return;
    }

    setIsUploading(true);

    try {
      // 3. Determina extensão segura
      const ext = file.name.split('.').pop()?.toLowerCase() || 'webp';
      const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'webp';
      const fileId = crypto.randomUUID();
      
      // Estrutura estrita multi-tenant: catalog/{tenant_id}/{entity_type}/{uuid}.{ext}
      const filePath = `${tenantId}/${entityType}/${fileId}.${safeExt}`;

      // 4. Upload para o Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from('catalog')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        });

      if (uploadErr) {
        console.error('[ImageUploader] Falha no upload para Storage:', uploadErr);
        throw new Error(uploadErr.message || 'Erro ao enviar imagem ao armazenamento.');
      }

      // 5. Obtenção da URL pública
      const { data: publicUrlData } = supabase.storage
        .from('catalog')
        .getPublicUrl(filePath);

      if (!publicUrlData?.publicUrl) {
        throw new Error('Não foi possível obter a URL pública do arquivo enviado.');
      }

      const finalUrl = publicUrlData.publicUrl;
      setUrlInput(finalUrl);
      onChange(finalUrl);
      setUploadSuccess(true);
    } catch (err: any) {
      console.error('[ImageUploader] Erro no processo de upload:', err);
      setUploadError(err.message || 'Falha ao processar o upload do arquivo.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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

  const handleUrlApply = () => {
    const clean = urlInput.trim();
    setUploadError(null);
    if (!clean) {
      onChange('');
      return;
    }
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      setUploadError('Informe uma URL válida iniciando com https://');
      return;
    }
    onChange(clean);
  };

  const handleClear = () => {
    setUrlInput('');
    onChange('');
    setUploadError(null);
    setUploadSuccess(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-gray-700">
          {label}
        </label>
        <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => { setMode('upload'); setUploadError(null); }}
            disabled={disabled || isUploading}
            className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 cursor-pointer ${
              mode === 'upload' 
                ? 'bg-white text-emerald-800 shadow-xs font-semibold' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Upload className="w-3 h-3" />
            Upload
          </button>
          <button
            type="button"
            onClick={() => { setMode('url'); setUploadError(null); }}
            disabled={disabled || isUploading}
            className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 cursor-pointer ${
              mode === 'url' 
                ? 'bg-white text-emerald-800 shadow-xs font-semibold' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <LinkIcon className="w-3 h-3" />
            URL
          </button>
        </div>
      </div>

      {description && (
        <p className="text-[11px] text-gray-500">{description}</p>
      )}

      {/* Preview e Ações */}
      {value && (
        <div className="flex items-center gap-3 p-2 bg-gray-50 border border-gray-200 rounded-xl">
          <div className="w-14 h-14 rounded-lg bg-gray-200 overflow-hidden shrink-0 border border-gray-200">
            <img 
              src={value} 
              alt="Preview" 
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=200&h=200&fit=crop';
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-800 truncate" title={value}>
              {value.includes('/storage/v1/object/public/catalog/') ? 'Imagem no Storage do AdegaFood' : value}
            </p>
            <p className="text-[10px] text-gray-400 truncate">
              {value.startsWith('http') ? new URL(value).hostname : 'Arquivo carregado'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled || isUploading}
            title="Remover imagem"
            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modo Upload de Arquivo */}
      {mode === 'upload' && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
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
            className={`border-2 border-dashed rounded-xl p-3.5 text-center cursor-pointer transition-all ${
              isDragging 
                ? 'border-emerald-500 bg-emerald-50/50' 
                : 'border-gray-300 hover:border-emerald-400 hover:bg-gray-50/70 bg-white'
            } ${disabled || isUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <div className="flex flex-col items-center justify-center gap-1.5">
              {isUploading ? (
                <>
                  <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                  <span className="text-xs text-gray-600 font-medium">Enviando para o Supabase Storage...</span>
                </>
              ) : uploadSuccess ? (
                <>
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  <span className="text-xs text-emerald-700 font-medium">Imagem enviada com sucesso!</span>
                  <span className="text-[11px] text-gray-400">Clique para substituir por outro arquivo</span>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div className="text-xs text-gray-600">
                    <span className="font-semibold text-emerald-700">Clique para enviar</span> ou arraste o arquivo aqui
                  </div>
                  <span className="text-[10px] text-gray-400">
                    JPG, PNG ou WEBP até 5 MB
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modo URL Externa */}
      {mode === 'url' && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="url"
                placeholder="https://images.unsplash.com/..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onBlur={handleUrlApply}
                disabled={disabled || isUploading}
                className="w-full text-xs px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            <button
              type="button"
              onClick={handleUrlApply}
              disabled={disabled || isUploading}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0"
            >
              Aplicar
            </button>
          </div>
          <span className="text-[10px] text-gray-400 block">
            Cole uma URL pública de imagem hospedada externamente.
          </span>
        </div>
      )}

      {/* Mensagem de Erro */}
      {uploadError && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 border border-rose-200 p-2 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
};
