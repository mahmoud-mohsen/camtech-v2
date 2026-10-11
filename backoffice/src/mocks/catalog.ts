// Static reference data for the mock back end (configuration catalogue).
import type { ConfigKey, DocumentType, Flow, Issuer, ReasonCode, RetentionPolicy } from '../api/types';
import { FLOW_HELP } from '../lib/labels';

export const FLOW_DOCS: Record<string, string[]> = {
  SELFIE_ID_VERIFICATION: ['EMIRATES_ID'],
  IDENTITY_VERIFICATION: ['EMIRATES_ID', 'PASSPORT'],
  FACE_AUTHENTICATION: [],
  BUSINESS_VERIFICATION: ['TRADE_LICENCE'],
  LIVENESS_CHECK: [],
  FACE_ENROLLMENT: [],
};

let stepId = 1;
function steps(flowCode: string, list: [string, boolean, number][]) {
  return list.map(([stepCode, mandatory, maxAttempts], i) => ({
    id: stepId++,
    seq: i + 1,
    stepCode,
    mandatory,
    maxAttempts,
    maxAttemptsUsed: flowCode === 'SELFIE_ID_VERIFICATION' && (stepCode === 'LIVENESS' || stepCode === 'DOC_CAPTURE'),
    tenantSwitch: stepCode === 'DEDUP_SEARCH' ? 'dedup.enabled' : null,
  }));
}

export function makeFlows(): Flow[] {
  stepId = 1;
  return [
    {
      code: 'SELFIE_ID_VERIFICATION',
      name: 'Selfie ID verification',
      description: FLOW_HELP.SELFIE_ID_VERIFICATION,
      enabled: true,
      enabledTenants: 2,
      steps: steps('SELFIE_ID_VERIFICATION', [
        ['LIVENESS', true, 5],
        ['DOC_CAPTURE', true, 3],
        ['DOC_VALIDATION', true, 1],
        ['FACE_DOC_MATCH', true, 1],
        ['DEDUP_SEARCH', false, 1],
      ]),
    },
    {
      code: 'IDENTITY_VERIFICATION',
      name: 'Identity verification',
      description: 'Full onboarding check with an Emirates ID or passport, liveness, face match and duplicate search.',
      enabled: true,
      enabledTenants: 2,
      steps: steps('IDENTITY_VERIFICATION', [
        ['DOC_CAPTURE', true, 3],
        ['DOC_VALIDATION', true, 1],
        ['LIVENESS', true, 5],
        ['FACE_DOC_MATCH', true, 1],
        ['DEDUP_SEARCH', true, 1],
      ]),
    },
    {
      code: 'FACE_AUTHENTICATION',
      name: 'Face authentication',
      description: FLOW_HELP.FACE_AUTHENTICATION,
      enabled: true,
      enabledTenants: 2,
      steps: steps('FACE_AUTHENTICATION', [
        ['LIVENESS', true, 3],
        ['FACE_TEMPLATE_MATCH', true, 1],
      ]),
    },
    {
      code: 'LIVENESS_CHECK',
      name: 'Liveness check',
      description: FLOW_HELP.LIVENESS_CHECK,
      enabled: true,
      enabledTenants: 2,
      steps: steps('LIVENESS_CHECK', [['LIVENESS', true, 1]]),
    },
    {
      code: 'FACE_ENROLLMENT',
      name: 'Face registration',
      description: FLOW_HELP.FACE_ENROLLMENT,
      enabled: true,
      enabledTenants: 2,
      steps: steps('FACE_ENROLLMENT', [
        ['LIVENESS', true, 1],
        ['DEDUP_SEARCH', false, 1],
      ]),
    },
    {
      code: 'BUSINESS_VERIFICATION',
      name: 'Business verification',
      description: 'Trade licence capture and validation for a company.',
      enabled: true,
      enabledTenants: 2,
      steps: steps('BUSINESS_VERIFICATION', [
        ['DOC_CAPTURE', true, 3],
        ['DOC_VALIDATION', true, 1],
      ]),
    },
  ];
}

export const DOCUMENT_TYPES: DocumentType[] = [
  { id: 1, code: 'EMIRATES_ID', name: 'Emirates ID', sides: 2, hasMrz: true, hasFacePhoto: true, enabled: true },
  { id: 2, code: 'PASSPORT', name: 'Passport', sides: 1, hasMrz: true, hasFacePhoto: true, enabled: true },
  { id: 3, code: 'TRADE_LICENCE', name: 'Trade licence', sides: 1, hasMrz: false, hasFacePhoto: false, enabled: true },
];

export const ISSUERS: Issuer[] = [
  { id: 1, code: 'ICP', docTypeCode: 'EMIRATES_ID', countryCode: 'ARE', emirate: null, nameEn: 'Federal Authority for Identity, Citizenship, Customs & Port Security', nameAr: 'الهيئة الاتحادية للهوية والجنسية والجمارك وأمن المنافذ' },
  { id: 2, code: 'ARE_PASSPORT', docTypeCode: 'PASSPORT', countryCode: 'ARE', emirate: null, nameEn: 'UAE passport authority', nameAr: 'جوازات دولة الإمارات' },
  { id: 3, code: 'DED_DUBAI', docTypeCode: 'TRADE_LICENCE', countryCode: 'ARE', emirate: 'DUBAI', nameEn: 'Department of Economy and Tourism — Dubai', nameAr: 'دائرة الاقتصاد والسياحة - دبي' },
  { id: 4, code: 'ADDED', docTypeCode: 'TRADE_LICENCE', countryCode: 'ARE', emirate: 'ABU_DHABI', nameEn: 'Abu Dhabi Department of Economic Development', nameAr: 'دائرة التنمية الاقتصادية - أبوظبي' },
];

export const REASON_CODES: ReasonCode[] = [
  { code: 'TOO_DARK', category: 'LIVENESS', httpStatus: 422, messageEn: 'The photo is too dark. Move to a brighter place and try again.', messageAr: 'الصورة مظلمة جداً. انتقل إلى مكان أكثر إضاءة وحاول مرة أخرى.' },
  { code: 'BLURRY', category: 'LIVENESS', httpStatus: 422, messageEn: 'The photo is blurry. Hold the phone still and try again.', messageAr: 'الصورة غير واضحة. ثبّت الهاتف وحاول مرة أخرى.' },
  { code: 'NOT_CLOSER', category: 'LIVENESS', httpStatus: 422, messageEn: 'Please move your face closer to the camera for the second photo.', messageAr: 'يرجى تقريب وجهك من الكاميرا في الصورة الثانية.' },
  { code: 'FACE_CHANGED', category: 'LIVENESS', httpStatus: 422, messageEn: 'The face changed between the two photos. The same person must take both photos.', messageAr: 'تغيّر الوجه بين الصورتين. يجب أن يلتقط الشخص نفسه الصورتين.' },
  { code: 'HEAD_TURNED', category: 'LIVENESS', httpStatus: 422, messageEn: 'Look straight at the camera and keep your head still.', messageAr: 'انظر مباشرة إلى الكاميرا وثبّت رأسك.' },
  { code: 'NO_FACE', category: 'LIVENESS', httpStatus: 422, messageEn: 'No face was found in the photo.', messageAr: 'لم يتم العثور على وجه في الصورة.' },
  { code: 'MULTIPLE_FACES', category: 'LIVENESS', httpStatus: 422, messageEn: 'More than one face is visible. Only you should be in the photo.', messageAr: 'يظهر أكثر من وجه. يجب أن تكون وحدك في الصورة.' },
  { code: 'SPOOF_SUSPECTED', category: 'LIVENESS', httpStatus: 422, messageEn: 'The selfie did not pass the anti-spoofing check.', messageAr: 'لم تجتز الصورة الذاتية فحص مكافحة الانتحال.' },
  { code: 'FACE_NOT_VISIBLE', category: 'LIVENESS', httpStatus: 422, messageEn: 'We lost sight of your face during the check. Keep your face in the frame and try again.', messageAr: 'فقدنا رؤية وجهك أثناء التحقق. أبقِ وجهك داخل الإطار وحاول مرة أخرى.' },
  { code: 'LIVENESS_MAX_ATTEMPTS', category: 'LIVENESS', httpStatus: 409, messageEn: 'Too many selfie attempts. Please start a new verification.', messageAr: 'محاولات كثيرة للصورة الذاتية. يرجى بدء عملية تحقق جديدة.' },
  { code: 'DOC_UNREADABLE', category: 'DOCUMENT', httpStatus: 422, messageEn: 'The document could not be read. Place it on a flat surface and avoid glare.', messageAr: 'تعذّرت قراءة المستند. ضعه على سطح مستوٍ وتجنب الانعكاس.' },
  { code: 'DOC_EXPIRED', category: 'DOCUMENT', httpStatus: 422, messageEn: 'The document has expired.', messageAr: 'انتهت صلاحية المستند.' },
  { code: 'DOC_TYPE_MISMATCH', category: 'DOCUMENT', httpStatus: 422, messageEn: 'This is not the expected type of document.', messageAr: 'هذا ليس نوع المستند المطلوب.' },
  { code: 'MRZ_INVALID', category: 'DOCUMENT', httpStatus: 422, messageEn: 'The machine-readable zone check digits are not valid.', messageAr: 'أرقام التحقق في المنطقة المقروءة آلياً غير صحيحة.' },
  { code: 'ID_NUMBER_INVALID', category: 'DOCUMENT', httpStatus: 422, messageEn: 'The ID number is not in a valid format.', messageAr: 'رقم الهوية ليس بصيغة صحيحة.' },
  { code: 'DOCUMENT_MAX_ATTEMPTS', category: 'DOCUMENT', httpStatus: 409, messageEn: 'Too many document attempts. Please start a new verification.', messageAr: 'محاولات كثيرة لتصوير المستند. يرجى بدء عملية تحقق جديدة.' },
  { code: 'FACE_MISMATCH', category: 'MATCH', httpStatus: 200, messageEn: 'The selfie does not match the document photo.', messageAr: 'الصورة الذاتية لا تطابق صورة المستند.' },
  { code: 'FACE_REVIEW', category: 'MATCH', httpStatus: 200, messageEn: 'The face match is uncertain and needs a manual review.', messageAr: 'تطابق الوجه غير مؤكد ويحتاج إلى مراجعة يدوية.' },
  { code: 'TEMPLATE_MISMATCH', category: 'MATCH', httpStatus: 200, messageEn: 'The face does not match the enrolled face.', messageAr: 'الوجه لا يطابق الوجه المسجل.' },
  { code: 'NO_ENROLLED_FACE', category: 'MATCH', httpStatus: 404, messageEn: 'No registered face was found for this person. Register the face first.', messageAr: 'لم يتم العثور على وجه مسجّل لهذا الشخص. سجّل الوجه أولًا.' },
  { code: 'FACE_ALREADY_ENROLLED', category: 'MATCH', httpStatus: 409, messageEn: 'A face is already registered for this person.', messageAr: 'يوجد وجه مسجّل بالفعل لهذا الشخص.' },
  { code: 'DUPLICATE_IDENTITY', category: 'MATCH', httpStatus: 200, messageEn: 'This face is already registered to another person.', messageAr: 'هذا الوجه مسجل بالفعل لشخص آخر.' },
  { code: 'SESSION_EXPIRED', category: 'SESSION', httpStatus: 410, messageEn: 'The verification session has expired.', messageAr: 'انتهت صلاحية جلسة التحقق.' },
  { code: 'SESSION_CANCELLED', category: 'SESSION', httpStatus: 409, messageEn: 'The verification was cancelled.', messageAr: 'تم إلغاء عملية التحقق.' },
  { code: 'QUOTA_EXCEEDED', category: 'ACCESS', httpStatus: 429, messageEn: 'The daily limit for this service has been reached.', messageAr: 'تم الوصول إلى الحد اليومي لهذه الخدمة.' },
  { code: 'FEATURE_NOT_ENTITLED', category: 'ACCESS', httpStatus: 403, messageEn: 'This service is not enabled for your account.', messageAr: 'هذه الخدمة غير مفعلة لحسابك.' },
  { code: 'INVALID_CREDENTIALS', category: 'ACCESS', httpStatus: 401, messageEn: 'The client credentials are not valid.', messageAr: null },
  { code: 'INTERNAL_ERROR', category: 'SYSTEM', httpStatus: 500, messageEn: 'Something went wrong on our side. Please try again.', messageAr: 'حدث خطأ من جانبنا. يرجى المحاولة مرة أخرى.' },
  { code: 'OCR_UNAVAILABLE', category: 'SYSTEM', httpStatus: 503, messageEn: 'Document reading is temporarily unavailable.', messageAr: 'قراءة المستندات غير متاحة مؤقتاً.' },
];

export const CONFIG_KEYS: ConfigKey[] = [
  { key: 'face.doc_match_similarity', type: 'NUMBER', defaultValue: '0.40', min: 0, max: 1, description: 'Selfie vs document similarity at or above which the match passes automatically.' },
  { key: 'face.review_similarity', type: 'NUMBER', defaultValue: '0.28', min: 0, max: 1, description: 'Similarity at or above which an uncertain match goes to manual review instead of being rejected.' },
  { key: 'face.excellent_similarity', type: 'NUMBER', defaultValue: '0.70', min: 0, max: 1, description: 'Similarity considered an excellent match (shown to reviewers).' },
  { key: 'face.template_match_similarity', type: 'NUMBER', defaultValue: '0.50', min: 0, max: 1, description: 'Similarity needed to match a selfie against an enrolled face (face authentication).' },
  { key: 'liveness.max_attempts', type: 'INTEGER', defaultValue: '5', min: 1, max: 10, description: 'How many selfie attempts a person gets in one session.' },
  { key: 'liveness.min_same_person_similarity', type: 'NUMBER', defaultValue: '0.5', min: 0, max: 1, description: 'Minimum similarity between the normal and the closer selfie (same person in both).' },
  { key: 'liveness.min_closer_area_gain', type: 'NUMBER', defaultValue: '1.1', min: 1, max: 3, description: 'How much bigger the face must get for the Move closer challenge, and in the closer selfie still sent by older apps (1.1 = 10% bigger).' },
  { key: 'liveness.min_device_antispoof', type: 'NUMBER', defaultValue: '0.3', min: 0, max: 1, description: 'Minimum on-device anti-spoof score.' },
  { key: 'liveness.device_antispoof_required', type: 'BOOLEAN', defaultValue: 'true', min: null, max: null, description: 'Whether the app must send an on-device anti-spoof score.' },
  { key: 'liveness.min_brightness', type: 'NUMBER', defaultValue: '0.35', min: 0, max: 1, description: 'Minimum image brightness; below it the attempt fails with TOO_DARK.' },
  { key: 'liveness.min_sharpness', type: 'NUMBER', defaultValue: '0.40', min: 0, max: 1, description: 'Minimum image sharpness; below it the attempt fails with BLURRY.' },
  { key: 'liveness.eyes_open_min', type: 'NUMBER', defaultValue: '0.24', min: 0, max: 1, description: 'Eye openness (EAR) at or above which the eyes count as open, for the blink challenge.' },
  { key: 'liveness.eyes_closed_max', type: 'NUMBER', defaultValue: '0.21', min: 0, max: 1, description: 'Eye openness (EAR) at or below which the eyes count as closed, for the blink challenge.' },
  { key: 'liveness.look_min_pitch', type: 'NUMBER', defaultValue: '15', min: 5, max: 45, description: 'Head pitch in degrees needed for the look up / look down challenges.' },
  { key: 'liveness.smile_min_gain', type: 'NUMBER', defaultValue: '1.10', min: 1, max: 2, description: 'How much wider the mouth must get for the smile challenge, compared with the neutral opening frame (1.10 = 10% wider).' },
  { key: 'liveness.max_faceless_frames', type: 'INTEGER', defaultValue: '1', min: 0, max: 5, description: 'Challenge frames without a face allowed; above it the attempt fails with FACE_NOT_VISIBLE.' },
  {
    key: 'liveness.allow_without_challenge', type: 'BOOLEAN', defaultValue: 'false', min: null, max: null,
    description: 'Released mobile apps without active-liveness support: accept uploads without a challenge (passive check required).',
  },
  { key: 'liveness.max_head_yaw_degrees', type: 'INTEGER', defaultValue: '20', min: 5, max: 45, description: 'Maximum head rotation allowed, in degrees.' },
  { key: 'document.max_attempts', type: 'INTEGER', defaultValue: '3', min: 1, max: 10, description: 'How many document capture attempts a person gets in one session.' },
  { key: 'document.min_ocr_confidence', type: 'NUMBER', defaultValue: '0.75', min: 0, max: 1, description: 'OCR confidence below which a field is flagged.' },
  { key: 'document.file_upload_allowed', type: 'BOOLEAN', defaultValue: 'false', min: null, max: null, description: 'Allow uploading a document image from a file instead of the camera.' },
  { key: 'document.accepted_types', type: 'LIST', defaultValue: 'EMIRATES_ID,PASSPORT', min: null, max: null, description: 'Document types accepted for identity flows (comma separated).' },
  { key: 'session.ttl_minutes', type: 'INTEGER', defaultValue: '15', min: 5, max: 120, description: 'How long a verification session stays open before it expires.' },
  { key: 'dedup.enabled', type: 'BOOLEAN', defaultValue: 'true', min: null, max: null, description: 'Search for the same face registered to another person.' },
  { key: 'dedup.similarity', type: 'NUMBER', defaultValue: '0.60', min: 0, max: 1, description: 'Similarity at or above which two people are considered the same face.' },
  { key: 'ocr.provider', type: 'STRING', defaultValue: 'internal', min: null, max: null, description: 'Server-side OCR engine.' },
  { key: 'webhook.max_retries', type: 'INTEGER', defaultValue: '5', min: 0, max: 20, description: 'How many times a failed webhook delivery is retried.' },
  { key: 'ui.locales', type: 'LIST', defaultValue: 'en,ar', min: null, max: null, description: 'Languages offered to end users.' },
];

export function makeRetention(now: number): RetentionPolicy[] {
  const at = new Date(now - 20 * 86400000).toISOString();
  return [
    { id: 1, dataCategory: 'FAILED_ATTEMPT_MEDIA', retentionDays: 7, description: 'Selfies and document images from attempts that failed.', updatedAt: at },
    { id: 2, dataCategory: 'VERIFIED_MEDIA', retentionDays: 365, description: 'Images from verifications that completed (approved, rejected or reviewed).', updatedAt: at },
    { id: 3, dataCategory: 'SCAN_ONLY_MEDIA', retentionDays: 30, description: 'Images sent to the standalone document scan endpoint.', updatedAt: at },
    { id: 4, dataCategory: 'AUDIT_EVENTS', retentionDays: 2555, description: 'Audit log entries (7 years).', updatedAt: at },
  ];
}
