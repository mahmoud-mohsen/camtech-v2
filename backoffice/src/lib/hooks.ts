import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { App } from 'antd';
import { useMemo } from 'react';
import { errorMessage } from '../api/client';
import { catalogApi, clientAppsApi, settingsApi, tenantApi, tenantSettingsApi } from '../api/configuration';
import type { ConfigParam } from '../api/types';

/** Reason codes catalogue, cached for the whole app. */
export function useReasonCodes() {
  return useQuery({ queryKey: ['reason-codes'], queryFn: catalogApi.reasonCodes, staleTime: 5 * 60_000 });
}

/** code -> English message lookup (falls back to the code). */
export function useReasonMessage() {
  const { data } = useReasonCodes();
  return useMemo(() => {
    const map = new Map((data ?? []).map((r) => [r.code, r.messageEn]));
    return (code: string | null | undefined) => (code ? (map.get(code) ?? null) : null);
  }, [data]);
}

/** tenantId -> tenant code (from GET /v2/admin/tenants); falls back to the id while loading or when unknown. */
export function useTenantCode() {
  const { data } = useQuery({ queryKey: ['tenants'], queryFn: tenantApi.list, staleTime: 5 * 60_000 });
  return useMemo(() => {
    const map = new Map((data ?? []).map((t) => [t.id, t.code]));
    return (id: number | null | undefined) => (id === null || id === undefined ? '—' : (map.get(id) ?? `#${id}`));
  }, [data]);
}

export function useFlows() {
  return useQuery({ queryKey: ['flows'], queryFn: catalogApi.flows, staleTime: 5 * 60_000 });
}

export function useClientApps() {
  return useQuery({ queryKey: ['client-apps'], queryFn: clientAppsApi.list, staleTime: 60_000 });
}

export function useTenants() {
  return useQuery({ queryKey: ['tenants'], queryFn: tenantApi.list, staleTime: 60_000 });
}

/** Query keys start like the default tenant's ones, so invalidating ['config-params'] refreshes every tenant. */
export function useTenantConfigParams(tenantId: number) {
  return useQuery({ queryKey: ['config-params', 'tenant', tenantId], queryFn: tenantSettingsApi(tenantId).params });
}

export function useTenantClientApps(tenantId: number) {
  return useQuery({ queryKey: ['client-apps', 'tenant', tenantId], queryFn: () => tenantApi.clientApps(tenantId), staleTime: 60_000 });
}

export function useTenantEntitlements(tenantId: number) {
  return useQuery({ queryKey: ['entitlements', 'tenant', tenantId], queryFn: () => tenantApi.tenantEntitlements(tenantId) });
}

export function useConfigParams() {
  return useQuery({ queryKey: ['config-params'], queryFn: settingsApi.params });
}

export interface SimilarityThresholds {
  review: number;
  match: number;
  excellent: number;
}

export const DEFAULT_THRESHOLDS: SimilarityThresholds = { review: 0.28, match: 0.4, excellent: 0.7 };

function globalValue(params: ConfigParam[] | undefined, key: string, fallback: number): number {
  const p = params?.find((x) => x.paramKey === key && !x.flowCode && !x.channel && !x.clientAppCode);
  const n = p ? Number(p.paramValue) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Face-match band thresholds from the global settings (derived client-side; defaults if unavailable). */
export function useSimilarityThresholds(): SimilarityThresholds {
  const { data } = useConfigParams();
  return useMemo(
    () => ({
      review: globalValue(data, 'face.review_similarity', DEFAULT_THRESHOLDS.review),
      match: globalValue(data, 'face.doc_match_similarity', DEFAULT_THRESHOLDS.match),
      excellent: globalValue(data, 'face.excellent_similarity', DEFAULT_THRESHOLDS.excellent),
    }),
    [data],
  );
}

/**
 * Mutation with the standard UX: success toast, error toast, and invalidation of related queries.
 */
export function useApiMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: {
    success?: string | ((r: TResult, v: TVars) => string);
    invalidate?: QueryKey[];
    onSuccess?: (r: TResult, v: TVars) => void;
    /** Return true to suppress the default error toast. */
    onError?: (err: unknown, v: TVars) => boolean | void;
  } = {},
) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      if (opts.success) message.success(typeof opts.success === 'function' ? opts.success(r, v) : opts.success);
      opts.onSuccess?.(r, v);
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
    },
    onError: (err, v) => {
      if (opts.onError?.(err, v) === true) return;
      message.error(errorMessage(err));
    },
  });
}
