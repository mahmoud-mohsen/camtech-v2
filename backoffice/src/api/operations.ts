import { http } from './client';
import type {
  AuditEvent, AuditFilters, Dashboard, DocumentDetail, DocumentSummary, Page, PartyDetail, PartySummary,
  ReviewCaseDetail, ReviewCaseSummary, ScanDetail, ScanReviewRequest, ScanSummary, SessionDetail, SessionFilters, SessionSummary,
} from './types';

export const dashboardApi = {
  get: (days: number) => http.get<Dashboard>('/v2/admin/dashboard', { days }),
};

export const sessionsApi = {
  list: (f: SessionFilters) => http.get<Page<SessionSummary>>('/v2/admin/sessions', { ...f }),
  get: (publicId: string) => http.get<SessionDetail>(`/v2/admin/sessions/${encodeURIComponent(publicId)}`),
  cancel: (publicId: string) => http.post<SessionDetail>(`/v2/admin/sessions/${encodeURIComponent(publicId)}/cancel`),
};

export const reviewsApi = {
  list: (f: { status?: string; assignedTo?: string; page?: number; size?: number }) =>
    http.get<Page<ReviewCaseSummary>>('/v2/admin/review-cases', { ...f }),
  get: (id: number) => http.get<ReviewCaseDetail>(`/v2/admin/review-cases/${id}`),
  assign: (id: number, assignee?: string) =>
    http.post<ReviewCaseDetail>(`/v2/admin/review-cases/${id}/assign`, assignee ? { assignee } : {}),
  comment: (id: number, note: string) => http.post<ReviewCaseDetail>(`/v2/admin/review-cases/${id}/comment`, { note }),
  decide: (id: number, decision: 'APPROVED' | 'REJECTED', note: string) =>
    http.post<ReviewCaseDetail>(`/v2/admin/review-cases/${id}/decide`, { decision, note }),
};

export const partiesApi = {
  list: (f: { q?: string; partyType?: string; page?: number; size?: number }) =>
    http.get<Page<PartySummary>>('/v2/admin/parties', { ...f }),
  get: (id: number) => http.get<PartyDetail>(`/v2/admin/parties/${id}`),
  erase: (id: number) => http.del(`/v2/admin/parties/${id}`),
  revokeTemplate: (id: number, templateId: number) =>
    http.post<void>(`/v2/admin/parties/${id}/face-templates/${templateId}/revoke`),
};

export const documentsApi = {
  list: (f: { q?: string; docTypeCode?: string; status?: string; expiringBefore?: string; page?: number; size?: number }) =>
    http.get<Page<DocumentSummary>>('/v2/admin/documents', { ...f }),
  get: (id: number) => http.get<DocumentDetail>(`/v2/admin/documents/${id}`),
  listScans: (f: { status?: string; docTypeCode?: string; page?: number; size?: number }) =>
    http.get<Page<ScanSummary>>('/v2/admin/document-scans', { ...f }),
  getScan: (id: number) => http.get<ScanDetail>(`/v2/admin/document-scans/${id}`),
  /** Approve (with corrections) or reject a scan in NEEDS_REVIEW (409 SCAN_NOT_IN_REVIEW, 400 VALIDATION_ERROR). */
  reviewScan: (id: number, body: ScanReviewRequest) => http.post<ScanDetail>(`/v2/admin/document-scans/${id}/review`, body),
};

export const mediaApi = {
  blob: (id: number) => http.blob(`/v2/admin/media/${id}`),
};

export const auditApi = {
  list: (f: AuditFilters) => http.get<Page<AuditEvent>>('/v2/admin/audit-events', { ...f }),
};
