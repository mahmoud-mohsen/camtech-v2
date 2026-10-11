import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface Size {
  width: number;
  height: number;
}

/** Observes an element's content size. Returns a ref callback and the size. */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, Size, T | null] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const update = () => {
      // Layout size, not getBoundingClientRect: that one includes transforms, so a stage measured during its
      // entrance animation (scaled to 104%) kept a too-large size and the document frame ran off the screen.
      const r = { width: el.offsetWidth, height: el.offsetHeight };
      setSize((s) => (Math.round(s.width) === Math.round(r.width) && Math.round(s.height) === Math.round(r.height) ? s : r));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size, el];
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
    const mq = window.matchMedia(query);
    mq.addEventListener?.('change', cb);
    return () => mq.removeEventListener?.('change', cb);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** A value that is true only after `ms` have passed since `active` became true. */
export function useDelayedFlag(active: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) {
      setOn(false);
      return;
    }
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return on;
}

/** Ticks every `ms` while `active`, returning Date.now(). */
export function useNow(ms: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

/** Latest value in a ref, for callbacks used inside long-lived effects. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** An AbortController per mounted component; aborted on unmount. */
export function useAbortSignal(): () => AbortSignal {
  const ref = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    ref.current = c;
    return () => c.abort();
  }, []);
  return useCallback(() => {
    ref.current ??= new AbortController();
    return ref.current.signal;
  }, []);
}
