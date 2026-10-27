/**
 * Posição arrastável do botão flutuante de notificações.
 * O botão encaixa na borda mais próxima da tela (esquerda/direita/topo/base) e guardamos só a borda e a
 * posição relativa ao longo dela (0–1), então ele continua dentro da tela se a janela mudar de tamanho.
 */
export type Edge = 'left' | 'right' | 'top' | 'bottom';
export interface SavedPosition { edge: Edge; t: number }
export interface Viewport { w: number; h: number; /** Altura da barra fixa de ações (Salvar), px. */ bottomOffset: number }
export interface Size { w: number; h: number }
export interface Point { x: number; y: number }

export const EDGE_MARGIN = 12;
export const positionKey = (user: string) => `dc:notifications:pos:${user}`;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** Limites do canto superior esquerdo do botão: dentro da tela e acima da barra de ações. */
export function bounds(vp: Viewport, size: Size, margin = EDGE_MARGIN) {
  return { minX: margin, minY: margin, maxX: Math.max(margin, vp.w - size.w - margin), maxY: Math.max(margin, vp.h - Math.max(0, vp.bottomOffset) - size.h - margin) };
}

export function clampPoint(p: Point, vp: Viewport, size: Size, margin = EDGE_MARGIN): Point {
  const b = bounds(vp, size, margin);
  return { x: clamp(p.x, b.minX, b.maxX), y: clamp(p.y, b.minY, b.maxY) };
}

/** Converte a posição salva (borda + t) em coordenadas, sempre dentro dos limites. */
export function pointFromSaved(s: SavedPosition, vp: Viewport, size: Size, margin = EDGE_MARGIN): Point {
  const b = bounds(vp, size, margin);
  const t = clamp(s.t, 0, 1);
  switch (s.edge) {
    case 'left': return { x: b.minX, y: b.minY + t * (b.maxY - b.minY) };
    case 'right': return { x: b.maxX, y: b.minY + t * (b.maxY - b.minY) };
    case 'top': return { x: b.minX + t * (b.maxX - b.minX), y: b.minY };
    default: return { x: b.minX + t * (b.maxX - b.minX), y: b.maxY };
  }
}

/** Encaixa o ponto solto na borda mais próxima. */
export function snapToEdge(p: Point, vp: Viewport, size: Size, margin = EDGE_MARGIN): SavedPosition & Point {
  const b = bounds(vp, size, margin);
  const c = clampPoint(p, vp, size, margin);
  const d: Record<Edge, number> = { left: c.x - b.minX, right: b.maxX - c.x, top: c.y - b.minY, bottom: b.maxY - c.y };
  const edge = (Object.keys(d) as Edge[]).reduce((a, k) => (d[k] < d[a] ? k : a), 'right' as Edge);
  const along = edge === 'left' || edge === 'right'
    ? (b.maxY === b.minY ? 0 : (c.y - b.minY) / (b.maxY - b.minY))
    : (b.maxX === b.minX ? 0 : (c.x - b.minX) / (b.maxX - b.minX));
  const saved = { edge, t: clamp(along, 0, 1) };
  return { ...saved, ...pointFromSaved(saved, vp, size, margin) };
}

export function parseSaved(raw: string | null): SavedPosition | null {
  try {
    const v = JSON.parse(raw || 'null');
    if (!v || !['left', 'right', 'top', 'bottom'].includes(v.edge) || typeof v.t !== 'number' || !Number.isFinite(v.t)) return null;
    return { edge: v.edge, t: clamp(v.t, 0, 1) };
  } catch { return null; }
}
export function loadPosition(storage: Pick<Storage, 'getItem'>, user: string): SavedPosition | null {
  try { return parseSaved(storage.getItem(positionKey(user))); } catch { return null; }
}
export function savePosition(storage: Pick<Storage, 'setItem' | 'removeItem'>, user: string, pos: SavedPosition | null) {
  try { if (pos) storage.setItem(positionKey(user), JSON.stringify(pos)); else storage.removeItem(positionKey(user)); } catch { /* armazenamento indisponível */ }
}

export interface Placement { left: number; top?: number; bottom?: number; maxHeight: number; width: number; openUp: boolean; alignRight: boolean }
/**
 * Onde abrir um painel (ou aviso) preso ao botão: para o lado (cima/baixo) com mais espaço e alinhado
 * para a direção com mais espaço na horizontal. Nunca passa da barra fixa de ações nem da borda da tela.
 */
export function placePanel(pill: { x: number; y: number; w: number; h: number }, vp: Viewport, desired: Size, margin = EDGE_MARGIN, gap = 10): Placement {
  const width = Math.min(desired.w, vp.w - margin * 2);
  const floor = vp.h - Math.max(0, vp.bottomOffset) - margin;
  const above = pill.y - gap - margin;
  const below = floor - (pill.y + pill.h + gap);
  const openUp = above >= below;
  const maxHeight = Math.max(120, Math.min(desired.h, Math.floor(openUp ? above : below)));
  const roomRight = vp.w - pill.x, roomLeft = pill.x + pill.w;
  const fitsRight = roomRight >= width + margin, fitsLeft = roomLeft >= width + margin;
  const alignRight = fitsRight !== fitsLeft ? fitsLeft : roomLeft > roomRight;
  const rawLeft = alignRight ? pill.x + pill.w - width : pill.x;
  const left = clamp(rawLeft, margin, vp.w - width - margin);
  return openUp ? { left, bottom: vp.h - pill.y + gap, maxHeight, width, openUp, alignRight } : { left, top: pill.y + pill.h + gap, maxHeight, width, openUp, alignRight };
}
