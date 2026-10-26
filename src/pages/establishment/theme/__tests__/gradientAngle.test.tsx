// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { GradientAngleControl, normalizeAngle, ANGLE_PRESETS } from '../tabs/GradientAngleControl';
import { themeToTokens, tokensToTheme, formatCssBackground, getSurfaceBackgroundStyle } from '../../../../lib/theme/themeEngine';

describe('Ângulo do gradiente', () => {
  it('tem slider 0–360, campo numérico e atalhos 0/45/90/135/180', () => {
    const onChange = vi.fn();
    const ui = render(<GradientAngleControl angle={90} onChange={onChange} />);
    const range = ui.getByTestId('gradient-angle-range') as HTMLInputElement;
    expect(range.min).toBe('0'); expect(range.max).toBe('360'); expect(range.value).toBe('90');
    expect((ui.getByTestId('gradient-angle-input') as HTMLInputElement).value).toBe('90');
    expect(ANGLE_PRESETS).toEqual([0, 45, 90, 135, 180]);
    fireEvent.change(range, { target: { value: '210' } });
    expect(onChange).toHaveBeenLastCalledWith(210);
    fireEvent.change(ui.getByTestId('gradient-angle-input'), { target: { value: '999' } });
    expect(onChange).toHaveBeenLastCalledWith(360);
    fireEvent.click(ui.getByTestId('gradient-angle-preset-45'));
    expect(onChange).toHaveBeenLastCalledWith(45);
    expect(ui.getByTestId('gradient-angle-preset-90').getAttribute('aria-pressed')).toBe('true');
  });
  it('normaliza valores inválidos', () => {
    expect(normalizeAngle('abc', 135)).toBe(135);
    expect(normalizeAngle(-5)).toBe(0);
    expect(normalizeAngle(44.6)).toBe(45);
  });
  it('ida e volta: salvar e recarregar mantém o ângulo e o app aplica no CSS', () => {
    const tokens = themeToTokens({ primaryColor: '#7c3aed' });
    tokens.backgrounds.general = { ...tokens.backgrounds.general, type: 'gradient-linear', gradientColors: ['#faf5ff', '#ede9fe'], gradientStops: 2, angle: 222 };
    const saved = JSON.parse(JSON.stringify(tokensToTheme(tokens, {} as any)));
    const reloaded = themeToTokens(saved);
    expect(reloaded.backgrounds.general.angle).toBe(222);
    expect(formatCssBackground(reloaded.backgrounds.general)).toContain('222deg');
    const style = getSurfaceBackgroundStyle(reloaded.backgrounds.general, '#faf5ff') as Record<string, string>;
    expect(JSON.stringify(style)).toContain('222deg');
  });
});
