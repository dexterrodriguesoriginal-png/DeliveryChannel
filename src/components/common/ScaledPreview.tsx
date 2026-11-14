import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fitScale } from './PhonePreview';

/** Measures the available column, independently of the transformed device's size. */
export function ScaledPreview({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const availableHeight = Math.min(el.clientHeight || height, window.innerHeight - el.getBoundingClientRect().top - 16);
      setScale(fitScale(el.clientWidth, availableHeight, width, height));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [width, height]);
  return <div ref={ref} style={{ flex: '1 1 0', minHeight: 0, minWidth: 0, position: 'relative', width: '100%' }}>
    <div style={{ position: 'absolute', left: '50%', width: width * scale, height: height * scale, transform: 'translateX(-50%)' }}>
      <div data-testid="scaled-preview" data-scale={scale} style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  </div>;
}
