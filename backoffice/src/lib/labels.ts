// Code -> plain-language label maps. Unknown codes fall back to a humanised version of the code.

export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code.replace(/[._]/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lookup(map: Record<string, string>) {
  return (code: string | null | undefined): string => (code ? (map[code] ?? humanize(code)) : '—');
}

export const FLOW_LABELS: Record<string, string> = {
  SELFIE_ID_VERIFICATION: 'Selfie ID verification',
  IDENTITY_VERIFICATION: 'Identity verification',
  FACE_AUTHENTICATION: 'Face authentication',
  BUSINESS_VERIFICATION: 'Business verification',
  LIVENESS_CHECK: 'Liveness check',
  FACE_ENROLLMENT: 'Face registration',
};
export const flowLabel = lookup(FLOW_LABELS);

/** One-line explanation of a flow, shown next to its name. */
export const FLOW_HELP: Record<string, string> = {
  SELFIE_ID_VERIFICATION:
    'Liveness selfies plus an Emirates ID or passport, matched against the document portrait. The face is registered for the person only when face registration is allowed and asked for.',
  IDENTITY_VERIFICATION: 'Full onboarding check with an Emirates ID or passport, liveness, face match and duplicate search.',
  FACE_AUTHENTICATION:
    'A returning user proves it is them: a liveness selfie matched to their registered face (from face registration or a selfie ID verification).',
  BUSINESS_VERIFICATION: 'Trade licence capture and validation for a company.',
  LIVENESS_CHECK: 'Proves a real, live person is in front of the camera (no photo, screen or mask). No document, no face match, nothing registered.',
  FACE_ENROLLMENT:
    'Liveness selfies, then the face is registered for the user without a document, so face authentication can recognise them. The same entitlement lets a selfie ID verification register the face.',
};

/** Flows without a document step: only selfies are captured. */
export const NO_DOCUMENT_FLOWS: readonly string[] = ['FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT'];

export const STEP_LABELS: Record<string, string> = {
  LIVENESS: 'Selfie liveness',
  DOC_CAPTURE: 'Document capture',
  DOC_VALIDATION: 'Document checks',
  FACE_DOC_MATCH: 'Face vs document',
  FACE_TEMPLATE_MATCH: 'Face vs registered face',
  DEDUP_SEARCH: 'Duplicate search',
};
export const stepLabel = lookup(STEP_LABELS);

export const CHECK_LABELS: Record<string, string> = {
  FACE_DETECTED: 'Face detected',
  BRIGHTNESS: 'Brightness',
  SHARPNESS: 'Sharpness',
  HEAD_POSE: 'Head pose',
  SAME_PERSON: 'Same person (normal vs closer)',
  CLOSER_AREA_GAIN: 'Moved closer',
  DEVICE_ANTISPOOF: 'Device anti-spoof',
  PASSIVE_ANTISPOOF: 'Passive liveness (photo / screen / mask)',
  ACTIVE_CHALLENGE: 'Active liveness challenge',
  SAME_PERSON_NORMAL_CLOSER: 'Same person in the normal and closer selfies',
  DOC_DETECTED: 'Document detected',
  MRZ_READ: 'MRZ read',
  OCR_CONFIDENCE: 'OCR confidence',
  DOC_EXPIRY: 'Not expired',
  ID_NUMBER_FORMAT: 'ID number format',
  MRZ_CHECKSUM: 'MRZ checksum',
  FACE_SIMILARITY: 'Face similarity',
  TEMPLATE_SIMILARITY: 'Template similarity',
  DEDUP_MATCH: 'Duplicate identity',
  DEDUP_1N: 'Duplicate identity (searched all registered faces)',
};
export const checkLabel = lookup(CHECK_LABELS);

export const MEDIA_ROLE_LABELS: Record<string, string> = {
  SELFIE_NORMAL: 'Selfie',
  SELFIE_CLOSER: 'Selfie (closer)',
  CHALLENGE_FRAME: 'Liveness challenge frame',
  FRONT: 'Front side',
  BACK: 'Back side',
  PHOTO_PAGE: 'Photo page',
  FACE_PHOTO: 'Document portrait',
  SIGNATURE: 'Signature',
  DOCUMENT: 'Document',
};
export const mediaRoleLabel = lookup(MEDIA_ROLE_LABELS);

export const DOC_TYPE_LABELS: Record<string, string> = {
  EMIRATES_ID: 'Emirates ID',
  PASSPORT: 'Passport',
  TRADE_LICENCE: 'Trade licence',
};
export const docTypeLabel = lookup(DOC_TYPE_LABELS);

export const CHANNEL_LABELS: Record<string, string> = { MOBILE: 'Mobile app', WEB: 'Web', ADMIN: 'Back office' };
export const channelLabel = lookup(CHANNEL_LABELS);

export const SESSION_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Created',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};
export const DECISION_LABELS: Record<string, string> = { APPROVED: 'Approved', REVIEW: 'Needs review', REJECTED: 'Rejected' };
export const REVIEW_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
export const STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  PASSED: 'Passed',
  FAILED: 'Failed',
  REVIEW: 'Needs review',
  SKIPPED: 'Skipped',
};
export const OUTCOME_LABELS: Record<string, string> = { PASS: 'Pass', REVIEW: 'Review', FAIL: 'Fail', SKIPPED: 'Skipped' };
export const DOC_STATUS_LABELS: Record<string, string> = {
  CAPTURED: 'Captured',
  VERIFIED: 'Verified',
  EXPIRED: 'Expired',
  REJECTED: 'Rejected',
};
export const SCAN_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  NEEDS_REVIEW: 'Needs review',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
};

/** Why a document scan is waiting for a person. */
export const SCAN_REVIEW_REASON_LABELS: Record<string, string> = {
  ALWAYS_REVIEW: 'Every scan is reviewed',
  FIELD_MISSING: 'Field not read',
  FIELD_LOW_CONFIDENCE: 'Low confidence',
  FIELD_INVALID: 'Invalid value',
  FIELD_MISMATCH: 'Values disagree',
  EXPIRED: 'Document expired',
  SIDES_MISMATCH: 'Front and back do not match',
  MRZ_NOT_VERIFIED: 'MRZ not verified',
  LOW_CONFIDENCE: 'Low overall confidence',
};
export const scanReviewReasonLabel = lookup(SCAN_REVIEW_REASON_LABELS);
export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  DELIVERED: 'Delivered',
  RETRYING: 'Retrying',
  FAILED: 'Failed',
};

export const FIELD_SOURCE_LABELS: Record<string, string> = {
  CLIENT_OCR: 'App OCR',
  SERVER_OCR: 'Server OCR',
  MRZ: 'MRZ',
  MANUAL: 'Entered manually',
};

export const FIELD_LABELS: Record<string, string> = {
  FULL_NAME: 'Full name',
  FULL_NAME_AR: 'Full name (Arabic)',
  ID_NUMBER: 'ID number',
  DOCUMENT_NUMBER: 'Document number',
  DATE_OF_BIRTH: 'Date of birth',
  NATIONALITY: 'Nationality',
  GENDER: 'Gender',
  ISSUE_DATE: 'Issue date',
  EXPIRY_DATE: 'Expiry date',
  CARD_NUMBER: 'Card number',
  OCCUPATION: 'Occupation',
  EMPLOYER: 'Employer',
  ISSUING_PLACE: 'Issuing place',
  MRZ_LINE_1: 'MRZ line 1',
  MRZ_LINE_2: 'MRZ line 2',
  MRZ_LINE_3: 'MRZ line 3',
  LICENCE_NUMBER: 'Licence number',
  TRADE_NAME: 'Trade name',
  TRADE_NAME_AR: 'Trade name (Arabic)',
  LEGAL_FORM: 'Legal form',
  ACTIVITY: 'Activity',
  PARTNER_NAME: 'Partner name',
  PARTNER_SHARE: 'Partner share',
  PARTNER_NATIONALITY: 'Partner nationality',
};
const fieldLookup = lookup(FIELD_LABELS);
/** Field label; also accepts the camelCase codes of document scans (dateOfBirth -> DATE_OF_BIRTH). */
export const fieldLabel = (code: string | null | undefined): string =>
  code && /[a-z][A-Z]|^[a-z]+$/.test(code) ? fieldLookup(code.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()) : fieldLookup(code);

export const FEATURE_LABELS: Record<string, string> = {
  ...FLOW_LABELS,
  ...DOC_TYPE_LABELS,
  SERVER_OCR: 'Server-side OCR',
  DEDUP_SEARCH: 'Duplicate identity search',
  FILE_UPLOAD: 'Upload from file',
  DEVICE_ANTISPOOF: 'Device anti-spoof',
  WEBHOOKS: 'Webhooks',
  ARABIC_UI: 'Arabic interface',
};
export const featureLabel = lookup(FEATURE_LABELS);

/** Extra explanation for entitlements / app permissions whose effect is not obvious from the name. */
export const FEATURE_HELP: Record<string, string> = {
  FACE_ENROLLMENT:
    'Also decides whether selfie ID verifications register the face. Counted separately for billing: a selfie ID verification that registers the face uses one selfie ID verification and one face registration.',
  LIVENESS_CHECK: 'Selfie liveness only, no document and no face registered.',
  DEDUP_SEARCH: "Searches each new face against the faces of the tenant's other people. The tenant turns it on or off in its portal.",
};

export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  SESSION_COMPLETED: 'Verification completed',
  SESSION_EXPIRED: 'Verification expired',
  REVIEW_OPENED: 'Review opened',
  REVIEW_DECIDED: 'Review decided',
  SCAN_REVIEW_REQUIRED: 'Document scan needs review',
  SCAN_REVIEW_DECIDED: 'Document scan reviewed',
  DOCUMENT_EXPIRING: 'Document expiring',
  PARTY_ERASED: 'Person erased',
  TEST: 'Test event',
  WEBHOOK_TEST: 'Test event',
};
export const webhookEventLabel = lookup(WEBHOOK_EVENT_LABELS);
export const WEBHOOK_EVENTS = [
  'SESSION_COMPLETED',
  'SESSION_EXPIRED',
  'REVIEW_OPENED',
  'REVIEW_DECIDED',
  'SCAN_REVIEW_REQUIRED',
  'SCAN_REVIEW_DECIDED',
  'DOCUMENT_EXPIRING',
  'PARTY_ERASED',
] as const;

/** One-line explanation of each webhook event (shown in the event picker). */
export const WEBHOOK_EVENT_HELP: Record<string, string> = {
  SESSION_COMPLETED: 'A verification got a decision, or ended without one (failed or cancelled).',
  SESSION_EXPIRED: 'A verification timed out.',
  REVIEW_OPENED: 'A verification went to manual review.',
  REVIEW_DECIDED: "A reviewer approved or rejected it. decidedBy is TENANT (the tenant's reviewer, named in reviewer) or CAMTECH.",
  SCAN_REVIEW_REQUIRED: 'A document scan needs a person to check it (with the reasons).',
  SCAN_REVIEW_DECIDED: 'A document scan was approved (with any corrected fields) or rejected.',
  DOCUMENT_EXPIRING: 'A document entered the warning period before it expires. Sent once per document.',
  PARTY_ERASED: "A person's data was erased.",
};

/** Who decided a review, in the REVIEW_DECIDED webhook payload (decidedBy). */
export const REVIEW_DECIDED_BY_LABELS: Record<string, string> = { TENANT: "Tenant's reviewer", CAMTECH: 'CamTech reviewer' };

export const RETENTION_LABELS: Record<string, string> = {
  FAILED_ATTEMPT_MEDIA: 'Images from failed attempts',
  VERIFIED_MEDIA: 'Images from completed verifications',
  SCAN_ONLY_MEDIA: 'Images from standalone document scans',
  AUDIT_EVENTS: 'Audit log entries',
};
export const retentionLabel = lookup(RETENTION_LABELS);

export const REVIEW_ACTION_LABELS: Record<string, string> = {
  OPENED: 'Case opened',
  ASSIGNED: 'Assigned',
  COMMENTED: 'Comment',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const ROLE_LABELS: Record<string, string> = { ADMIN: 'Administrator', REVIEWER: 'Reviewer', VIEWER: 'Viewer' };
export const ROLE_HELP: Record<string, string> = {
  ADMIN: 'Can do everything, including configuration and users.',
  REVIEWER: 'Can view everything, decide review cases and cancel verifications.',
  VIEWER: 'Read-only access (no back-office users).',
};

export const REASON_CATEGORY_LABELS: Record<string, string> = {
  LIVENESS: 'Selfie liveness',
  DOCUMENT: 'Documents',
  MATCH: 'Face matching',
  SESSION: 'Session',
  ACCESS: 'Access',
  SYSTEM: 'System',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Signed in',
  LOGOUT: 'Signed out',
  LOGIN_FAILED: 'Sign-in failed',
  PASSWORD_CHANGED: 'Password changed',
  SESSION_CREATED: 'Verification started',
  SESSION_CANCELLED: 'Verification cancelled',
  REVIEW_ASSIGNED: 'Review assigned',
  REVIEW_DECIDED: 'Review decided',
  REVIEW_COMMENTED: 'Review comment',
  DOCUMENT_SCAN_REVIEWED: 'Document scan reviewed',
  PARTY_ERASED: 'Person erased',
  FACE_TEMPLATE_REVOKED: 'Face template revoked',
  CONFIG_UPDATED: 'Setting changed',
  CONFIG_CREATED: 'Setting override added',
  CONFIG_DELETED: 'Setting override removed',
  ENTITLEMENT_UPDATED: 'Entitlement changed',
  CLIENT_APP_UPDATED: 'Client app changed',
  CLIENT_APP_CREATED: 'Client app created',
  CREDENTIAL_CREATED: 'Credential created',
  CREDENTIAL_REVOKED: 'Credential revoked',
  WEBHOOK_UPDATED: 'Webhook changed',
  WEBHOOK_CREATED: 'Webhook created',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User changed',
  PASSWORD_RESET: 'Password reset',
  MEDIA_PURGED: 'Media purged',
  RETENTION_UPDATED: 'Retention changed',
  LIVENESS_POLICY_UPDATED: 'Liveness limits changed',
  LIVENESS_SETTINGS_UPDATED: 'Liveness settings changed (tenant)',
};
export const auditActionLabel = lookup(AUDIT_ACTION_LABELS);

export const CHALLENGE_ACTION_LABELS: Record<string, string> = {
  TURN_LEFT: 'Turn left',
  TURN_RIGHT: 'Turn right',
  BLINK: 'Blink',
  LOOK_UP: 'Look up',
  LOOK_DOWN: 'Look down',
  SMILE: 'Smile',
  MOVE_CLOSER: 'Move closer',
};
export const challengeActionLabel = lookup(CHALLENGE_ACTION_LABELS);

export const LIVENESS_MODE_LABELS: Record<string, string> = { ACTIVE: 'Active (challenge)', PASSIVE: 'Passive (no challenge)' };
export const livenessModeLabel = lookup(LIVENESS_MODE_LABELS);

/** Config key prefix -> group label for the settings page. */
export const CONFIG_GROUP_LABELS: Record<string, string> = {
  face: 'Face matching',
  liveness: 'Selfie liveness',
  document: 'Documents',
  session: 'Sessions',
  dedup: 'Duplicate search',
  ocr: 'OCR',
  webhook: 'Webhooks',
};
