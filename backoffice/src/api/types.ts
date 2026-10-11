// Types mirroring docs/admin-api.md (the back-office API contract).

export type Role = 'ADMIN' | 'REVIEWER' | 'VIEWER';
export type Channel = 'MOBILE' | 'WEB' | 'ADMIN';

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

// ---- Auth / users ----
export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AdminUser;
}

// ---- Dashboard ----
export interface Dashboard {
  days: number;
  totals: {
    sessions: number;
    approved: number;
    review: number;
    rejected: number;
    inProgress: number;
    expired: number;
    failed: number;
  };
  approvalRate: number | null;
  avgDocMatchSimilarity: number | null;
  pendingReviews: number;
  daily: { date: string; approved: number; review: number; rejected: number; other: number }[];
  topFailureReasons: { code: string; message: string; count: number }[];
  byFlow: { flowCode: string; count: number }[];
  byChannel: { channel: string; count: number }[];
}

// ---- Sessions ----
export type SessionStatus = 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED' | 'FAILED' | 'CANCELLED';
export type DecisionValue = 'APPROVED' | 'REVIEW' | 'REJECTED';

export interface SessionSummary {
  publicId: string;
  flowCode: string;
  status: SessionStatus;
  decision: DecisionValue | null;
  channel: Channel;
  clientAppCode: string;
  partyId: number | null;
  partyName: string | null;
  subjectRef: string | null;
  documentType: string | null;
  documentNumber: string | null;
  finalSimilarity: number | null;
  livenessAttempts: number;
  documentAttempts: number;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export type StepStatus = 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'REVIEW' | 'SKIPPED';
export type CheckOutcome = 'PASS' | 'REVIEW' | 'FAIL' | 'SKIPPED';

export interface Check {
  id: number;
  checkCode: string;
  score: number | null;
  thresholdUsed: string | null;
  outcome: CheckOutcome;
  details: Record<string, unknown> | null;
}

export interface MediaRef {
  id: number;
  role: string;
  mimeType: string;
  byteCount: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface Step {
  id: number;
  stepCode: string;
  attemptNo: number;
  status: StepStatus;
  reasonCode: string | null;
  reasonMessage: string | null;
  startedAt: string | null;
  endedAt: string | null;
  checks: Check[];
  media: MediaRef[];
}

export interface Decision {
  decision: DecisionValue;
  decidedBy: 'SYSTEM' | 'USER';
  decidedByUser: string | null;
  reason: string | null;
  finalSimilarity: number | null;
  decidedAt: string;
}

export interface Device {
  id: number;
  deviceRef: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  model: string | null;
  attestationStatus: string;
}

export interface SessionEvent {
  eventType: string;
  status: string;
  createdAt: string;
}

/**
 * SessionDetail = SessionSummary & {...}. In the contract both define `decision`;
 * on the detail it is the full Decision object (or null).
 */
export interface SessionDetail extends Omit<SessionSummary, 'decision'> {
  device: Device | null;
  ipAddress: string | null;
  userAgent: string | null;
  steps: Step[];
  document: DocumentSummary | null;
  decision: Decision | null;
  reviewCase: ReviewCaseSummary | null;
  events: SessionEvent[];
  /** The session was asked to register the face (face registration, or a selfie ID verification with enrollFace). */
  enrollFace?: boolean;
  /** Its face templates are now registered for the person. */
  faceRegistered?: boolean;
}

export interface SessionFilters {
  page?: number;
  size?: number;
  status?: string;
  decision?: string;
  flowCode?: string;
  channel?: string;
  clientAppCode?: string;
  from?: string;
  to?: string;
  q?: string;
}

// ---- Review cases ----
export type ReviewStatus = 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface ReviewCaseSummary {
  id: number;
  sessionPublicId: string;
  status: ReviewStatus;
  reason: string;
  finalSimilarity: number | null;
  assignedTo: string | null;
  partyName: string | null;
  documentType: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Tenant the case belongs to. The admin queue is cross-tenant: the default tenant's cases plus those of
   * tenants whose `review.owner` is CAMTECH (tenants that review their own decide in the tenant portal).
   */
  tenantId: number;
}

export interface ReviewAction {
  id: number;
  action: 'OPENED' | 'ASSIGNED' | 'COMMENTED' | 'APPROVED' | 'REJECTED';
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface ReviewCaseDetail extends ReviewCaseSummary {
  session: SessionDetail;
  actions: ReviewAction[];
}

// ---- Parties ----
export interface PartySummary {
  id: number;
  publicId: string;
  partyType: 'PERSON' | 'ORG';
  externalRef: string | null;
  status: string;
  displayName: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  documentsCount: number;
  sessionsCount: number;
  lastVerifiedAt: string | null;
  createdAt: string;
}

export interface FaceTemplate {
  id: number;
  role: 'SELFIE' | 'DOCUMENT';
  modelVersion: string;
  dimension: number;
  qualityScore: number | null;
  status: 'SESSION' | 'ENROLLED' | 'REVOKED';
  sourceMediaId: number | null;
  createdAt: string;
}

export interface PartyRelation {
  relationType: string;
  otherPartyId: number;
  otherPartyName: string | null;
  sharePct: number | null;
}

export interface PartyDetail extends PartySummary {
  person: {
    fullNameEn: string | null;
    fullNameAr: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    nationality: string | null;
  } | null;
  organization: {
    legalNameEn: string | null;
    legalNameAr: string | null;
    legalForm: string | null;
    issuerCode: string | null;
  } | null;
  documents: DocumentSummary[];
  faceTemplates: FaceTemplate[];
  sessions: SessionSummary[];
  relations: PartyRelation[];
}

// ---- Documents / scans ----
export type DocumentStatus = 'CAPTURED' | 'VERIFIED' | 'EXPIRED' | 'REJECTED';
export type FieldSource = 'CLIENT_OCR' | 'SERVER_OCR' | 'MRZ' | 'MANUAL';

export interface DocumentSummary {
  id: number;
  partyId: number | null;
  partyName: string | null;
  docTypeCode: 'EMIRATES_ID' | 'PASSPORT' | 'TRADE_LICENCE' | (string & {});
  issuerCode: string | null;
  documentNumber: string | null;
  issuingCountry: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: DocumentStatus;
  createdAt: string;
}

export interface DocumentField {
  fieldCode: string;
  lang: string | null;
  value: string | null;
  source: FieldSource;
  confidence: number | null;
  groupCode: string | null;
  groupIdx: number | null;
}

/** COMPLETED = values accepted (automatically or by a reviewer); NEEDS_REVIEW = held until a person decides. */
export type ScanStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'NEEDS_REVIEW' | 'REJECTED' | 'FAILED';

export interface ScanSummary {
  id: number;
  publicId: string;
  documentId: number | null;
  docTypeCode: string;
  status: ScanStatus;
  confidence: number | null;
  processingMs: number | null;
  errorMessage: string | null;
  ocrProvider: string | null;
  createdAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  fields: DocumentField[];
  media: MediaRef[];
  scans: ScanSummary[];
}

export interface ScanField {
  fieldCode: string;
  lang: string | null;
  /** What OCR read. */
  rawValue: string | null;
  confidence: number | null;
  validationStatus: string | null;
  validationMessage?: string | null;
  /** Where the value was read (MRZ_VERIFIED, LAYOUT, LABEL...). */
  source?: string | null;
  /** What a reviewer confirmed or corrected (null when not reviewed). */
  reviewedValue?: string | null;
}

/** Why a scan is waiting for a person (FIELD_MISSING, FIELD_INVALID, FIELD_LOW_CONFIDENCE, EXPIRED...). */
export interface ScanReviewReason {
  code: string;
  field: string | null;
  message: string | null;
}

export interface ScanDetail extends ScanSummary {
  fields: ScanField[];
  media: MediaRef[];
  rawText: string | null;
  issues?: string[];
  reviewReasons?: ScanReviewReason[];
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

/**
 * POST /v2/admin/document-scans/{id}/review. Only scans in NEEDS_REVIEW (else 409 SCAN_NOT_IN_REVIEW).
 * `corrections` = fieldCode -> corrected value (only the changed ones); 400 VALIDATION_ERROR when a value is malformed.
 */
export interface ScanReviewRequest {
  decision: 'APPROVE' | 'REJECT';
  corrections?: Record<string, string>;
  note?: string | null;
}

// ---- Configuration ----
export interface Tenant {
  id: number;
  code: string;
  name: string;
  status: string;
  createdAt: string;
}

/** A tenant this CamTech serves (platform view, GET /v2/admin/tenants). */
export interface TenantSummary {
  id: number;
  code: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  isDefault: boolean;
  createdAt: string;
}

/** Role of a tenant portal user. */
export type TenantUserRole = 'OWNER' | 'DEVELOPER' | 'REVIEWER' | 'VIEWER';

/** A tenant portal user (GET /v2/admin/tenants/{tenantId}/users). */
export interface TenantUserView {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: TenantUserRole;
  status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** First OWNER created with a new tenant. Blank password = the server generates one. */
export interface TenantOwnerInput {
  username: string;
  displayName?: string | null;
  email?: string | null;
  password?: string | null;
}

export interface TenantCreate {
  code: string;
  name: string;
  templateCode?: string | null;
  owner?: TenantOwnerInput | null;
}

/** POST /v2/admin/tenants response: the owner's password is returned only here. */
export interface TenantCreated extends TenantSummary {
  owner: { user: TenantUserView; password: string } | null;
}

export interface TenantUserCreate extends TenantOwnerInput {
  role: TenantUserRole;
}

export interface TenantUserUpdate {
  displayName?: string | null;
  email?: string | null;
  role?: TenantUserRole;
  status?: TenantUserView['status'];
}

export type FeatureType = 'FLOW' | 'DOCUMENT' | 'FEATURE';

export interface Entitlement {
  id: number;
  featureType: FeatureType;
  featureCode: string;
  enabled: boolean;
  quotaPerDay: number | null;
  usedToday: number;
  validUntil: string | null;
}

export interface EntitlementUpdate {
  enabled: boolean;
  quotaPerDay: number | null;
  validUntil: string | null;
}

// ---------- liveness policy per tenant and flow ----------

export type LivenessMode = 'PASSIVE' | 'ACTIVE';

/** What the user must do, from their own point of view. */
export type ChallengeAction = 'TURN_LEFT' | 'TURN_RIGHT' | 'BLINK' | 'LOOK_UP' | 'LOOK_DOWN' | 'SMILE' | 'MOVE_CLOSER';

/** Limits CamTech sets for one tenant and flow; the tenant picks its settings inside them. */
export interface LivenessPolicy {
  allowedModes: LivenessMode[];
  allowedActions: ChallengeAction[];
  minActions: number;
  maxActions: number;
  /** The tenant must select at least one more challenge than challengeCount. */
  requireSpareAction: boolean;
}

/** The tenant's own liveness settings for one flow (set in the tenant portal). */
export interface LivenessSettings {
  mode: LivenessMode;
  actions: ChallengeAction[];
  challengeCount: number;
}

/** GET /v2/admin/tenants/{tenantId}/liveness-policies item. */
export interface AdminFlowLiveness {
  tenantId: number;
  flowCode: string;
  flowName: string;
  policy: LivenessPolicy;
  /** What the tenant's users get now (its saved settings, or the policy defaults). */
  settings: LivenessSettings;
  /** false = the tenant has not saved settings for this flow (the policy defaults apply). */
  customized: boolean;
  updatedAt: string | null;
}

/** PUT body. resetTenant = drop the tenant's saved settings when they no longer fit (else 409 TENANT_SETTINGS_CONFLICT). */
export interface LivenessPolicyUpdate extends LivenessPolicy {
  resetTenant?: boolean;
}

export interface ClientApp {
  id: number;
  code: string;
  name: string;
  channel: Channel;
  platform: string | null;
  appIdentifier: string | null;
  allowedOrigins: string[];
  status: 'ACTIVE' | 'DISABLED';
  permissions: { featureCode: string; allowed: boolean }[];
  credentialsCount: number;
  createdAt: string;
}

export interface ClientAppCreate {
  code: string;
  name: string;
  channel: Channel;
  platform: string | null;
  appIdentifier: string | null;
  allowedOrigins: string[];
}

export interface ClientAppUpdate {
  name: string;
  platform: string | null;
  appIdentifier: string | null;
  allowedOrigins: string[];
  status: 'ACTIVE' | 'DISABLED';
}

export interface Credential {
  id: number;
  keyId: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export interface CapabilityFlow {
  code: string;
  documents: string[];
  steps: string[];
  settings: {
    livenessMaxAttempts: number;
    documentMaxAttempts: number;
    sessionTtlMinutes: number;
    deviceAntispoofRequired: boolean;
    fileUploadAllowed: boolean;
    /** SELFIE_ID_VERIFICATION only: whether this app may register faces (FACE_ENROLLMENT allowed). */
    faceEnrollmentAvailable?: boolean;
  };
  quota: { perDay: number | null; remainingToday: number | null };
}

export interface Capabilities {
  tenant: string;
  clientApp: string;
  channel: Channel;
  flows: CapabilityFlow[];
  features: string[];
  locales: string[];
}

export interface ConfigParam {
  id: number;
  flowCode: string | null;
  channel: string | null;
  clientAppCode: string | null;
  paramKey: string;
  paramValue: string;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export type ConfigKeyType = 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'STRING' | 'LIST';

export interface ConfigKey {
  key: string;
  description: string;
  type: ConfigKeyType;
  defaultValue: string;
  min: number | null;
  max: number | null;
}

export interface ConfigParamCreate {
  flowCode: string | null;
  channel: string | null;
  clientAppCode: string | null;
  paramKey: string;
  paramValue: string;
}

export interface FlowStep {
  id: number;
  seq: number;
  stepCode: string;
  /** Kept for older clients; not enforced. */
  mandatory: boolean;
  maxAttempts: number;
  /** false = the step runs once per session and maxAttempts has no effect. */
  maxAttemptsUsed: boolean;
  /** The setting a tenant turns this step on or off with (plus the feature in its plan); null = always runs. */
  tenantSwitch: string | null;
}

/** A flow definition, shared by every tenant. */
export interface Flow {
  code: string;
  name: string;
  description: string | null;
  /** In the default tenant's plan. */
  enabled: boolean;
  /** How many tenants have this flow in their plan. */
  enabledTenants: number;
  steps: FlowStep[];
}

export interface DocumentType {
  id: number;
  code: string;
  name: string;
  sides: number;
  hasMrz: boolean;
  hasFacePhoto: boolean;
  enabled: boolean;
}

export interface Issuer {
  id: number;
  code: string;
  docTypeCode: string;
  countryCode: string;
  emirate: string | null;
  nameEn: string;
  nameAr: string | null;
}

export type ReasonCategory = 'LIVENESS' | 'DOCUMENT' | 'MATCH' | 'SESSION' | 'ACCESS' | 'SYSTEM';

export interface ReasonCode {
  code: string;
  category: ReasonCategory;
  httpStatus: number;
  messageEn: string;
  messageAr: string | null;
}

// ---- Webhooks ----
export type WebhookEvent =
  | 'SESSION_COMPLETED'
  | 'SESSION_EXPIRED'
  | 'REVIEW_OPENED'
  | 'REVIEW_DECIDED'
  | 'SCAN_REVIEW_REQUIRED'
  | 'SCAN_REVIEW_DECIDED'
  | 'DOCUMENT_EXPIRING'
  | 'PARTY_ERASED';

/** `data` of a REVIEW_DECIDED webhook message. `reviewer` is set when the tenant's own reviewer decided. */
export interface ReviewDecidedPayload {
  sessionId: string;
  decision: 'APPROVED' | 'REJECTED';
  decidedBy: 'TENANT' | 'CAMTECH';
  reviewer?: string | null;
}

export interface Webhook {
  id: number;
  url: string;
  events: string[];
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  /** Failed deliveries in a row, newest first (up to 5). */
  consecutiveFailures: number;
  /** The last 5 deliveries all failed. */
  failing: boolean;
}

export interface WebhookDelivery {
  id: number;
  webhookId: number;
  eventType: string;
  eventId: number;
  attempt: number;
  httpStatus: number | null;
  status: 'PENDING' | 'DELIVERED' | 'RETRYING' | 'FAILED';
  error: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

// ---- Retention ----
export type RetentionCategory = 'FAILED_ATTEMPT_MEDIA' | 'VERIFIED_MEDIA' | 'SCAN_ONLY_MEDIA' | 'AUDIT_EVENTS';

export interface RetentionPolicy {
  id: number;
  dataCategory: RetentionCategory;
  retentionDays: number;
  description: string;
  updatedAt: string;
}

// ---- Audit ----
export interface AuditEvent {
  id: number;
  actorType: 'CLIENT' | 'ADMIN' | 'SYSTEM';
  actor: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
  at: string;
}

export interface AuditFilters {
  actor?: string;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}
