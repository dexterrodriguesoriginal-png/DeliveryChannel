import { describe, it, expect } from 'vitest';
import {
  validateThemeImageFile,
  buildThemeStoragePath,
  validateAndSanitizeThemeImageUrl,
  THEME_IMAGE_CONFIGS,
  THEME_STORAGE_BUCKET,
} from '../themeUploads';

describe('Validação de Uploads no Design do App (ThemeUploads)', () => {
  describe('Configurações e Metadados', () => {
    it('utiliza o bucket oficial "catalog" do Supabase Storage', () => {
      expect(THEME_STORAGE_BUCKET).toBe('catalog');
    });

    it('define dimensões recomendadas e limites corretos para logo, capa e fundo', () => {
      expect(THEME_IMAGE_CONFIGS.logo.recommendedDimensions).toBe('512 × 512 px');
      expect(THEME_IMAGE_CONFIGS.logo.maxSizeMb).toBe(2);
      expect(THEME_IMAGE_CONFIGS.logo.maxSizeBytes).toBe(2 * 1024 * 1024);

      expect(THEME_IMAGE_CONFIGS.banner.recommendedDimensions).toBe('1200 × 400 px');
      expect(THEME_IMAGE_CONFIGS.banner.maxSizeMb).toBe(5);
      expect(THEME_IMAGE_CONFIGS.banner.maxSizeBytes).toBe(5 * 1024 * 1024);

      expect(THEME_IMAGE_CONFIGS.background.recommendedDimensions).toBe('1080 × 1920 px');
      expect(THEME_IMAGE_CONFIGS.background.maxSizeMb).toBe(5);
      expect(THEME_IMAGE_CONFIGS.background.maxSizeBytes).toBe(5 * 1024 * 1024);
    });
  });

  describe('validateThemeImageFile — Formatos Permitidos', () => {
    it('aceita arquivos PNG, JPG, JPEG e WEBP', () => {
      const validFiles = [
        { name: 'logo.png', type: 'image/png', size: 100 * 1024 },
        { name: 'foto.jpg', type: 'image/jpeg', size: 500 * 1024 },
        { name: 'foto.jpeg', type: 'image/jpeg', size: 800 * 1024 },
        { name: 'imagem.webp', type: 'image/webp', size: 300 * 1024 },
      ];

      for (const f of validFiles) {
        expect(validateThemeImageFile(f, 'logo').valid).toBe(true);
        expect(validateThemeImageFile(f, 'banner').valid).toBe(true);
        expect(validateThemeImageFile(f, 'background').valid).toBe(true);
      }
    });

    it('rejeita formatos não suportados com mensagem clara em português', () => {
      const invalidFiles = [
        { name: 'animacao.gif', type: 'image/gif', size: 100 * 1024 },
        { name: 'vetor.svg', type: 'image/svg+xml', size: 50 * 1024 },
        { name: 'documento.pdf', type: 'application/pdf', size: 200 * 1024 },
        { name: 'script.js', type: 'application/javascript', size: 10 * 1024 },
      ];

      for (const f of invalidFiles) {
        const resLogo = validateThemeImageFile(f, 'logo');
        expect(resLogo.valid).toBe(false);
        expect(resLogo.error).toContain('Formato não suportado');
        expect(resLogo.error).toContain('PNG, JPG ou WEBP');
      }
    });

    it('rejeita arquivo vazio (0 bytes)', () => {
      const emptyFile = { name: 'vazio.png', type: 'image/png', size: 0 };
      const res = validateThemeImageFile(emptyFile, 'logo');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('vazio');
    });
  });

  describe('validateThemeImageFile — Limites de Tamanho', () => {
    it('para logo: aceita até 2 MB e rejeita acima de 2 MB', () => {
      const okFile = { name: 'logo.png', type: 'image/png', size: 2 * 1024 * 1024 }; // exatamente 2MB
      const bigFile = { name: 'logo.png', type: 'image/png', size: 2 * 1024 * 1024 + 1024 }; // 2MB + 1KB

      expect(validateThemeImageFile(okFile, 'logo').valid).toBe(true);

      const resBig = validateThemeImageFile(bigFile, 'logo');
      expect(resBig.valid).toBe(false);
      expect(resBig.error).toContain('Arquivo muito grande');
      expect(resBig.error).toContain('2 MB');
    });

    it('para capa/banner: aceita até 5 MB e rejeita acima de 5 MB', () => {
      const okFile = { name: 'banner.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 }; // 5MB
      const bigFile = { name: 'banner.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 + 2048 }; // 5MB + 2KB

      expect(validateThemeImageFile(okFile, 'banner').valid).toBe(true);

      const resBig = validateThemeImageFile(bigFile, 'banner');
      expect(resBig.valid).toBe(false);
      expect(resBig.error).toContain('Arquivo muito grande');
      expect(resBig.error).toContain('5 MB');
    });

    it('para fundo: aceita até 5 MB e rejeita acima de 5 MB', () => {
      const okFile = { name: 'bg.webp', type: 'image/webp', size: 4.8 * 1024 * 1024 };
      const bigFile = { name: 'bg.webp', type: 'image/webp', size: 5.2 * 1024 * 1024 };

      expect(validateThemeImageFile(okFile, 'background').valid).toBe(true);

      const resBig = validateThemeImageFile(bigFile, 'background');
      expect(resBig.valid).toBe(false);
      expect(resBig.error).toContain('5 MB');
    });
  });

  describe('buildThemeStoragePath — Estrutura de Caminhos no Storage', () => {
    it('gera caminho estrito sob o ID da loja: <tenantId>/theme/<tipo>-<timestamp>.<ext>', () => {
      const tenantId = '11111111-2222-3333-4444-555555555555';
      const timestamp = 1729410000000;

      const logoPath = buildThemeStoragePath(tenantId, 'logo', 'meu-logo.png', timestamp);
      expect(logoPath).toBe('11111111-2222-3333-4444-555555555555/theme/logo-1729410000000.png');

      const bannerPath = buildThemeStoragePath(tenantId, 'banner', 'capa_promocional.JPG', timestamp);
      expect(bannerPath).toBe('11111111-2222-3333-4444-555555555555/theme/banner-1729410000000.jpg');

      const bgPath = buildThemeStoragePath(tenantId, 'background', 'fundo_textura.WEBP', timestamp);
      expect(bgPath).toBe('11111111-2222-3333-4444-555555555555/theme/background-1729410000000.webp');
    });

    it('higieniza extensões desconhecidas para webp', () => {
      const path = buildThemeStoragePath('loja-1', 'logo', 'arquivo_sem_ext', 12345);
      expect(path).toBe('loja-1/theme/logo-12345.webp');
    });
  });

  describe('validateAndSanitizeThemeImageUrl — Segurança com safeImageUrl', () => {
    it('aceita URLs HTTPS legítimas do Supabase e CDN externa', () => {
      const storageUrl = 'https://xyz.supabase.co/storage/v1/object/public/catalog/tenant/theme/logo-1.webp';
      const unsplashUrl = 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500';

      expect(validateAndSanitizeThemeImageUrl(storageUrl)).toBe(storageUrl);
      expect(validateAndSanitizeThemeImageUrl(unsplashUrl)).toBe(unsplashUrl);
    });

    it('rejeita esquemas inseguros ou tentativas de escape CSS', () => {
      expect(validateAndSanitizeThemeImageUrl('javascript:alert(1)')).toBe('');
      expect(validateAndSanitizeThemeImageUrl('http://inseguro.com/logo.png')).toBe('');
      expect(validateAndSanitizeThemeImageUrl('https://example.com/logo.png"); background: red;')).toBe('');
      expect(validateAndSanitizeThemeImageUrl('')).toBe('');
      expect(validateAndSanitizeThemeImageUrl(null)).toBe('');
    });
  });
});
