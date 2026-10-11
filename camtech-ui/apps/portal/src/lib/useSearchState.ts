import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

type Key<K extends string> = K | 'page' | 'size';

/**
 * List filters kept in the URL query string, so a filtered view can be shared and survives reloads.
 * Changing any filter other than `page` resets paging to the first page.
 */
export function useSearchState<K extends string>(keys: readonly K[], defaults: Partial<Record<Key<K>, string>> = {}) {
  const [params, setParams] = useSearchParams();
  // Stable identities so callers can pass inline literals.
  const keyList = keys.join('|');
  const defaultsKey = JSON.stringify(defaults);

  const values = useMemo(() => {
    const d = JSON.parse(defaultsKey) as Partial<Record<string, string>>;
    const out: Partial<Record<string, string>> = {};
    for (const k of [...keyList.split('|'), 'page', 'size']) out[k] = params.get(k) ?? d[k] ?? undefined;
    return out as Partial<Record<Key<K>, string>>;
  }, [params, keyList, defaultsKey]);

  const set = useCallback(
    (patch: Partial<Record<Key<K>, string | null | undefined>>) => {
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
