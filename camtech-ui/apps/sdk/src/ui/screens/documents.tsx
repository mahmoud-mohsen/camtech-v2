import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import type { IdDocumentType } from '@camtech/api-client';
import type { DocFields } from '../../core/fields';
import { cleanDocFields, validateDocFields } from '../../core/doc-form';
import { formatEid, todayIso } from '../../core/validators';
import type { MessageKey } from '../../i18n';
import { Alert, Button, Screen, TextField } from '../components/base';
import { IconChevron, IconDocument, IconIdCard, IconPassport, IconSearch } from '../components/icons';
import { useT } from '../context';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: ReactNode;
}

export function ChoiceScreen<T extends string>({ title, lead, options, onChoose, footer }: {
  title: string; lead?: string; options: ChoiceOption<T>[]; onChoose: (v: T) => void; footer?: ReactNode;
}): ReactElement {
  return (
    <Screen title={title} lead={lead} actions={footer}>
      <ul className="ct-choices">
        {options.map((o) => (
          <li key={o.value}>
            <button type="button" className="ct-choice" onClick={() => onChoose(o.value)}>
              <span className="ct-choice__icon" aria-hidden="true">{o.icon}</span>
              <span className="ct-choice__text">
                <span className="ct-choice__label">{o.label}</span>
                <span className="ct-choice__desc">{o.description}</span>
              </span>
              <IconChevron className="ct-choice__chevron" size={20} />
            </button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

export function docIcon(type: string): ReactNode {
  if (type.startsWith('PASSPORT')) return <IconPassport size={28} />;
  if (type.startsWith('TRADE')) return <IconDocument size={28} />;
  return <IconIdCard size={28} />;
}

type FieldKey = keyof DocFields;
type Errors = Partial<Record<FieldKey, MessageKey>>;

export interface ConfirmDetailsProps {
  documentType: IdDocumentType;
  image: Blob;
  /** Emirates ID back, shown next to the front when captured. */
  backImage?: Blob | null;
  initial: DocFields;
  ocrFailed: boolean;
  onSubmit: (fields: DocFields) => void;
  onRetake: () => void;
}

export function ConfirmDetailsScreen({ documentType, image, backImage, initial, ocrFailed, onSubmit, onRetake }: ConfirmDetailsProps): ReactElement {
  const { t } = useT();
  const [f, setF] = useState<DocFields>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const url = useMemo(() => URL.createObjectURL(image), [image]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const backUrl = useMemo(() => (backImage ? URL.createObjectURL(backImage) : null), [backImage]);
  useEffect(() => () => { if (backUrl) URL.revokeObjectURL(backUrl); }, [backUrl]);
  const today = todayIso();
  const eid = documentType === 'EMIRATES_ID';

  const set = (k: FieldKey) => (v: string) => {
    const value = k === 'documentNumber' && eid ? formatEid(v) : k === 'mrzLine2' ? v.toUpperCase() : v;
    const next = { ...f, [k]: value };
    setF(next);
    if (submitted) setErrors(validateDocFields(documentType, next, today));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const errs = validateDocFields(documentType, f, today);
    setErrors(errs);
    const first = (Object.keys(errs) as FieldKey[])[0];
    if (first) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    onSubmit(cleanDocFields(documentType, f));
  };

  const err = (k: FieldKey) => (errors[k] ? t(errors[k]) : null);
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <Screen title={t('confirmTitle')} lead={t(ocrFailed ? 'confirmOcrFailed' : 'confirmBody')} barActions
            actions={(
              <>
                <Button type="submit" form="ct-confirm-form">{t('confirmSubmit')}</Button>
                <Button variant="ghost" onClick={onRetake}>{t('retakePhoto')}</Button>
              </>
            )}>
      {backUrl
        ? (
          <div className="ct-doc-thumbs">
            <img className="ct-doc-thumb" src={url} alt={t('documentPhoto')} />
            <img className="ct-doc-thumb" src={backUrl} alt={t('documentBackPhoto')} />
          </div>
        )
        : <img className="ct-doc-thumb" src={url} alt={t('documentPhoto')} />}
      {submitted && hasErrors && <Alert tone="danger" role="alert">{t('fixErrors')}</Alert>}
      <form id="ct-confirm-form" ref={formRef} className="ct-form" onSubmit={submit} noValidate>
        <TextField name="documentNumber" label={t(eid ? 'field_documentNumber_EMIRATES_ID' : 'field_documentNumber_PASSPORT')}
                   value={f.documentNumber} onValue={set('documentNumber')} required error={err('documentNumber')}
                   help={eid ? t('help_eid') : undefined} inputMode={eid ? 'numeric' : 'text'} autoComplete="off"
                   autoCapitalize="characters" spellCheck={false} dir="ltr" maxLength={eid ? 18 : 12} />
        <TextField name="expiryDate" type="date" label={t('field_expiryDate')} value={f.expiryDate} onValue={set('expiryDate')}
                   required error={err('expiryDate')} min={today} dir="ltr" />
        {!eid && (
          <TextField name="mrzLine2" label={t('field_mrzLine2')} value={f.mrzLine2} onValue={set('mrzLine2')}
                     error={err('mrzLine2')} help={t('help_mrz')} optionalText={t('optional')} className="ct-input ct-input--mono"
                     autoComplete="off" autoCapitalize="characters" spellCheck={false} dir="ltr" maxLength={50} />
        )}
        <TextField name="fullName" label={t('field_fullName')} value={f.fullName} onValue={set('fullName')}
                   optionalText={t('optional')} autoComplete="name" maxLength={120} />
        <TextField name="dateOfBirth" type="date" label={t('field_dateOfBirth')} value={f.dateOfBirth} onValue={set('dateOfBirth')}
                   error={err('dateOfBirth')} optionalText={t('optional')} max={today} dir="ltr" autoComplete="bday" />
        {!eid && (
          <TextField name="issuingCountry" label={t('field_issuingCountry')} value={f.issuingCountry}
                     onValue={(v) => set('issuingCountry')(v.toUpperCase())} error={err('issuingCountry')} help={t('help_country')}
                     optionalText={t('optional')} maxLength={3} autoCapitalize="characters" spellCheck={false} dir="ltr" autoComplete="off" />
        )}
      </form>
    </Screen>
  );
}

export const TRADE_LICENCE_FORMATS = [
  'DET', 'SHARJAH_DED', 'JAFZA', 'ABU_DHABI_DED', 'AJMAN_DED', 'AJMAN_FZA', 'AJMAN_ANCFZ', 'RAS_AL_KHAIMAH_DED',
  'RAS_AL_KHAIMAH_ECONOMIC_ZONE_RAKEZ', 'UMM_AL_QUWAIN_DED', 'UMM_AL_QUWAIN_FREE_ZONE', 'FUJAIRAH_DED', 'FUJAIRAH_DIBBA_DED',
  'FUJAIRAH_MEDIA_ZONE_CREATIVE_CITY', 'SHARJAH_AIRPORT_INTERNATIONAL_FREE_ZONE', 'SHARJAH_MEDIA_CITY_FREE_ZONE',
  'SHARJAH_PUBLISHING_CITY', 'SHARJAH_RESEARCH_TECHNOLOGY_AND_INNOVATION_PARK',
] as const;

/** Issuing authority: "Detect automatically" first, then a searchable list (18 authorities do not fit a select well). */
export function TradeLicenceFormatScreen({ initial, onContinue }: { initial: string; onContinue: (format: string) => void }): ReactElement {
  const { t, tk } = useT();
  const [format, setFormat] = useState(initial);
  const [query, setQuery] = useState('');
  const name = useId();
  const options = [
    { value: '', label: t('scanFormatAuto'), hint: t('scanFormatRecommended') },
    ...TRADE_LICENCE_FORMATS.map((f) => ({ value: f, label: tk(`issuer_${f}`), hint: null })),
  ];
  const q = query.trim().toLocaleLowerCase();
  const shown = q ? options.filter((o) => o.value && o.label.toLocaleLowerCase().includes(q)) : options;
  return (
    <Screen title={t('scanFormatTitle')} lead={t('scanFormatBody')} barActions
            actions={<Button onClick={() => onContinue(format)}>{t('continue')}</Button>}>
      <label className="ct-search">
        <IconSearch size={18} />
        <input type="search" className="ct-search__input" value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder={t('scanFormatSearch')} aria-label={t('scanFormatSearch')} autoComplete="off" spellCheck={false} />
      </label>
      <div className="ct-radios" role="radiogroup" aria-label={t('scanFormatLabel')}>
        {shown.map((o) => (
          <label key={o.value || 'auto'} className={`ct-radio${o.value === format ? ' ct-radio--on' : ''}`}>
            <input type="radio" name={name} value={o.value} checked={o.value === format} onChange={() => setFormat(o.value)} />
            <span className="ct-radio__text">
              <span className="ct-radio__label">{o.label}</span>
              {o.hint && <span className="ct-radio__hint">{o.hint}</span>}
            </span>
          </label>
        ))}
        {shown.length === 0 && <p className="ct-muted ct-radios__empty">{t('scanFormatNoMatch')}</p>}
      </div>
    </Screen>
  );
}
