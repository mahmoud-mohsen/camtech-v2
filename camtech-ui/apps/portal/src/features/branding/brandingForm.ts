import type { Branding, BrandingTexts, BrandingUpdate, Lang } from '@camtech/api-client';

export const FONT_OPTIONS = ['system-ui', 'Inter', 'Roboto', 'Noto Sans Arabic', 'Tajawal', 'Cairo'] as const;
export const LANGS: Lang[] = ['en', 'ar'];
export const TEXT_KEYS = ['welcomeTitle', 'welcomeBody', 'doneTitle', 'doneBody'] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

export const PREVIEW_SCREENS = [
  { value: 'welcome', label: 'Welcome' },
  { value: 'liveness', label: 'Selfie' },
  { value: 'document', label: 'Document' },
  { value: 'result-approved', label: 'Approved' },
  { value: 'result-review', label: 'In review' },
  { value: 'result-rejected', label: 'Rejected' },
] as const;
export type PreviewScreen = (typeof PREVIEW_SCREENS)[number]['value'];

/** What the form holds: the update body, with optional strings left as typed. */
export type BrandingFormValues = Omit<BrandingUpdate, 'supportEmail' | 'supportUrl' | 'privacyUrl' | 'texts'> & {
  supportEmail?: string | null;
  supportUrl?: string | null;
  privacyUrl?: string | null;
  texts?: Partial<Record<Lang, BrandingTexts>>;
};

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

/** Form values -> PUT /branding body, with empty strings turned into null. */
export function toUpdate(v: BrandingFormValues): BrandingUpdate {
  const texts: BrandingUpdate['texts'] = {};
  for (const lang of LANGS) {
    const src = v.texts?.[lang];
    if (!src) continue;
    const t: BrandingTexts = {};
    let any = false;
    for (const k of TEXT_KEYS) {
      const val = clean(src[k]);
      t[k] = val;
      if (val) any = true;
    }
    if (any) texts[lang] = t;
  }
  return {
    displayName: (v.displayName ?? '').trim(),
    logoDataUrl: v.logoDataUrl ?? null,
    primaryColor: v.primaryColor,
    accentColor: v.accentColor,
    backgroundColor: v.backgroundColor,
    surfaceColor: v.surfaceColor,
    textColor: v.textColor,
    borderRadius: v.borderRadius,
    fontFamily: v.fontFamily,
    themeMode: v.themeMode,
    supportEmail: clean(v.supportEmail),
    supportUrl: clean(v.supportUrl),
    privacyUrl: clean(v.privacyUrl),
    showPoweredBy: v.showPoweredBy,
    texts,
  };
}

/** Saved branding -> form values. */
export function toFormValues(b: Branding): BrandingFormValues {
  const { tenant: _t, updatedAt: _u, ...rest } = b;
  const texts: Partial<Record<Lang, BrandingTexts>> = {};
  for (const lang of LANGS) texts[lang] = { welcomeTitle: null, welcomeBody: null, doneTitle: null, doneBody: null, ...b.texts[lang] };
  return { ...rest, texts };
}

/** Comparable key: two values that save to the same body are equal. */
export function brandingKey(u: BrandingUpdate): string {
  const lower = (c: string) => c.toLowerCase();
  return JSON.stringify({
    ...u,
    primaryColor: lower(u.primaryColor),
    accentColor: lower(u.accentColor),
    backgroundColor: lower(u.backgroundColor),
    surfaceColor: lower(u.surfaceColor),
    textColor: lower(u.textColor),
    texts: Object.fromEntries(LANGS.filter((l) => u.texts[l]).map((l) => [l, TEXT_KEYS.map((k) => u.texts[l]?.[k] ?? null)])),
  });
}

export const TEXT_PLACEHOLDERS: Record<Lang, Record<TextKey, string>> = {
  en: {
    welcomeTitle: 'Verify your identity',
    welcomeBody: 'Take a quick selfie and a photo of your ID. It takes about a minute.',
    doneTitle: 'Thank you',
    doneBody: 'Your verification is complete.',
  },
  ar: {
    welcomeTitle: 'تحقق من هويتك',
    welcomeBody: 'التقط صورة ذاتية سريعة وصورة لهويتك. يستغرق الأمر دقيقة تقريباً.',
    doneTitle: 'شكراً لك',
    doneBody: 'اكتملت عملية التحقق.',
  },
};

export const TEXT_LABELS: Record<TextKey, string> = {
  welcomeTitle: 'Welcome title',
  welcomeBody: 'Welcome message',
  doneTitle: 'Done title',
  doneBody: 'Done message',
};
