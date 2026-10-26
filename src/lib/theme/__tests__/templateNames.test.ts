import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../templates';

// O nome do modelo começa pela cor principal: "Azul ..." precisa ter cor principal azul.
const LEADING_COLOR: Array<[RegExp, string[]]> = [
  [/^(azul|marinho|petr[óo]leo|royal|turquesa)/i, ['azul']],
  [/^(verde|oliva|esmeralda|menta|musgo|s[áa]lvia|matcha)/i, ['verde']],
  [/^(vermelho|bord[ôo]|carmim|rubi|cereja|escarlate|brasa)/i, ['vermelho', 'marrom']],
  [/^(laranja|terracota|coral|tangerina)/i, ['laranja']],
  [/^(amarelo|dourado|mostarda|lim[ãa]o)/i, ['amarelo', 'marrom']],
  [/^(roxo|violeta|lil[áa]s|lavanda|ameixa|uva)/i, ['roxo']],
  [/^(rosa|pink|magenta|f[úu]csia)/i, ['rosa']],
];
const hue = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return -1;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

describe('nomes dos modelos batem com as cores', () => {
  it('a cor citada no início do nome é a família da cor principal', () => {
    const wrong = TEMPLATES.filter((t) => {
      const rule = LEADING_COLOR.find(([re]) => re.test(t.name));
      return rule && !rule[1].includes(t.colorFamily);
    }).map((t) => `${t.id}: ${t.name} (${t.colorFamily})`);
    expect(wrong).toEqual([]);
  });
  it('modelos azuis têm a cor principal realmente azul', () => {
    for (const t of TEMPLATES.filter((x) => x.colorFamily === 'azul')) {
      const h = hue(t.tokens.palette.primary);
      expect(h, `${t.id} ${t.tokens.palette.primary}`).toBeGreaterThanOrEqual(170);
      expect(h, `${t.id} ${t.tokens.palette.primary}`).toBeLessThan(255);
    }
  });
});
