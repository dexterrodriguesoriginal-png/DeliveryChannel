import { describe, expect, it } from 'vitest';
import {
  HOME_TEMPLATES,
  HOME_TEMPLATES_FOR_EDITOR,
  DEFAULT_HOME_DESIGN,
  normalizeHomeDesign,
  safeHomeImageUrl,
  getHomeTemplate,
} from '../storeHome.model';

describe('storeHome.model', () => {
  it('possui 30 templates de segmento + oficial no editor', () => {
    expect(HOME_TEMPLATES).toHaveLength(30);
    expect(HOME_TEMPLATES_FOR_EDITOR).toHaveLength(31);
    expect(new Set(HOME_TEMPLATES.map(t => t.id)).size).toBe(30);
  });

  it('preserva o padrão adega ao receber dados inválidos', () => {
    const design = normalizeHomeDesign(null);
    expect(design.version).toBe(1);
    expect(design.templateId).toBe(DEFAULT_HOME_DESIGN.templateId);
    expect(design.headerTitle).toBe('Bem-vindo(a)!');
  });

  it('mantém o botão do cardápio obrigatório e sem duplicar', () => {
    expect(normalizeHomeDesign({ actions: ['WAITER', 'ACCOUNT'] }).actions).toContain('MENU');
    expect(normalizeHomeDesign({ actions: ['MENU', 'MENU', 'ACCOUNT'] }).actions).toEqual(['MENU', 'ACCOUNT']);
    expect(normalizeHomeDesign({ actions: [] }).actions).toEqual(['MENU']);
  });

  it('bloqueia URLs perigosas e aceita https', () => {
    expect(safeHomeImageUrl('javascript:alert(1)')).toBe('');
    expect(safeHomeImageUrl('data:text/html,<script>')).toBe('');
    expect(safeHomeImageUrl('http://exemplo.com/a.png')).toBe('');
    expect(safeHomeImageUrl('https://user:pass@exemplo.com/a.png')).toBe('');
    expect(safeHomeImageUrl('https://example.com/banner.webp')).toBe('https://example.com/banner.webp');
  });

  it('limita números e blur', () => {
    expect(normalizeHomeDesign({ logoSize: 900 }).logoSize).toBe(136);
    expect(normalizeHomeDesign({ overlayOpacity: 3 }).overlayOpacity).toBe(0.9);
    expect(normalizeHomeDesign({ backgroundBlur: 99 }).backgroundBlur).toBe(20);
    expect(normalizeHomeDesign({ backgroundBlur: -1 }).backgroundBlur).toBe(0);
  });

  it('usa o modelo padrão para ID desconhecido', () => {
    expect(getHomeTemplate('modelo-inexistente').id).toBe('dc-oficial');
  });

  it('preserva tagline e footer', () => {
    const design = normalizeHomeDesign({
      tagline: 'BEBIDAS • PETISCOS',
      footerTitle: 'OFERTAS ESPECIAIS',
    });
    expect(design.tagline).toBe('BEBIDAS • PETISCOS');
    expect(design.footerTitle).toBe('OFERTAS ESPECIAIS');
  });
});
