import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { App } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { describeError } from '../auth/useAuth';

export const qk = {
  dashboard: (days: number) => ['dashboard', days] as const,
  entitlements: ['entitlements'] as const,
  sessions: (q: object) => ['sessions', q] as const,
  session: (id: string) => ['session', id] as const,
  scans: (q: object) => ['scans', q] as const,
  scan: (id: number) => ['scan', id] as const,
  ocrSettings: ['document-ocr-settings'] as const,
  clientApps: ['client-apps'] as const,
  capabilities: (id: number) => ['capabilities', id] as const,
  credentials: (id: number) => ['credentials', id] as const,
  webhooks: ['webhooks'] as const,
  deliveries: (id: number, page: number) => ['deliveries', id, page] as const,
  flows: ['flows'] as const,
  duplicateSearch: ['duplicate-search'] as const,
  branding: ['branding'] as const,
  audit: (q: object) => ['audit', q] as const,
  reasonCodes: ['reason-codes'] as const,
  documents: (q: object) => ['documents', q] as const,
  document: (id: number) => ['document', id] as const,
  parties: (q: object) => ['parties', q] as const,
  party: (id: number) => ['party', id] as const,
  reviewSummary: ['review-summary'] as const,
  reviewSettings: ['review-settings'] as const,
  reviewCases: (q: object) => ['review-cases', q] as const,
  reviewCase: (id: number) => ['review-case', id] as const,
  documentSettings: ['document-settings'] as const,
  retention: ['retention-policies'] as const,
};

/** What waits for a person (badge in the nav, banner on the reviews pages). Refreshed every minute. */
export function useReviewSummary() {
  return useQuery({ queryKey: qk.reviewSummary, queryFn: api.reviewSummary, refetchInterval: 60_000, staleTime: 15_000 });
}

export function useDocumentSettings() {
  return useQuery({ queryKey: qk.documentSettings, queryFn: api.documentSettings, staleTime: 60_000 });
}

export function useClientApps() {
  return useQuery({ queryKey: qk.clientApps, queryFn: api.clientApps, staleTime: 60_000 });
}

export function useEntitlements() {
  return useQuery({ queryKey: qk.entitlements, queryFn: api.entitlements, staleTime: 60_000 });
}

export function useWebhooks() {
  return useQuery({ queryKey: qk.webhooks, queryFn: api.webhooks });
}

export function useReasonCodes() {
  return useQuery({ queryKey: qk.reasonCodes, queryFn: api.reasonCodes, staleTime: 10 * 60_000 });
}

/** code -> English message lookup (null when unknown). */
export function useReasonMessage() {
  const { data } = useReasonCodes();
  return useMemo(() => {
    const map = new Map((data ?? []).map((r) => [r.code, r.messageEn]));
    return (code: string | null | undefined) => (code ? (map.get(code) ?? null) : null);
  }, [data]);
}

/** Mutation with the standard UX: success toast, error toast (role / sign-in codes translated), and invalidation of related queries. */
export function useApiMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: {
    success?: string | ((r: TResult, v: TVars) => string);
    invalidate?: QueryKey[];
    onSuccess?: (r: TResult, v: TVars) => void;
    /** Return true to suppress the default error toast. */
    onError?: (err: unknown) => boolean | void;
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
    onError: (err) => {
      if (opts.onError?.(err) === true) return;
      message.error(describeError(err));
    },
  });
}

/** Current time, re-rendering every `intervalMs` (for countdowns). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
