import { SEGMENTS } from './templates';
import { ThemedProductItem } from '../../components/storefront/ThemedProductList';

export function resolveSegment(category?: string): string | undefined {
  if (!category) return undefined;
  const normalized = category
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const aliases: Record<string, string> = { burger: 'hamburgueria', restaurante: 'marmitaria' };
  return SEGMENTS.find(
    (s) =>
      s.id === (aliases[normalized] || normalized) ||
      s.label
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') === normalized
  )?.id;
}
export function sampleProducts(segmentId = 'adega'): ThemedProductItem[] {
  const segment = SEGMENTS.find((s) => s.id === segmentId) || SEGMENTS[0];
  return segment.sampleProducts.map((p, index) => ({
    id: `sample-${segment.id}-${index}`,
    name: p.name,
    description: p.description,
    price: p.price,
    promotionalPrice:
      index === 0
        ? 'R$ ' +
          (Number(p.price.replace(/[^\d,]/g, '').replace(',', '.')) * 0.8)
            .toFixed(2)
            .replace('.', ',')
        : undefined,
    imageUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="100%" height="100%" fill="#eee9e2"/><text x="50%" y="55%" font-size="72" text-anchor="middle" dominant-baseline="middle">${p.emoji}</text></svg>`)}`,
    isAvailable: true,
  }));
}
