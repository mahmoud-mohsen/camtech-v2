// Shapes of the camtech /v2 API (camtech/docs/integration-guide.md) and the tenant portal API
// (camtech/docs/tenant-api.md). Dates are ISO-8601 UTC strings.

// ============================================================ shared

export type Lang = 'en' | 'ar';
export type Channel = 'MOBILE' | 'WEB';
export type FlowCode =
  | 'SELFIE_ID_VERIFICATION' | 'FACE_AUTHENTICATION' | 'LIVENESS_CHECK' | 'FACE_ENROLLMENT' | 'DOCUMENT_SCAN' | (string & {});
export type IdDocumentType = 'EMIRATES_ID' | 'PASSPORT';
export type ScanDocumentType = 'EMIRATES_ID' | 'EMIRATES_ID_FRONT' | 'EMIRATES_ID_BACK' | 'PASSPORT' | 'TRADE_LICENCE';
export type SessionStatus = 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
export type Decision = 'APPROVED' | 'REVIEW' | 'REJECTED';
export type NextStep = 'LIVENESS' | 'DOCUMENT' | 'DONE';
export type MatchResult = 'MATCH' | 'REVIEW' | 'NO_MATCH';

/** Error body of every /v2 endpoint. */
export interface ApiErrorBody {
  code: string;
  message: string;
  step?: string | null;
  attemptsRemaining?: number | null;
  nextStep?: NextStep | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

// ============================================================ public API (end-user SDK)

export interface FlowCapability {
  code: FlowCode;
  documents: string[];
  steps: string[];
  settings: {
    livenessMaxAttempts: number;
    documentMaxAttempts: number;
    sessionTtlMinutes: number;
    deviceAntispoofRequired: boolean;
    fileUploadAllowed: boolean;
    /** The liveness upload must include an active challenge (POST /v2/liveness-challenges). Same as livenessMode === 'ACTIVE'. */
    livenessChallengeRequired?: boolean;
    /** PASSIVE = no challenge (anti-spoof model only); ACTIVE = a random challenge is required. Flows with a liveness step only. */
    livenessMode?: LivenessMode;
    /** The tenant's selected challenges for this flow (each session draws challengeCount of them, in random order). */
    challengeActions?: ChallengeAction[];
    /** How many challenges each user does. */
    challengeCount?: number;
    /** SELFIE_ID_VERIFICATION only: this app may register faces (FACE_ENROLLMENT entitlement), see StartSelfieRequest.enrollFace. */
    faceEnrollmentAvailable?: boolean;
  };
  quota: { perDay: number | null; remainingToday: number | null };
}

export interface Capabilities {
  tenant: string;
  clientApp: string;
  channel: Channel | 'ADMIN';
  flows: FlowCapability[];
  features: string[];
  locales: Lang[];
}

export interface BrandingTexts {
  welcomeTitle?: string | null;
  welcomeBody?: string | null;
  doneTitle?: string | null;
  doneBody?: string | null;
}

/** How the end-user screens look for a tenant. Every field has a default on the server. */
export interface Branding {
  tenant: string;
  displayName: string;
  logoDataUrl: string | null;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  borderRadius: number;
  fontFamily: string;
  themeMode: 'LIGHT' | 'DARK' | 'AUTO';
  supportEmail: string | null;
  supportUrl: string | null;
  privacyUrl: string | null;
  showPoweredBy: boolean;
  texts: Partial<Record<Lang, BrandingTexts>>;
  updatedAt: string | null;
}

export interface StartSelfieRequest {
  subjectRef?: string;
  documentType?: IdDocumentType;
  /**
   * true = register the face when approved (403 FEATURE_NOT_* without the FACE_ENROLLMENT entitlement);
   * false = verify only. Omitted = register when the app may (faceEnrollmentAvailable).
   */
  enrollFace?: boolean;
}

export interface StartSelfieResponse {
  sessionId: string;
  sessionToken: string;
  flow: string;
  status: SessionStatus;
  expiresAt: string;
  nextStep: NextStep;
  /** The face is registered when the verification is approved. */
  enrollFace: boolean;
}

export interface LivenessResponse {
  sessionId: string;
  step: 'LIVENESS';
  result: 'PASSED';
  status: SessionStatus;
  attemptsRemaining: number;
  nextStep: NextStep;
}

export interface DocumentSubmission {
  documentType: IdDocumentType;
  document: Blob;
  /** Emirates ID back (MRZ side), sent as the optional `documentBack` part. */
  documentBack?: Blob;
  documentNumber?: string;
  expiryDate?: string;
  mrzLine2?: string;
  fullName?: string;
  dateOfBirth?: string;
  issuingCountry?: string;
}

export interface DocumentResponse {
  sessionId: string;
  step: 'DOCUMENT';
  result: MatchResult;
  status: SessionStatus;
  decision: Decision | null;
  attemptsRemaining: number;
  nextStep: NextStep;
  reasonCode: string | null;
  message: string | null;
}

export interface SessionStepState {
  step: string;
  status: string;
  attemptsUsed: number;
  attemptsMax: number;
}

export interface SessionState {
  sessionId: string;
  flow: string;
  status: SessionStatus;
  decision: Decision | null;
  documentType: IdDocumentType | null;
  expiresAt: string;
  nextStep: NextStep;
  steps: SessionStepState[];
}

export interface SessionResult {
  sessionId: string;
  status: SessionStatus;
  decision: Decision | null;
  decidedAt: string | null;
  resultToken: string | null;
  resultTokenExpiresAt: string | null;
}

/** Answer of the one-call selfie flows (face authentication, liveness check, face enrollment): no session to drive. */
export interface SelfieFlowResponse {
  sessionId: string;
  /** REVIEW: face enrollment only (DUPLICATE_IDENTITY, a reviewer decides). */
  decision: Decision;
  /** Why it was not approved: a liveness code (TOO_DARK, CHALLENGE_FAILED…), FACE_MISMATCH, DUPLICATE_IDENTITY… */
  reasonCode: string | null;
  message: string | null;
  resultToken: string | null;
  resultTokenExpiresAt: string | null;
}

export interface FaceAuthResponse extends SelfieFlowResponse {
  decision: 'APPROVED' | 'REJECTED';
}

/** POST /v2/liveness-checks: a failed liveness is a 200 REJECTED with the liveness reasonCode. */
export type LivenessCheckResponse = FaceAuthResponse;

/** POST /v2/face-enrollments: APPROVED = face registered. */
export type FaceEnrollmentResponse = SelfieFlowResponse;

export interface DocumentScanResponse {
  success: boolean;
  scanId?: string | null;
  documentType?: string | null;
  confidence?: number | null;
  fields?: Record<string, unknown> | null;
  rawText?: string | null;
  processingTimeMs?: number | null;
  message?: string | null;
  [key: string]: unknown;
}

export interface ReasonMessage {
  code: string;
  category: string;
  message: string;
}

export interface SdkTokenResponse {
  sdkToken: string;
  expiresAt: string;
  tenantCode: string;
  clientAppCode: string;
  subjectRef: string | null;
}

// ============================================================ tenant portal API (/v2/tenant)

export interface TenantInfo {
  code: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  flows: { code: string; name: string; enabled: boolean }[];
  documentTypes: { code: string; name: string; enabled: boolean }[];
  features: { code: string; enabled: boolean }[];
}

export interface TenantDashboard {
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
  pendingReviews: number;
  scans: number;
  daily: { date: string; approved: number; review: number; rejected: number; other: number }[];
  topFailureReasons: { code: string; message: string; count: number }[];
  byFlow: { flowCode: string; count: number }[];
  byChannel: { channel: string; count: number }[];
  byClientApp: { clientAppCode: string; count: number }[];
  /** What needs a look on the Overview. */
  attention: TenantAttention;
}

/** GET /dashboard attention: work waiting, endpoints failing, keys and documents expiring. */
export interface TenantAttention {
  scansToReview: number;
  /** Open review cases the tenant decides (0 when camtech reviews them). */
  verificationsToReview: number;
  failingWebhooks: { id: number; url: string; consecutiveFailures: number; lastDeliveryAt: string | null }[];
  /** Active API keys expiring within 14 days. */
  credentialsExpiring: { clientAppCode: string; keyId: string; expiresAt: string }[];
  /** Documents expiring within the tenant's warning period. */
  documentsExpiring: number;
  expiryWarningDays: number;
}

export interface Entitlement {
  id: number;
  featureType: 'FLOW' | 'DOCUMENT' | 'FEATURE';
  featureCode: string;
  enabled: boolean;
  quotaPerDay: number | null;
  usedToday: number;
  validUntil: string | null;
}

export interface TenantSessionSummary {
  publicId: string;
  flowCode: string;
  status: SessionStatus;
  decision: Decision | null;
  channel: string;
  clientAppCode: string | null;
  subjectRef: string | null;
  partyName: string | null;
  documentType: string | null;
  documentNumber: string | null;
  livenessAttempts: number;
  documentAttempts: number;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface TenantCheck {
  checkCode: string;
  outcome: string;
}

export interface TenantStep {
  stepCode: string;
  attemptNo: number;
  status: string;
  reasonCode: string | null;
  reasonMessage: string | null;
  startedAt: string | null;
  endedAt: string | null;
  checks: TenantCheck[];
  imagesCount: number;
}

export interface TenantSessionDetail extends TenantSessionSummary {
  device: {
    platform: string | null;
    osVersion: string | null;
    appVersion: string | null;
    model: string | null;
  } | null;
  steps: TenantStep[];
  document: {
    docTypeCode: string;
    documentNumber: string | null;
    issuingCountry: string | null;
    expiryDate: string | null;
    status: string;
  } | null;
  decisionDetail: {
    decision: Decision;
    decidedBy: 'SYSTEM' | 'REVIEWER';
    reason: string | null;
    decidedAt: string;
  } | null;
  review: { status: string; openedAt: string; decidedAt: string | null } | null;
  events: { eventType: string; status: string; createdAt: string }[];
  /** The session was asked to register the face (FACE_ENROLLMENT, or a selfie ID verification with enrollFace). */
  enrollFace?: boolean;
  /** Its face templates are now registered for the person (face authentication can match them). */
  faceRegistered?: boolean;
}

export interface TenantScanSummary {
  id: number;
  publicId: string;
  docTypeCode: string;
  status: string;
  confidence: number | null;
  processingMs: number | null;
  errorMessage: string | null;
  createdAt: string;
  /** Why the scan waits for review (empty when it does not). */
  reviewReasons?: ScanReviewReason[];
}

/** How a scanned value was checked: VALID, UNVERIFIED, MISMATCH, INVALID or MISSING. */
export type FieldValidationStatus = 'VALID' | 'UNVERIFIED' | 'MISMATCH' | 'INVALID' | 'MISSING';

export interface TenantScanField {
  fieldCode: string;
  lang: string | null;
  /** The value in use: the reviewer's when there is one, else what OCR read. */
  value: string | null;
  confidence: number | null;
  validationStatus: string | null;
  /** Why the status is not VALID, or what was cross-checked. */
  validationMessage?: string | null;
  /** Where the value was read: MRZ_VERIFIED, LAYOUT, LABEL, MRZ, PATTERN, INFERRED. */
  source?: string | null;
  /** What OCR read (differs from value after a correction). */
  ocrValue?: string | null;
  /** What a reviewer confirmed or corrected. */
  reviewedValue?: string | null;
}

/** Why a scan waits for review. field is null for reasons about the whole document. */
export interface ScanReviewReason {
  code: string;
  field: string | null;
  message: string | null;
}

export interface TenantScanDetail extends TenantScanSummary {
  fields: TenantScanField[];
  /** Document-level issues, e.g. EXPIRED, SIDES_MISMATCH. */
  issues?: string[];
  reviewReasons?: ScanReviewReason[];
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  /** The person's document the scan was saved to, when there is one. */
  documentId?: number | null;
  /** Document images of the scan (GET /media/{id}). */
  media?: MediaRef[];
}

/** A stored image. Fetch it with GET /media/{id} (document images) or the review-case evidence path. */
export interface MediaRef {
  id: number;
  /** FRONT, BACK, DOCUMENT, PAGE… */
  role: string;
  mimeType: string;
  byteCount: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** Deleted by the retention policy: the record is kept, the image is gone. */
  purged: boolean;
}

export interface ScanReviewRequest {
  decision: 'APPROVE' | 'REJECT';
  /** Field code -> corrected value; only the fields that change. */
  corrections?: Record<string, string>;
  note?: string;
}

export type OcrReviewMode = 'AUTO' | 'ALWAYS' | 'NEVER';

export interface DocumentOcrSettings {
  reviewMode: OcrReviewMode;
  /** 0-1: overall confidence at or above which a scan with no failed check is accepted. */
  autoAcceptConfidence: number;
  /** 0-1: every required field must reach this. */
  fieldMinConfidence: number;
  /** Empty = each document's own required fields. */
  requiredFields: string[];
  acceptExpired: boolean;
}

export interface TenantDocumentOcrSettings {
  settings: DocumentOcrSettings;
  defaults: DocumentOcrSettings;
  customized: boolean;
  updatedAt: string | null;
  reviewModes: OcrReviewMode[];
}

export interface Permission {
  featureCode: string;
  allowed: boolean;
}

export interface ClientApp {
  id: number;
  code: string;
  name: string;
  channel: 'MOBILE' | 'WEB' | 'ADMIN';
  platform: string | null;
  appIdentifier: string | null;
  allowedOrigins: string[];
  status: 'ACTIVE' | 'DISABLED';
  permissions: Permission[];
  credentialsCount: number;
  createdAt: string;
}

export interface ClientAppCreate {
  code: string;
  name: string;
  channel: Channel;
  platform?: string | null;
  appIdentifier?: string | null;
  allowedOrigins?: string[];
}

export interface ClientAppUpdate {
  name?: string;
  platform?: string | null;
  appIdentifier?: string | null;
  allowedOrigins?: string[];
  status?: 'ACTIVE' | 'DISABLED';
}

export interface Credential {
  id: number;
  keyId: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export interface CreatedCredential {
  credential: Credential;
  /** Shown once: it cannot be read again. */
  secret: string;
}

export type WebhookEvent =
  | 'SESSION_COMPLETED' | 'SESSION_EXPIRED' | 'REVIEW_OPENED' | 'REVIEW_DECIDED'
  | 'SCAN_REVIEW_REQUIRED' | 'SCAN_REVIEW_DECIDED' | 'DOCUMENT_EXPIRING' | 'PARTY_ERASED';

export interface Webhook {
  id: number;
  url: string;
  events: WebhookEvent[];
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  /** Deliveries in a row that failed. */
  consecutiveFailures: number;
  /** The endpoint keeps failing (5 deliveries in a row). */
  failing: boolean;
}

export interface WebhookRequest {
  url?: string;
  events?: WebhookEvent[];
  status?: 'ACTIVE' | 'DISABLED';
}

export interface WebhookWithSecret {
  webhook: Webhook;
  secret: string;
}

export interface WebhookDelivery {
  id: number;
  webhookId: number;
  eventType: string;
  eventId: number | null;
  attempt: number;
  httpStatus: number | null;
  status: 'PENDING' | 'DELIVERED' | 'RETRYING' | 'FAILED';
  error: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

export type BrandingUpdate = Omit<Branding, 'tenant' | 'updatedAt'>;

export interface AuditEvent {
  id: number;
  actorType: 'CLIENT' | 'ADMIN' | 'SYSTEM' | 'TENANT' | 'TENANT_USER';
  actor: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
  at: string;
}

export interface ReasonCode {
  code: string;
  category: string;
  messageEn: string;
  messageAr: string | null;
}

export interface PlaygroundTokenRequest {
  clientAppCode: string;
  subjectRef?: string;
  ttlMinutes?: number;
}

// ============================================================ active liveness

/**
 * What the user must do, from their own point of view. TURN_LEFT = the person turns to their own
 * left, which in an unmirrored camera image moves the nose towards the image's right side.
 */
export type ChallengeAction = 'TURN_LEFT' | 'TURN_RIGHT' | 'BLINK' | 'LOOK_UP' | 'LOOK_DOWN' | 'SMILE' | 'MOVE_CLOSER';

/** Every challenge, in display order. */
export const CHALLENGE_ACTIONS: readonly ChallengeAction[] = ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER'];

export type LivenessMode = 'PASSIVE' | 'ACTIVE';

/** Flows that ask for a challenge without a session. A challenge only works for the flow it was issued for. */
export type ChallengeFlow = 'FACE_AUTHENTICATION' | 'FACE_ENROLLMENT' | 'LIVENESS_CHECK';

/**
 * Who the challenge is for: `{ sessionId }` (selfie ID verification) or a session-less flow (`flow` omitted =
 * FACE_AUTHENTICATION). Only LIVENESS_CHECK works without a subjectRef.
 */
export type LivenessChallengeTarget =
  | { sessionId: string }
  | { subjectRef: string; flow?: ChallengeFlow }
  | { subjectRef?: string; flow: 'LIVENESS_CHECK' };

/** POST /v2/liveness-challenges body. supportedActions = what this client can show (omitted = the original three). */
export type LivenessChallengeRequest = LivenessChallengeTarget & { supportedActions?: ChallengeAction[] };

export interface LivenessChallenge {
  challengeId: string;
  /** In the order they must be done. */
  actions: ChallengeAction[];
  expiresAt: string;
}

/** Frames recorded while the user did the challenge, in capture order (at most 16, under 1 MB each). */
export interface ChallengeSubmission {
  challengeId: string;
  frames: Blob[];
}

// ============================================================ liveness settings per flow

/** Limits set by the back-office for one tenant and flow. */
export interface LivenessPolicy {
  allowedModes: LivenessMode[];
  allowedActions: ChallengeAction[];
  minActions: number;
  maxActions: number;
  /** The tenant must select at least one more challenge than challengeCount. */
  requireSpareAction: boolean;
}

/** The tenant's liveness settings for one flow. */
export interface LivenessSettings {
  mode: LivenessMode;
  actions: ChallengeAction[];
  challengeCount: number;
}

/** GET /v2/tenant/flows item. */
/** GET /duplicate-search: whether new faces are searched against the faces of the tenant's other people. */
export interface DuplicateSearchSettings {
  /** DEDUP_SEARCH is in the tenant's plan. */
  available: boolean;
  enabled: boolean;
  /** The tenant's flows that run the search. */
  flows: FlowCode[];
}

export interface TenantFlowLiveness extends LivenessSettings {
  flowCode: FlowCode;
  flowName: string;
  policy: LivenessPolicy;
  /** false = the tenant has not saved settings yet (the policy defaults apply). */
  customized: boolean;
  updatedAt: string | null;
}

// ------------------------------------------------ tenant portal sign-in and users

export type TenantUserRole = 'OWNER' | 'DEVELOPER' | 'REVIEWER' | 'VIEWER';
export type TenantUserStatus = 'ACTIVE' | 'DISABLED';

/** A person who signs in to the tenant portal. */
export interface TenantUser {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: TenantUserRole;
  status: TenantUserStatus;
  /** true after a generated or reset password: the user must choose their own before doing anything else. */
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** The tenant a portal user belongs to. */
export interface TenantRef {
  code: string;
  name: string;
}

/** POST /v2/tenant/auth/login */
export interface TenantLoginResponse {
  token: string;
  expiresAt: string;
  user: TenantUser;
  tenant: TenantRef;
}

/** GET /v2/tenant/auth/me */
export interface TenantMe {
  user: TenantUser;
  tenant: TenantRef;
}

/** POST /v2/tenant/users. A blank password makes the server generate one. */
export interface TenantUserCreate {
  username: string;
  displayName?: string | null;
  email?: string | null;
  role: TenantUserRole;
  password?: string | null;
}

/** PUT /v2/tenant/users/{id}: only the fields sent are changed. */
export interface TenantUserUpdate {
  displayName?: string | null;
  email?: string | null;
  role?: TenantUserRole;
  status?: TenantUserStatus;
}

/** POST /v2/tenant/users: the password is returned this once only. */
export interface TenantUserCreated {
  user: TenantUser;
  password: string;
}

// ------------------------------------------------ documents and people

export interface DocumentSummary {
  id: number;
  partyId: number | null;
  partyName: string | null;
  docTypeCode: string;
  issuerCode: string | null;
  documentNumber: string | null;
  issuingCountry: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  /** CAPTURED, VERIFIED, EXPIRED, REJECTED */
  status: string;
  createdAt: string;
}

export interface DocumentField {
  fieldCode: string;
  lang: string | null;
  value: string | null;
  /** CLIENT_OCR, SERVER_OCR, MRZ, MANUAL */
  source: string | null;
  confidence: number | null;
  groupCode: string | null;
  groupIdx: number | null;
}

/** GET /documents/{id} */
export interface DocumentDetail extends DocumentSummary {
  fields: DocumentField[];
  media: MediaRef[];
  scans: TenantScanSummary[];
}

export interface PartySummary {
  id: number;
  publicId: string;
  /** PERSON or ORG */
  partyType: string;
  /** Your user reference (subjectRef). */
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

/** A registered face (never the image). */
export interface FaceTemplate {
  id: number;
  role: string;
  /** SESSION, ENROLLED, REVOKED */
  status: string;
  createdAt: string;
}

/** GET /parties/{id} */
export interface PartyDetail {
  id: number;
  publicId: string;
  partyType: string;
  subjectRef: string | null;
  status: string;
  displayName: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  documentsCount: number;
  sessionsCount: number;
  lastVerifiedAt: string | null;
  createdAt: string;
  person: { fullNameEn: string | null; fullNameAr: string | null; dateOfBirth: string | null; gender: string | null; nationality: string | null } | null;
  organization: { legalNameEn: string | null; legalNameAr: string | null; legalForm: string | null; issuerCode: string | null } | null;
  documents: DocumentSummary[];
  faceTemplates: FaceTemplate[];
  sessions: TenantSessionSummary[];
}

// ------------------------------------------------ reviews

/** Who decides the verifications that need a person: the tenant's reviewers or camtech. */
export type ReviewOwner = 'TENANT' | 'CAMTECH';

export interface ReviewSettings {
  owner: ReviewOwner;
  owners: ReviewOwner[];
}

/** GET /reviews/summary */
export interface ReviewSummary {
  owner: ReviewOwner;
  scansToReview: number;
  verificationsToReview: number;
}

/** How close the selfie is to the document photo (no raw score). */
export type MatchLabel = 'STRONG' | 'WEAK' | 'NO_MATCH';
export type ReviewCaseStatus = 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface ReviewCaseSummary {
  id: number;
  sessionPublicId: string;
  status: ReviewCaseStatus;
  reason: string | null;
  /** null when no face comparison ran. */
  matchLabel: MatchLabel | null;
  /** A tenant username, or "camtech". */
  assignedTo: string | null;
  partyName: string | null;
  documentType: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An image a reviewer compares: GET /review-cases/{id}/media/{mediaId}. */
export interface ReviewEvidence {
  mediaId: number;
  stepCode: string;
  /** SELFIE_NORMAL, FRONT, BACK, DOCUMENT */
  role: string;
}

export interface ReviewAction {
  id: number;
  /** OPENED, ASSIGNED, COMMENTED, APPROVED, REJECTED */
  action: string;
  /** A tenant username, "camtech" or "system". */
  actor: string;
  note: string | null;
  createdAt: string;
}

/** GET /review-cases/{id} */
export interface ReviewCaseDetail extends ReviewCaseSummary {
  /** The tenant reviews its own verifications and this case is still open. */
  canDecide: boolean;
  /** Open cases the tenant decides only. */
  evidence: ReviewEvidence[];
  session: TenantSessionDetail;
  actions: ReviewAction[];
}

export interface ReviewDecisionRequest {
  decision: 'APPROVED' | 'REJECTED';
  note: string;
}

// ------------------------------------------------ settings

/** GET /document-settings */
export interface DocumentSettings {
  /** Days before expiry when DOCUMENT_EXPIRING is sent and the portal flags a document. */
  expiryWarningDays: number;
  defaultExpiryWarningDays: number;
  min: number;
  max: number;
}

/** GET /retention-policies item (read-only: camtech sets it). */
export interface RetentionPolicy {
  id: number;
  dataCategory: string;
  retentionDays: number;
  description: string | null;
  updatedAt: string | null;
}
