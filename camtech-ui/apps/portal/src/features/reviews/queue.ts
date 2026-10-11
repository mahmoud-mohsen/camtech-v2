import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { qk } from '../../lib/hooks';

export const QUEUES = ['OPEN', 'IN_REVIEW', 'mine', 'APPROVED', 'REJECTED', 'all'] as const;
export type Queue = (typeof QUEUES)[number];

/** How many queue entries the detail pages look ahead in. */
const LOOKAHEAD = 100;

/** API filters of a queue: a status, "assigned to me", or everything. */
export function queueFilter(queue: Queue): { status?: string; mine?: boolean } {
  if (queue === 'mine') return { mine: true };
  if (queue === 'all') return {};
  return { status: queue };
}

export function asQueue(value: string | null | undefined): Queue {
  return (QUEUES as readonly string[]).includes(value ?? '') ? (value as Queue) : 'OPEN';
}

/** Where a scan opened from the review queue lives (keeps Reviews highlighted and the queue controls on). */
export const scanInQueue = (id: number) => `/scans/${id}?from=reviews`;

/** Where a verification review case lives, remembering which queue it was opened from. */
export const caseInQueue = (id: number, queue: Queue) => (queue === 'OPEN' ? `/reviews/${id}` : `/reviews/${id}?queue=${queue}`);

export interface QueuePosition {
  /** 1-based position of the current entry, null when it is not in the queue (any more). */
  position: number | null;
  total: number;
  prev: string | null;
  next: string | null;
  /** Where to go once the current entry is decided: the next entry, else the first other one; null when the queue is then empty. */
  afterDecision: string | null;
  /** Entries left once the current one is decided. */
  remaining: number;
}

export function queuePosition(ids: number[] | undefined, total: number, current: number, link: (id: number) => string): QueuePosition {
  const list = ids ?? [];
  const i = list.indexOf(current);
  const others = list.filter((id) => id !== current);
  const following = i >= 0 ? list[i + 1] : undefined;
  const after = following ?? others[0];
  return {
    position: i >= 0 ? i + 1 : null,
    total,
    prev: i > 0 ? link(list[i - 1]) : null,
    next: following !== undefined ? link(following) : i < 0 && others.length ? link(others[0]) : null,
    afterDecision: after !== undefined ? link(after) : null,
    remaining: Math.max(0, total - (i >= 0 ? 1 : 0)),
  };
}

/** Scans waiting for review, in the order the Reviews page lists them. */
export function useScanQueue(current: number, enabled: boolean): QueuePosition | null {
  const filters = { status: 'NEEDS_REVIEW', page: 0, size: LOOKAHEAD };
  const q = useQuery({ queryKey: qk.scans(filters), queryFn: () => api.scans(filters), enabled });
  if (!enabled || !q.data) return null;
  return queuePosition(q.data.items.map((s) => s.id), q.data.total, current, scanInQueue);
}

/** Verification review cases of a queue, in the order the Reviews page lists them. */
export function useCaseQueue(current: number, queue: Queue): QueuePosition | null {
  const filters = { ...queueFilter(queue), page: 0, size: LOOKAHEAD };
  const q = useQuery({ queryKey: qk.reviewCases(filters), queryFn: () => api.reviewCases(filters) });
  if (!q.data) return null;
  return queuePosition(q.data.items.map((c) => c.id), q.data.total, current, (id) => caseInQueue(id, queue));
}
