import { useEffect, useRef, useState } from 'react';

const prefersReduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/** Anima suavemente (ease-out) de um número até o alvo; respeita "reduzir movimento". */
export function useAnimatedNumber(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (prefersReduced() || typeof requestAnimationFrame === 'undefined') { from.current = target; setValue(target); return; }
    const start = performance.now();
    const origin = from.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = origin + (target - origin) * eased;
      from.current = v;
      setValue(v);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current != null) cancelAnimationFrame(raf.current); };
  }, [target, durationMs]);
  return value;
}
