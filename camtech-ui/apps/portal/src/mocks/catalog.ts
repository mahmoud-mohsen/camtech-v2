// Static reference data for the mock tenant API.
import type { Branding, ReasonCode } from '@camtech/api-client';

export const REASON_CODES: ReasonCode[] = [
  { code: 'TOO_DARK', category: 'LIVENESS', messageEn: 'It is too dark. Move to a brighter place and try again.', messageAr: 'المكان مظلم جداً. انتقل إلى مكان أكثر إضاءة وحاول مرة أخرى.' },
  { code: 'TOO_BRIGHT', category: 'LIVENESS', messageEn: 'There is too much light. Avoid direct sunlight behind or in front of you.', messageAr: 'الإضاءة قوية جداً. تجنّب ضوء الشمس المباشر خلفك أو أمامك.' },
  { code: 'BLURRY', category: 'LIVENESS', messageEn: 'The photo is blurry. Hold the phone still and try again.', messageAr: 'الصورة غير واضحة. ثبّت الهاتف وحاول مرة أخرى.' },
  { code: 'FACE_TOO_SMALL', category: 'LIVENESS', messageEn: 'Your face is too far away. Fill the oval with your face.', messageAr: 'وجهك بعيد جداً. اجعل وجهك يملأ الإطار البيضاوي.' },
  { code: 'MULTIPLE_FACES', category: 'LIVENESS', messageEn: 'More than one face is visible. Only you should be in the photo.', messageAr: 'يظهر أكثر من وجه. يجب أن تكون وحدك في الصورة.' },
  { code: 'HEAD_TURNED', category: 'LIVENESS', messageEn: 'Look straight at the camera.', messageAr: 'انظر مباشرة إلى الكاميرا.' },
  { code: 'HEAD_TILTED', category: 'LIVENESS', messageEn: 'Keep your head straight, not tilted.', messageAr: 'أبقِ رأسك مستقيماً وغير مائل.' },
  { code: 'NO_FACE', category: 'LIVENESS', messageEn: 'No face was found. Make sure your face is inside the oval.', messageAr: 'لم يتم العثور على وجه. تأكد من أن وجهك داخل الإطار البيضاوي.' },
  { code: 'FACE_CHANGED', category: 'LIVENESS', messageEn: 'The face changed during the check. The same person must complete it.', messageAr: 'تغيّر الوجه أثناء التحقق. يجب أن يكمل الشخص نفسه التحقق.' },
  { code: 'NOT_CLOSER', category: 'LIVENESS', messageEn: 'Bring the phone closer to your face when asked.', messageAr: 'قرّب الهاتف من وجهك عندما يُطلب منك ذلك.' },
  { code: 'SPOOF_SUSPECTED', category: 'LIVENESS', messageEn: 'We could not confirm a live person. Try again without a screen or printed photo.', messageAr: 'لم نتمكن من التأكد من وجود شخص حقيقي. حاول مرة أخرى دون شاشة أو صورة مطبوعة.' },
  { code: 'FACE_NOT_VISIBLE', category: 'LIVENESS', messageEn: 'We lost sight of your face during the check. Keep your face in the frame and try again.', messageAr: 'فقدنا رؤية وجهك أثناء التحقق. أبقِ وجهك داخل الإطار وحاول مرة أخرى.' },
  { code: 'ID_NUMBER_INVALID', category: 'DOCUMENT', messageEn: 'The Emirates ID number is not valid. Check it and try again.', messageAr: 'رقم الهوية الإماراتية غير صحيح. تحقق منه وحاول مرة أخرى.' },
  { code: 'MRZ_INVALID', category: 'DOCUMENT', messageEn: 'The passport machine-readable zone could not be verified. Rescan the photo page.', messageAr: 'تعذّر التحقق من المنطقة المقروءة آلياً في جواز السفر. أعد تصوير صفحة البيانات.' },
  { code: 'ID_EXPIRED', category: 'DOCUMENT', messageEn: 'This Emirates ID has expired. Please use a valid document.', messageAr: 'انتهت صلاحية بطاقة الهوية. يرجى استخدام وثيقة سارية.' },
  { code: 'PASSPORT_EXPIRED', category: 'DOCUMENT', messageEn: 'This passport has expired. Please use a valid passport.', messageAr: 'انتهت صلاحية جواز السفر. يرجى استخدام جواز سفر ساري.' },
  { code: 'DOC_NO_FACE', category: 'DOCUMENT', messageEn: 'No portrait was found on the document. Capture the side with your photo.', messageAr: 'لم يتم العثور على صورة شخصية في الوثيقة. صوّر الجهة التي تحمل صورتك.' },
  { code: 'LOW_CONFIDENCE', category: 'MATCH', messageEn: 'We could not confirm the match with enough confidence. Rescan the document in good light, without glare.', messageAr: 'لم نتمكن من تأكيد المطابقة بثقة كافية. أعد تصوير الوثيقة في إضاءة جيدة ودون انعكاس.' },
  { code: 'FACE_MISMATCH', category: 'MATCH', messageEn: 'Your selfie does not match the photo on the document.', messageAr: 'صورتك الذاتية لا تطابق الصورة في الوثيقة.' },
  { code: 'DUPLICATE_IDENTITY', category: 'MATCH', messageEn: 'This face is already registered to another person.', messageAr: 'هذا الوجه مسجل مسبقاً لشخص آخر.' },
  { code: 'DOCUMENT_OWNER_MISMATCH', category: 'MATCH', messageEn: 'This document is already on file for someone else.', messageAr: 'هذه الوثيقة مسجلة مسبقاً لشخص آخر.' },
  { code: 'NO_ENROLLED_FACE', category: 'MATCH', messageEn: 'No registered face was found for this person. Register the face first.', messageAr: 'لم يتم العثور على وجه مسجّل لهذا الشخص. سجّل الوجه أولًا.' },
  { code: 'FACE_ALREADY_ENROLLED', category: 'MATCH', messageEn: 'A face is already registered for this person.', messageAr: 'يوجد وجه مسجّل بالفعل لهذا الشخص.' },
  { code: 'SESSION_EXPIRED', category: 'SESSION', messageEn: 'This verification has expired. Please start again.', messageAr: 'انتهت صلاحية عملية التحقق. يرجى البدء من جديد.' },
  { code: 'SESSION_CANCELLED', category: 'SESSION', messageEn: 'The verification was cancelled.', messageAr: 'تم إلغاء عملية التحقق.' },
  { code: 'TOO_MANY_ATTEMPTS', category: 'SESSION', messageEn: 'Too many attempts. Please start a new verification.', messageAr: 'محاولات كثيرة. يرجى بدء عملية تحقق جديدة.' },
  { code: 'QUOTA_EXCEEDED', category: 'ACCESS', messageEn: 'The service is busy. Please try again later.', messageAr: 'الخدمة مشغولة. يرجى المحاولة لاحقاً.' },
  { code: 'FEATURE_NOT_ENABLED', category: 'ACCESS', messageEn: 'This service is not enabled for your account.', messageAr: 'هذه الخدمة غير مفعلة لحسابك.' },
  { code: 'ORIGIN_NOT_ALLOWED', category: 'ACCESS', messageEn: 'This website is not allowed to use the verification service.', messageAr: 'هذا الموقع غير مسموح له باستخدام خدمة التحقق.' },
  { code: 'CLIENT_AUTH_INVALID', category: 'ACCESS', messageEn: 'The app credentials are not valid.', messageAr: null },
  { code: 'FILE_TOO_LARGE', category: 'SYSTEM', messageEn: 'The image is too large. Please try again.', messageAr: 'الصورة كبيرة جداً. يرجى المحاولة مرة أخرى.' },
  { code: 'FACE_SERVICE_UNAVAILABLE', category: 'SYSTEM', messageEn: 'The service is temporarily unavailable. Please try again in a moment.', messageAr: 'الخدمة غير متاحة مؤقتاً. يرجى المحاولة بعد قليل.' },
];

export const LIVENESS_FAILS = ['TOO_DARK', 'BLURRY', 'NOT_CLOSER', 'HEAD_TURNED', 'FACE_TOO_SMALL', 'TOO_BRIGHT', 'FACE_CHANGED', 'MULTIPLE_FACES', 'SPOOF_SUSPECTED'] as const;
export const DOC_FAILS = ['ID_NUMBER_INVALID', 'ID_EXPIRED', 'MRZ_INVALID', 'DOC_NO_FACE'] as const;

export const ALLOWED_FONTS = ['system-ui', 'Inter', 'Roboto', 'Noto Sans Arabic', 'Tajawal', 'Cairo'];

export function defaultBranding(tenant: string, displayName: string): Branding {
  return {
    tenant,
    displayName,
    logoDataUrl: null,
    primaryColor: '#4f46e5',
    accentColor: '#06b6d4',
    backgroundColor: '#ffffff',
    surfaceColor: '#f6f7f9',
    textColor: '#111827',
    borderRadius: 12,
    fontFamily: 'system-ui',
    themeMode: 'AUTO',
    supportEmail: null,
    supportUrl: null,
    privacyUrl: null,
    showPoweredBy: true,
    texts: {},
    updatedAt: null,
  };
}

const LOGO_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 32'><rect width='32' height='32' rx='8' fill='%230b7a5c'/><path d='M9 22V10l14 12V10' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/><text x='40' y='22' font-family='Arial' font-weight='700' font-size='16' fill='%230b7a5c'>noqodi</text></svg>";
export const NOQODI_LOGO = `data:image/svg+xml;utf8,${LOGO_SVG}`;
