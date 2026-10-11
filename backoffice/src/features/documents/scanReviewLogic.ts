// Pure helpers for reviewing a document scan (kept free of React so they can be unit tested).
import type { ScanField, ScanReviewReason } from '../../api/types';

/** One editable row of the approve form. */
export interface CorrectionRow {
  fieldCode: string;
  /** The value currently used (reviewed value, else what OCR read; '' when nothing was read). */
  original: string;
  /** Codes of the review reasons that point at this field. */
  reasons: string[];
}

/**
 * The fields a reviewer can correct: every field read (one row per field code), plus the fields the
 * review reasons name that were not read at all (e.g. FIELD_MISSING), so the reviewer can enter them.
 */
export function correctionRows(fields: ScanField[], reasons: ScanReviewReason[] = []): CorrectionRow[] {
  const rows = new Map<string, CorrectionRow>();
  for (const f of fields) {
    if (rows.has(f.fieldCode)) continue;
    rows.set(f.fieldCode, { fieldCode: f.fieldCode, original: f.reviewedValue ?? f.rawValue ?? '', reasons: [] });
  }
  for (const r of reasons) {
    if (!r.field) continue;
    const row = rows.get(r.field) ?? { fieldCode: r.field, original: '', reasons: [] };
    if (!row.reasons.includes(r.code)) row.reasons.push(r.code);
    rows.set(r.field, row);
  }
  return [...rows.values()];
}

/**
 * Only the values the reviewer changed (trimmed). A field left blank that had no value is not a change.
 * Returns undefined when nothing changed, so the request carries no `corrections`.
 */
export function changedCorrections(rows: CorrectionRow[], values: Record<string, string | undefined>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const v = (values[row.fieldCode] ?? '').trim();
    if (v === row.original.trim()) continue;
    if (v === '' && row.original.trim() === '') continue;
    out[row.fieldCode] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** "ADMIN:sara.review" / "TENANT:ops" -> readable reviewer. */
export function reviewerLabel(reviewedBy: string | null | undefined): string {
  if (!reviewedBy) return '—';
  const [kind, ...rest] = reviewedBy.split(':');
  const name = rest.join(':');
  if (!name) return reviewedBy;
  if (kind === 'ADMIN') return `${name} (CamTech)`;
  if (kind === 'TENANT') return `${name} (tenant)`;
  return reviewedBy;
}
