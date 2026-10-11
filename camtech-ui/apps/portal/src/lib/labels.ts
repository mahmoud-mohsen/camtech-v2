// Code -> plain-language label maps. Unknown codes fall back to a humanised version of the code.
// Kept apart from components so an Arabic set can be added next to it later.

/** FULL_NAME / fullName / full.name -> "Full name". */
export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lookup(map: Record<string, string>) {
  return (code: string | null | undefined): string => (code ? (map[code] ?? humanize(code)) : '—');
}

export const toOptions = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

export const FLOW_LABELS: Record<string, string> = {
  SELFIE_ID_VERIFICATION: 'Selfie ID verification',
  FACE_AUTHENTICATION: 'Face authentication',
  LIVENESS_CHECK: 'Liveness check',
  FACE_ENROLLMENT: 'Face registration',
  DOCUMENT_SCAN: 'Document scan',
};
export const flowLabel = lookup(FLOW_LABELS);

export const FLOW_HELP: Record<string, string> = {
  SELFIE_ID_VERIFICATION:
    'Selfie liveness, then an Emirates ID or passport; the selfie is matched to the document portrait. The face is registered for face authentication only when face registration is allowed (and not turned off with enrollFace: false).',
  FACE_AUTHENTICATION: 'A returning user proves it is them: a liveness selfie matched to their registered face (from face registration or a selfie ID verification).',
  LIVENESS_CHECK: 'Proves a real, live person is in front of the camera (no photo, screen or mask). No document, no face match, nothing registered.',
  FACE_ENROLLMENT:
    'Liveness selfies, then the face is registered for the user without a document, so face authentication can recognise them. The same entitlement lets a selfie ID verification register the face.',
  DOCUMENT_SCAN: 'Server-side OCR of a document: the fields are read and validated.',
};

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
  SAME_PERSON: 'Same person in the normal and closer selfies',
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
  FACE_SIMILARITY: 'Face match',
  TEMPLATE_SIMILARITY: 'Registered face match',
  DEDUP_MATCH: 'Duplicate identity',
  DEDUP_1N: 'Duplicate identity (face search)',
};
export const checkLabel = lookup(CHECK_LABELS);

export const DOC_TYPE_LABELS: Record<string, string> = {
  EMIRATES_ID: 'Emirates ID',
  EMIRATES_ID_FRONT: 'Emirates ID (front)',
  EMIRATES_ID_BACK: 'Emirates ID (back)',
  PASSPORT: 'Passport',
  TRADE_LICENCE: 'Trade licence',
};
export const docTypeLabel = lookup(DOC_TYPE_LABELS);
export const SCAN_TYPES = ['EMIRATES_ID', 'EMIRATES_ID_FRONT', 'EMIRATES_ID_BACK', 'PASSPORT', 'TRADE_LICENCE'] as const;

export const CHANNEL_LABELS: Record<string, string> = { MOBILE: 'Mobile app', WEB: 'Web' };
export const channelLabel = lookup({ ...CHANNEL_LABELS, ADMIN: 'Back office' });

export const SESSION_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Created',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};
export const DECISION_LABELS: Record<string, string> = { APPROVED: 'Approved', REVIEW: 'In review', REJECTED: 'Rejected' };
export const REVIEW_STATUS_LABELS: Record<string, string> = { OPEN: 'Waiting for a reviewer', IN_REVIEW: 'Being reviewed', APPROVED: 'Approved', REJECTED: 'Rejected' };
export const STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  PASSED: 'Passed',
  FAILED: 'Failed',
  REVIEW: 'Needs review',
  SKIPPED: 'Skipped',
};
export const OUTCOME_LABELS: Record<string, string> = { PASS: 'Pass', REVIEW: 'Review', FAIL: 'Fail', SKIPPED: 'Skipped' };
export const DOC_STATUS_LABELS: Record<string, string> = { CAPTURED: 'Captured', VERIFIED: 'Verified', EXPIRED: 'Expired', REJECTED: 'Rejected' };
export const SCAN_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  NEEDS_REVIEW: 'Needs review',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
};
export const DELIVERY_STATUS_LABELS: Record<string, string> = { PENDING: 'Pending', DELIVERED: 'Delivered', RETRYING: 'Retrying', FAILED: 'Failed' };
export const VALIDATION_LABELS: Record<string, string> = {
  VALID: 'Valid',
  OK: 'Valid',
  LOW_CONFIDENCE: 'Low confidence',
  WARNING: 'Check',
  INVALID: 'Invalid',
  MISMATCH: 'Mismatch',
  UNVERIFIED: 'Not verifiable',
  MISSING: 'Missing',
};

/** What each validation status means, for tooltips. */
export const VALIDATION_HELP: Record<string, string> = {
  VALID: 'Passed its checks (check digit, date rules, or agreement with another part of the card).',
  UNVERIFIED: 'Read, but nothing on the card can confirm it (free text such as an employer name).',
  MISMATCH: 'Well formed, but disagrees with another field or the other side of the card.',
  INVALID: 'Fails its own rules (wrong check digit, impossible date): almost certainly misread.',
  MISSING: 'Expected on this document but not found.',
};

/** Where a scanned value was read, most trusted first. */
export const SOURCE_LABELS: Record<string, string> = {
  MRZ_VERIFIED: 'MRZ (check digit OK)',
  LAYOUT: 'Next to its label',
  LABEL: 'After its label',
  MRZ: 'MRZ',
  PATTERN: 'Format match',
  INFERRED: 'Inferred',
  REVIEW: 'Reviewer',
};
export const sourceLabel = lookup(SOURCE_LABELS);

export const REVIEW_REASON_LABELS: Record<string, string> = {
  FIELD_MISSING: 'Missing field',
  FIELD_INVALID: 'Invalid value',
  FIELD_MISMATCH: 'Values disagree',
  FIELD_LOW_CONFIDENCE: 'Low confidence field',
  LOW_CONFIDENCE: 'Low overall confidence',
  EXPIRED: 'Expired document',
  SIDES_MISMATCH: 'Front and back differ',
  MRZ_NOT_VERIFIED: 'MRZ check failed',
  ALWAYS_REVIEW: 'Review required',
};
export const reviewReasonLabel = lookup(REVIEW_REASON_LABELS);

export const OCR_REVIEW_MODE_LABELS: Record<string, string> = {
  AUTO: 'Only scans that fail a check',
  ALWAYS: 'Every scan',
  NEVER: 'Never hold scans',
};

export const FIELD_LABELS: Record<string, string> = {
  FULL_NAME: 'Full name',
  FULL_NAME_AR: 'Full name (Arabic)',
  ID_NUMBER: 'ID number',
  DOCUMENT_NUMBER: 'Document number',
  PASSPORT_NUMBER: 'Passport number',
  DATE_OF_BIRTH: 'Date of birth',
  NATIONALITY: 'Nationality',
  GENDER: 'Sex',
  ISSUE_DATE: 'Issue date',
  EXPIRY_DATE: 'Expiry date',
  CARD_NUMBER: 'Card number',
  OCCUPATION: 'Occupation',
  EMPLOYER: 'Employer',
  ISSUING_PLACE: 'Issuing place',
  ISSUING_COUNTRY: 'Issuing country',
  MRZ_LINE_1: 'MRZ line 1',
  MRZ_LINE_2: 'MRZ line 2',
  MRZ_LINE_3: 'MRZ line 3',
  LICENCE_NUMBER: 'Licence number',
  TRADE_NAME: 'Trade name',
  TRADE_NAME_AR: 'Trade name (Arabic)',
  LEGAL_FORM: 'Legal form',
  ACTIVITY: 'Activity',
  PARTNER_NAME: 'Partner name',
  // Field codes of the server OCR parsers
  emiratesIdNumber: 'ID number',
  fullNameEn: 'Full name',
  fullNameAr: 'Full name (Arabic)',
  dateOfBirth: 'Date of birth',
  issueDate: 'Issue date',
  expiryDate: 'Expiry date',
  gender: 'Sex',
  genderAr: 'Sex (Arabic)',
  nationality: 'Nationality',
  nationalityAr: 'Nationality (Arabic)',
  nationalityCode: 'Nationality code',
  cardNumber: 'Card number',
  occupation: 'Occupation',
  occupationAr: 'Occupation (Arabic)',
  employer: 'Employer',
  employerAr: 'Employer (Arabic)',
  issuingPlace: 'Issuing place',
  issuingPlaceAr: 'Issuing place (Arabic)',
  mrzVerified: 'MRZ check digits',
  passportNumber: 'Passport number',
  licenseNo: 'Licence number',
};

/** Fields a tenant can require on every Emirates ID scan, in display order. */
export const REQUIRABLE_FIELDS = ['emiratesIdNumber', 'fullNameEn', 'fullNameAr', 'dateOfBirth', 'issueDate', 'expiryDate', 'gender', 'nationality', 'cardNumber'];
export const fieldLabel = lookup(FIELD_LABELS);

export const FEATURE_LABELS: Record<string, string> = {
  ...FLOW_LABELS,
  ...DOC_TYPE_LABELS,
  SERVER_OCR: 'Server-side OCR',
  DEDUP_SEARCH: 'Duplicate identity search',
  FACE_COMPARE: 'Face compare',
  MANUAL_REVIEW: 'Manual review',
  FILE_UPLOAD: 'Upload from file',
  DEVICE_ANTISPOOF: 'Device anti-spoof',
  WEBHOOKS: 'Webhooks',
  ARABIC_UI: 'Arabic interface',
};
export const featureLabel = lookup(FEATURE_LABELS);

export const WEBHOOK_EVENTS = [
  'SESSION_COMPLETED', 'SESSION_EXPIRED', 'REVIEW_OPENED', 'REVIEW_DECIDED', 'SCAN_REVIEW_REQUIRED', 'SCAN_REVIEW_DECIDED', 'DOCUMENT_EXPIRING', 'PARTY_ERASED',
] as const;
export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  SESSION_COMPLETED: 'Verification completed',
  SESSION_EXPIRED: 'Verification expired',
  REVIEW_OPENED: 'Review opened',
  REVIEW_DECIDED: 'Review decided',
  SCAN_REVIEW_REQUIRED: 'Scan needs review',
  SCAN_REVIEW_DECIDED: 'Scan review decided',
  DOCUMENT_EXPIRING: 'Document expiring',
  PARTY_ERASED: 'Person erased',
  TEST: 'Test event',
  WEBHOOK_TEST: 'Test event',
};
export const WEBHOOK_EVENT_HELP: Record<string, string> = {
  SESSION_COMPLETED: 'A verification got a decision, or ended without one (failed or cancelled).',
  SESSION_EXPIRED: 'A verification timed out before it was finished.',
  REVIEW_OPENED: 'A borderline verification went to manual review.',
  REVIEW_DECIDED: 'A reviewer approved or rejected it: the final answer for "In review". decidedBy says TENANT (your reviewer) or CAMTECH.',
  SCAN_REVIEW_REQUIRED: 'A document scan failed a check and waits for someone to review it.',
  SCAN_REVIEW_DECIDED: 'A held document scan was approved or rejected (decidedBy TENANT or CAMTECH).',
  DOCUMENT_EXPIRING: 'Daily: a document expires within your warning period (Document settings).',
  PARTY_ERASED: 'A person and their data were erased.',
};
export const webhookEventLabel = lookup(WEBHOOK_EVENT_LABELS);

export const REASON_CATEGORY_LABELS: Record<string, string> = {
  LIVENESS: 'Selfie liveness',
  DOCUMENT: 'Documents',
  MATCH: 'Face matching',
  SESSION: 'Session',
  ACCESS: 'Access',
  SYSTEM: 'System',
};
export const reasonCategoryLabel = lookup(REASON_CATEGORY_LABELS);

export const ACTOR_LABELS: Record<string, string> = { TENANT_USER: 'Portal user', TENANT: 'Portal (before sign-in)', ADMIN: 'CamTech operator', CLIENT: 'Client app', SYSTEM: 'System' };

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  SESSION_CREATED: 'Verification started',
  SESSION_CANCELLED: 'Verification cancelled',
  REVIEW_DECIDED: 'Review decided',
  CLIENT_APP_CREATED: 'App created',
  CLIENT_APP_UPDATED: 'App changed',
  CLIENT_APP_PERMISSIONS_UPDATED: 'App permissions changed',
  CREDENTIAL_CREATED: 'API key created',
  CREDENTIAL_REVOKED: 'API key revoked',
  WEBHOOK_CREATED: 'Webhook created',
  WEBHOOK_UPDATED: 'Webhook changed',
  WEBHOOK_DELETED: 'Webhook deleted',
  WEBHOOK_SECRET_ROTATED: 'Webhook secret rotated',
  WEBHOOK_TESTED: 'Webhook test sent',
  WEBHOOK_DELIVERY_RETRIED: 'Webhook delivery retried',
  BRANDING_UPDATED: 'Branding changed',
  BRANDING_RESET: 'Branding reset',
  LIVENESS_SETTINGS_UPDATED: 'Liveness settings changed',
  LIVENESS_POLICY_UPDATED: 'Liveness limits changed',
  PLAYGROUND_TOKEN_ISSUED: 'Playground token issued',
  SDK_TOKEN_ISSUED: 'SDK token issued',
  ENTITLEMENT_UPDATED: 'Plan changed',
  TENANT_UPDATED: 'Tenant changed',
  REVIEW_ASSIGNED: 'Review assigned',
  REVIEW_OWNER_CHANGED: 'Review owner changed',
  DOCUMENT_SCAN_REVIEWED: 'Document scan reviewed',
  DOCUMENT_SETTINGS_UPDATED: 'Document settings changed',
  DOCUMENT_OCR_SETTINGS_UPDATED: 'OCR settings changed',
  PARTY_ERASED: 'Person erased',
  PARTY_EXPORTED: 'Person data exported',
  FACE_TEMPLATE_REVOKED: 'Registered face revoked',
};
export const auditActionLabel = lookup(AUDIT_ACTION_LABELS);

export const PLATFORM_OPTIONS: Record<string, string[]> = {
  MOBILE: ['iOS', 'Android', 'iOS / Android'],
  WEB: ['Browser'],
};

export const LANGUAGE_LABELS: Record<string, string> = { en: 'English', ar: 'العربية (Arabic)' };

export const MATCH_LABELS: Record<string, string> = { STRONG: 'Strong match', WEAK: 'Weak match', NO_MATCH: 'No match' };
export const REVIEW_ACTION_LABELS: Record<string, string> = { OPENED: 'Opened', ASSIGNED: 'Assigned', COMMENTED: 'Comment', APPROVED: 'Approved', REJECTED: 'Rejected' };
export const reviewActionLabel = lookup(REVIEW_ACTION_LABELS);
export const TEMPLATE_STATUS_LABELS: Record<string, string> = { ENROLLED: 'Registered', SESSION: 'Used in one verification', REVOKED: 'Revoked' };
export const PARTY_TYPE_LABELS: Record<string, string> = { PERSON: 'Person', ORG: 'Company' };
export const MEDIA_ROLE_LABELS: Record<string, string> = {
  FRONT: 'Front', BACK: 'Back', PAGE: 'Page', DOCUMENT: 'Document', SELFIE_NORMAL: 'Selfie', SELFIE: 'Selfie', DOCUMENT_PORTRAIT: 'Document photo',
};
export const mediaRoleLabel = lookup(MEDIA_ROLE_LABELS);
export const RETENTION_CATEGORY_LABELS: Record<string, string> = {
  FAILED_ATTEMPT_MEDIA: 'Images of failed attempts',
  VERIFIED_MEDIA: 'Images used in a decision',
  SCAN_ONLY_MEDIA: 'Images of OCR-only scans',
  AUDIT_EVENTS: 'Audit log',
};
export const retentionCategoryLabel = lookup(RETENTION_CATEGORY_LABELS);
export const FIELD_SOURCE_LABELS: Record<string, string> = { CLIENT_OCR: 'App OCR', SERVER_OCR: 'Server OCR', MRZ: 'MRZ', MANUAL: 'Entered by a reviewer' };
