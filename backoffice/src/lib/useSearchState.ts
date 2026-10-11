import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List filters kept in the URL query string, so a filtered view can be shared and survives reloads.
 * Changing any filter other than `page` resets paging to the first page.
 */
export function useSearchState<K extends string>(keys: readonly K[], defaults: Partial<Record<K | 'page' | 'size', string>> = {}) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const out = {} as Record<K | 'page' | 'size', string | undefined>;
    for (const k of [...keys, 'page', 'size'] as (K | 'page' | 'size')[]) out[k] = params.get(k) ?? defaults[k] ?? undefined;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = useCallback(
    (patch: Partial<Record<K | 'page' | 'size', string | null | undefined>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [string, string | null | undefined][]) {
            if (v === null || v === undefined || v === '') next.delete(k);
            else next.set(k, v);
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  const page = Number(values.page ?? 0) || 0;
  const size = Number(values.size ?? 20) || 20;
  return { values, set, reset, page, size };
}
