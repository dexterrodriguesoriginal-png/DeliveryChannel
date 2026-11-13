import { writeFileSync } from 'node:fs';
import { SEGMENT_PALETTES, hslToHex, getLuminance, type NamedPalette, type ColorFamily } from '../src/lib/theme/templates/palettes';
import { SEGMENTS } from '../src/lib/theme/templates/segments';
import { deltaE2000, isNearDuplicate } from '../src/lib/theme/colorDistance';
import { assembleTemplateTokens } from '../src/lib/theme/templates/catalog';
import { isVisualNearDuplicate } from '../src/lib/theme/visualSignature';
import type { StoreTemplate } from '../src/types/theme';
let seed = 500;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const all = [...SEGMENT_PALETTES];
const extra: NamedPalette[] = [];
const counters: Record<string, number> = {};
const complete = (pal: NamedPalette, index: number): StoreTemplate => ({ ...pal, segmentLabel: pal.segmentId, tokens: assembleTemplateTokens(pal, index) });
const compositions = all.map(pal => { const index = counters[pal.segmentId] || 0; counters[pal.segmentId] = index + 1; return complete(pal, index); });
const families: [ColorFamily, number, number, string][] = [
 ['azul',195,245,'Safira'],['verde',80,165,'Botânico'],['amarelo',42,62,'Âmbar'],['vermelho',350,370,'Rubi'],['roxo',263,295,'Ametista'],['rosa',305,340,'Orquídea'],['laranja',18,38,'Terracota'],['marrom',25,45,'Cacau'],['neutros',0,360,'Grafite']
];
const finishes = ['Editorial', 'Artesanal', 'Vibrante', 'Minimalista', 'Elegante', 'Contemporâneo', 'Orgânico'];
for (let round=0; round<14; round++) for (const segment of SEGMENTS) {
 const mode = round % 2 ? 'dark' : 'light';
 let found = false;
 for (let attempt=0; attempt<200000; attempt++) {
  const [family,lo,hi,label] = families[Math.floor(random()*families.length)];
  const h = lo + random()*(hi-lo);
  const s = family === 'neutros' ? .02 + random()*.08 : family === 'marrom' ? .25+random()*.3 : .4+random()*.55;
  const l = family === 'marrom' ? .16+random()*.27 : .12+random()*.7;
  const primary = hslToHex(h,s,l);
  if (all.some(p=>p.segmentId===segment.id && deltaE2000(p.base.primary,primary)<12)) continue;
  const bgHue=random()*360;
  const bg = hslToHex(bgHue,.15+random()*.7, mode==='light' ? .944+random()*.045 : .025+random()*.19);
  if (mode==='light' && getLuminance(bg)<=.80) continue;
  if (all.some(p=>isNearDuplicate({id:'',segmentId:'',primary,secondary:'',bg},{id:p.id,segmentId:p.segmentId,primary:p.base.primary,secondary:p.base.secondary,bg:p.base.bg!}))) continue;
  const finish=finishes[Math.floor(round/2)];
  const pal: NamedPalette={id:`${segment.id}-colecao-${round+7}`,name:`${segment.label} · ${label} ${finish} ${mode==='light'?'Claro':'Noturno'}`,segmentId:segment.id,colorFamily:family,shade:`${label.toLowerCase()}-${l<.35?'profundo':l>.6?'luminoso':'intenso'}`,style:[finish.toLowerCase(),mode==='light'?'claro':'escuro'],mode,base:{primary,secondary:hslToHex(h+25,s,Math.max(.1,l-.12)),accent:hslToHex(h+150,.6,mode==='light'?.35:.72),bg,surface:hslToHex(h,.15+random()*.25,mode==='light'?.97:.06+random()*.07),text:hslToHex(h,.2,mode==='light'?.12:.95)}};
  const composition = complete(pal, round + 6);
  if (compositions.some(other => isVisualNearDuplicate(composition, other))) continue;
  compositions.push(composition);
  all.push(pal); extra.push(pal); found=true; break;
 }
 if(!found) throw new Error(`Cannot place ${segment.id} ${round}`);
}
writeFileSync('src/lib/theme/templates/expandedPalettes.ts',`/** 350 additional compositions, generated with seed 500. See docs/design-app-500.md. */\nimport type { NamedPalette } from './palettes';\nexport const EXPANDED_PALETTES: NamedPalette[] = ${JSON.stringify(extra,null,2)};\n`);
console.log({total:all.length,extra:extra.length});
