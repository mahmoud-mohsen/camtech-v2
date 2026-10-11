import type { SimilarityThresholds } from './hooks';

export type Band = 'NO_MATCH' | 'REVIEW' | 'MATCH' | 'EXCELLENT';

export function similarityBand(v: number, t: SimilarityThresholds): Band {
  if (v >= t.excellent) return 'EXCELLENT';
  if (v >= t.match) return 'MATCH';
  if (v >= t.review) return 'REVIEW';
  return 'NO_MATCH';
}

export const BAND_INFO: Record<Band, { label: string; color: string; help: string }> = {
  NO_MATCH: { label: 'No match', color: 'error', help: 'Very likely a different person.' },
  REVIEW: { label: 'Uncertain — review', color: 'warning', help: 'Could be the same person. A human must decide.' },
  MATCH: { label: 'Match', color: 'success', help: 'Same person.' },
  EXCELLENT: { label: 'Excellent match', color: 'success', help: 'Same person, high confidence.' },
};
