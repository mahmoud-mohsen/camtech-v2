import { Http, type Query, type Transport } from './http';
import type {
  AuditEvent, Branding, DocumentDetail, DocumentSettings, DocumentSummary, PartyDetail, PartySummary, RetentionPolicy, ReviewCaseDetail,
  ReviewCaseSummary, ReviewDecisionRequest, ReviewOwner, ReviewSettings, ReviewSummary, BrandingUpdate, Capabilities, ClientApp, ClientAppCreate, ClientAppUpdate, CreatedCredential,
  Credential, DocumentOcrSettings, DuplicateSearchSettings, Entitlement, LivenessSettings, Page, Permission, PlaygroundTokenRequest, ReasonCode, ScanReviewRequest, SdkTokenResponse, TenantDashboard, TenantDocumentOcrSettings,
  TenantFlowLiveness, TenantInfo, TenantLoginResponse, TenantMe, TenantScanDetail, TenantScanSummary, TenantSessionDetail, TenantSessionSummary,
  TenantUser, TenantUserCreate, TenantUserCreated, TenantUserUpdate, Webhook, WebhookDelivery, WebhookRequest, WebhookWithSecret,
} from './types';

export interface TenantClientOptions {
  baseUrl: string;
  /**
   * The signed-in user's bearer token (read per call), or null when signed out.
   * The server takes the tenant from the user behind the token. Can also be set later with setTokenSource().
   */
  token?: () => string | null;
  transport?: Transport;
}

/** Client for the tenant self-service API (/v2/tenant/**). */
export class CamtechTenantClient {
  readonly http: Http;
  private tokenSource: () => string | null;

  constructor(opts: TenantClientOptions) {
    this.tokenSource = opts.token ?? (() => null);
    this.http = new Http({
      baseUrl: opts.baseUrl,
      transport: opts.transport,
      headers: (): Record<string, string> => {
        const token = this.tokenSource();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    });
  }

  /** Where the bearer token comes from (e.g. the app's token store). */
  setTokenSource(source: () => string | null): void {
    this.tokenSource = source;
  }

  private get<T>(path: string, query?: Query) {
    return this.http.json<T>('GET', `/v2/tenant${path}`, { query });
  }

  private post<T>(path: string, json?: unknown) {
    return this.http.json<T>('POST', `/v2/tenant${path}`, { json });
  }

  private put<T>(path: string, json?: unknown) {
    return this.http.json<T>('PUT', `/v2/tenant${path}`, { json });
  }

  private del(path: string) {
    return this.http.json<void>('DELETE', `/v2/tenant${path}`);
  }

  /** A binary answer (image, ZIP), fetched with the bearer header like every other call. */
  private async blob(path: string, accept: string, signal?: AbortSignal): Promise<Blob> {
    const res = await this.http.send('GET', `/v2/tenant${path}`, { headers: { Accept: accept }, signal });
    return res.blob();
  }

  // ------------------------------------------------ sign-in
  login = (username: string, password: string) => this.post<TenantLoginResponse>('/auth/login', { username, password });
  logout = () => this.post<void>('/auth/logout');
  me = () => this.get<TenantMe>('/auth/me');
  changePassword = (currentPassword: string, newPassword: string) =>
    this.post<void>('/auth/change-password', { currentPassword, newPassword });

  // ------------------------------------------------ portal users (OWNER only)
  users = () => this.get<TenantUser[]>('/users');
  createUser = (body: TenantUserCreate) => this.post<TenantUserCreated>('/users', body);
  updateUser = (id: number, body: TenantUserUpdate) => this.put<TenantUser>(`/users/${id}`, body);
  /** A blank password makes the server generate one; the new password is returned this once only. */
  resetUserPassword = (id: number, password?: string | null) =>
    this.post<{ password: string }>(`/users/${id}/reset-password`, { password: password || null });

  // ------------------------------------------------ tenant and usage
  info = () => this.get<TenantInfo>('/info');
  dashboard = (days = 14) => this.get<TenantDashboard>('/dashboard', { days });
  entitlements = () => this.get<Entitlement[]>('/entitlements');

  // ------------------------------------------------ verifications and scans
  sessions = (q: Query = {}) => this.get<Page<TenantSessionSummary>>('/sessions', q);
  session = (publicId: string) => this.get<TenantSessionDetail>(`/sessions/${encodeURIComponent(publicId)}`);
  cancelSession = (publicId: string) => this.post<TenantSessionDetail>(`/sessions/${encodeURIComponent(publicId)}/cancel`);
  scans = (q: Query = {}) => this.get<Page<TenantScanSummary>>('/document-scans', q);
  scan = (id: number) => this.get<TenantScanDetail>(`/document-scans/${id}`);
  reviewScan = (id: number, body: ScanReviewRequest) => this.post<TenantScanDetail>(`/document-scans/${id}/review`, body);
  documentOcrSettings = () => this.get<TenantDocumentOcrSettings>('/document-ocr-settings');
  updateDocumentOcrSettings = (body: Partial<DocumentOcrSettings>) => this.put<TenantDocumentOcrSettings>('/document-ocr-settings', body);
  resetDocumentOcrSettings = () => this.http.json<TenantDocumentOcrSettings>('DELETE', '/v2/tenant/document-ocr-settings');

  // ------------------------------------------------ documents, images and people
  documents = (q: Query = {}) => this.get<Page<DocumentSummary>>('/documents', q);
  document = (id: number) => this.get<DocumentDetail>(`/documents/${id}`);
  /** A document image (only images linked to a document or scan; anything else is 404). */
  media = (id: number, signal?: AbortSignal) => this.blob(`/media/${id}`, 'image/*', signal);
  parties = (q: Query = {}) => this.get<Page<PartySummary>>('/parties', q);
  party = (id: number) => this.get<PartyDetail>(`/parties/${id}`);
  /** Erases the person: verifications, documents, images, face templates (OWNER). */
  eraseParty = (id: number) => this.del(`/parties/${id}`);
  revokeFaceTemplate = (partyId: number, templateId: number) => this.post<void>(`/parties/${partyId}/face-templates/${templateId}/revoke`);
  /** ZIP with person.json and the person's document images (OWNER). */
  exportParty = (id: number) => this.blob(`/parties/${id}/export`, 'application/zip');

  // ------------------------------------------------ reviews
  reviewSettings = () => this.get<ReviewSettings>('/review-settings');
  updateReviewSettings = (owner: ReviewOwner) => this.put<ReviewSettings>('/review-settings', { owner });
  reviewSummary = () => this.get<ReviewSummary>('/reviews/summary');
  reviewCases = (q: Query = {}) => this.get<Page<ReviewCaseSummary>>('/review-cases', q);
  reviewCase = (id: number) => this.get<ReviewCaseDetail>(`/review-cases/${id}`);
  /** Assigns the case to a tenant username (default: yourself). */
  assignReviewCase = (id: number, assignee?: string | null) => this.post<ReviewCaseDetail>(`/review-cases/${id}/assign`, { assignee: assignee || null });
  commentReviewCase = (id: number, note: string) => this.post<ReviewCaseDetail>(`/review-cases/${id}/comment`, { note });
  decideReviewCase = (id: number, body: ReviewDecisionRequest) => this.post<ReviewCaseDetail>(`/review-cases/${id}/decide`, body);
  /** A selfie or document image of an open case the tenant reviews. */
  reviewCaseMedia = (id: number, mediaId: number, signal?: AbortSignal) => this.blob(`/review-cases/${id}/media/${mediaId}`, 'image/*', signal);

  // ------------------------------------------------ settings
  documentSettings = () => this.get<DocumentSettings>('/document-settings');
  updateDocumentSettings = (expiryWarningDays: number) => this.put<DocumentSettings>('/document-settings', { expiryWarningDays });
  retentionPolicies = () => this.get<RetentionPolicy[]>('/retention-policies');

  // ------------------------------------------------ client apps and credentials
  clientApps = () => this.get<ClientApp[]>('/client-apps');
  createClientApp = (body: ClientAppCreate) => this.post<ClientApp>('/client-apps', body);
  updateClientApp = (id: number, body: ClientAppUpdate) => this.put<ClientApp>(`/client-apps/${id}`, body);
  updatePermissions = (id: number, body: Permission[]) => this.put<ClientApp>(`/client-apps/${id}/permissions`, body);
  appCapabilities = (id: number) => this.get<Capabilities>(`/client-apps/${id}/capabilities`);
  credentials = (appId: number) => this.get<Credential[]>(`/client-apps/${appId}/credentials`);
  createCredential = (appId: number, expiresAt?: string) =>
    this.post<CreatedCredential>(`/client-apps/${appId}/credentials`, { expiresAt: expiresAt ?? null });
  revokeCredential = (id: number) => this.post<Credential>(`/credentials/${id}/revoke`);

  // ------------------------------------------------ webhooks
  webhooks = () => this.get<Webhook[]>('/webhooks');
  createWebhook = (body: WebhookRequest) => this.post<WebhookWithSecret>('/webhooks', body);
  updateWebhook = (id: number, body: WebhookRequest) => this.put<Webhook>(`/webhooks/${id}`, body);
  deleteWebhook = (id: number) => this.del(`/webhooks/${id}`);
  rotateWebhookSecret = (id: number) => this.post<WebhookWithSecret>(`/webhooks/${id}/rotate-secret`);
  testWebhook = (id: number) => this.post<WebhookDelivery>(`/webhooks/${id}/test`);
  deliveries = (id: number, q: Query = {}) => this.get<Page<WebhookDelivery>>(`/webhooks/${id}/deliveries`, q);
  retryDelivery = (id: number) => this.post<WebhookDelivery>(`/webhook-deliveries/${id}/retry`);

  // ------------------------------------------------ liveness settings per flow
  flows = () => this.get<TenantFlowLiveness[]>('/flows');
  updateFlowLiveness = (flowCode: string, body: LivenessSettings) =>
    this.put<TenantFlowLiveness>(`/flows/${encodeURIComponent(flowCode)}/liveness`, body);
  duplicateSearch = () => this.get<DuplicateSearchSettings>('/duplicate-search');
  updateDuplicateSearch = (enabled: boolean) => this.put<DuplicateSearchSettings>('/duplicate-search', { enabled });

  // ------------------------------------------------ branding, audit, reference
  branding = () => this.get<Branding>('/branding');
  updateBranding = (body: BrandingUpdate) => this.put<Branding>('/branding', body);
  resetBranding = () => this.del('/branding');
  auditEvents = (q: Query = {}) => this.get<Page<AuditEvent>>('/audit-events', q);
  reasonCodes = () => this.get<ReasonCode[]>('/reason-codes');

  // ------------------------------------------------ playground
  /** Short-lived SDK token for one of the tenant's apps, to run the end-user flows from the portal. */
  playgroundToken = (body: PlaygroundTokenRequest) => this.post<SdkTokenResponse>('/playground/sdk-token', body);
}
