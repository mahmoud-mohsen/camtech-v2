// Review of the scanned document: a card preview, then every detail grouped, each one editable in place.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { ScanDocumentType } from '@camtech/api-client';
import { checkEdit, groupReview, reviewSummary, type FieldReason, type ReviewField } from '../../core/scan-review';
import type { MessageKey } from '../../i18n';
import { Alert, Button, Screen } from '../components/base';
import { IconAlert, IconCheck, IconClose, IconEdit, IconIdCard, IconPlus } from '../components/icons';
import { useT } from '../context';

export interface ReviewPhoto {
  side: ScanDocumentType;
  image: Blob;
}

const REASON: Record<Exclude<FieldReason, null>, MessageKey> = {
  mrz: 'reason_mrz', match: 'reason_match', corrected: 'reason_corrected', differ: 'reason_differ', low: 'reason_low',
};

export function ScanReviewScreen({ title, fields, photos, initial, validate, confirmLabel, rescanLabel, onConfirm, onRescan }: {
  /** Document name shown on the card preview. */
  title: string;
  fields: ReviewField[];
  photos: ReviewPhoto[];
  /** Values and edits from an earlier visit of this screen. */
  initial?: { values: Record<string, string>; edited: string[] };
  /** Errors per detail (empty when the values can be confirmed). */
  validate?: (values: Record<string, string>) => Record<string, MessageKey>;
  confirmLabel?: string;
  rescanLabel?: string;
  onConfirm: (values: Record<string, string>, edited: string[]) => void;
  onRescan: () => void;
}): ReactElement {
  const { t, tk, tn, fieldLabel } = useT();
  const [values, setValues] = useState<Record<string, string>>(
    () => initial?.values ?? Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [edited, setEdited] = useState<Set<string>>(() => new Set(initial?.edited ?? []));
  const [editing, setEditing] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const confirm = () => {
    const errs = validate?.(values) ?? {};
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      listRef.current?.querySelector<HTMLElement>(`[data-key="${first}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // Details left empty are not sent.
    onConfirm(Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())), [...edited].filter((k) => values[k]?.trim()));
  };

  const urls = useMemo(() => photos.map((p) => ({ side: p.side, url: URL.createObjectURL(p.image) })), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u.url)), [urls]);

  const groups = groupReview(fields);
  const summary = reviewSummary(values);
  const toCheck = fields.filter((f) => f.status === 'check' && !edited.has(f.key)).length;
  const missing = fields.filter((f) => !(values[f.key] ?? '').trim()).length;
  const verified = fields.filter((f) => f.status === 'verified' && !edited.has(f.key)).length;

  const save = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    const original = fields.find((f) => f.key === key)?.value;
    setEdited((s) => {
      const next = new Set(s);
      if (value === original) next.delete(key);
      else next.add(key);
      return next;
    });
    setEditing(null);
    setErrors((e) => {
      if (!(key in e)) return e;
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
  };

  if (!fields.length) {
    return (
      <Screen title={t('scanResultTitle')} lead={t('scanNoFields')}
              actions={<Button onClick={onRescan}>{t('scanAgain')}</Button>} />
    );
  }

  return (
    <Screen title={t('scanReviewTitle')} lead={t('scanReviewBody')} className="ct-review" barActions
            actions={(
              <>
                {editing && <p className="ct-small ct-review__hint" role="status">{t('scanReviewEditing')}</p>}
                <Button disabled={editing !== null} icon={<IconCheck size={20} />}
                        onClick={confirm}>{confirmLabel ?? t('scanConfirmDetails')}</Button>
                <Button variant="ghost" onClick={onRescan}>{rescanLabel ?? t('scanAgain')}</Button>
              </>
            )}>
      <div className="ct-idcard" aria-label={title}>
        <div className="ct-idcard__top">
          <span className="ct-idcard__type"><IconIdCard size={18} /> {title}</span>
          {urls.length > 0 && (
            <span className="ct-idcard__photos">
              {urls.map((u) => (
                <button key={u.side} type="button" className="ct-idcard__photo" onClick={() => setZoom(u.url)}
                        aria-label={t(u.side === 'EMIRATES_ID_BACK' ? 'documentBackPhoto' : 'documentPhoto')}>
                  <img src={u.url} alt="" />
                </button>
              ))}
            </span>
          )}
        </div>
        {summary.name && <p className="ct-idcard__name">{summary.name}</p>}
        {summary.nameAr && <p className="ct-idcard__name-ar" dir="rtl">{summary.nameAr}</p>}
        <div className="ct-idcard__meta">
          {summary.number && (
            <span><span className="ct-idcard__k">{fieldLabel('idNumber')}</span><span className="ct-idcard__v" dir="ltr">{summary.number}</span></span>
          )}
          {summary.expiry && (
            <span><span className="ct-idcard__k">{fieldLabel('expiryDate')}</span><span className="ct-idcard__v" dir="ltr">{summary.expiry}</span></span>
          )}
        </div>
      </div>

      {/* One summary instead of a stack of alerts: what needs attention, then what to do. */}
      {Object.keys(errors).length > 0
        ? <Alert tone="danger" role="alert">{t('fixErrors')}</Alert>
        : toCheck > 0 || missing > 0
          ? (
            <Alert tone="warning" role="status">
              <strong>{[toCheck > 0 ? tn('scanReviewToCheck', toCheck) : null, missing > 0 ? tn('scanReviewMissing', missing) : null]
                .filter(Boolean).join(' · ')}.</strong>{' '}
              {toCheck > 0 ? t('scanReviewCompare') : t('scanReviewMissingHint')}
            </Alert>
          )
          : verified > 0 && (
            <Alert tone="success" role="status">
              <strong>{tn('scanReviewVerified', verified)}.</strong> {t('scanReviewAllVerified')}
            </Alert>
          )}
      {edited.size > 0 && (
        <p className="ct-review__stats" role="status">
          <span className="ct-chip ct-chip--edited"><IconEdit size={14} />{tn('scanReviewEdited', edited.size)}</span>
        </p>
      )}

      <div ref={listRef} className="ct-review__groups">

      {groups.map((g) => (
        <section key={g.group} className="ct-review__group" aria-label={tk(`group_${g.group}`)}>
          <h2 className="ct-review__group-title">{tk(`group_${g.group}`)}</h2>
          <ul className="ct-review__list">
            {g.fields.map((f) => (
              <ReviewRow key={f.key} field={f} label={fieldLabel(f.key)} value={values[f.key] ?? ''} edited={edited.has(f.key)}
                         editing={editing === f.key} locked={editing !== null && editing !== f.key} error={errors[f.key] ?? null}
                         onEdit={() => setEditing(f.key)} onCancel={() => setEditing(null)} onSave={(v) => save(f.key, v)} />
            ))}
          </ul>
        </section>
      ))}
      </div>

      {zoom && (
        <div className="ct-lightbox" role="dialog" aria-modal="true" aria-label={t('documentPhoto')} onClick={() => setZoom(null)}>
          <img src={zoom} alt={t('documentPhoto')} />
          <button type="button" className="ct-icon-btn ct-lightbox__close" aria-label={t('close')} onClick={() => setZoom(null)}>
            <IconClose size={22} />
          </button>
        </div>
      )}
    </Screen>
  );
}

function ReviewRow({ field, label, value, edited, editing, locked, error: rowError, onEdit, onCancel, onSave }: {
  field: ReviewField;
  /** Error from confirming (e.g. an expired card). */
  error: MessageKey | null;
  label: string;
  value: string;
  edited: boolean;
  editing: boolean;
  locked: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}): ReactElement {
  const { t, tk } = useT();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<MessageKey | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      setError(null);
      input.current?.focus();
      input.current?.select();
    } else if (wasEditing.current) {
      editBtn.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const r = checkEdit(field.kind, draft);
    if (r.error) {
      setError(r.error);
      input.current?.focus();
      return;
    }
    onSave(r.value);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const empty = !value.trim();
  const status = rowError ? 'error' : empty ? 'missing' : edited ? 'edited' : field.status;
  const alt = !edited && field.alternative && field.alternative.value !== value ? field.alternative : null;
  const id = `ct-rv-${field.key}`;

  return (
    <li data-key={field.key} className={`ct-review__row ct-review__row--${status}${editing ? ' ct-review__row--editing' : ''}`}>
      <div className="ct-review__head">
        <label className="ct-review__label" htmlFor={editing ? id : undefined}>{label}</label>
        {status === 'verified' && <span className="ct-chip ct-chip--verified"><IconCheck size={12} />{t('status_verified')}</span>}
        {status === 'check' && <span className="ct-chip ct-chip--check"><IconAlert size={12} />{t('status_check')}</span>}
        {status === 'edited' && <span className="ct-chip ct-chip--edited"><IconEdit size={12} />{t('status_edited')}</span>}
        {status === 'error' && <span className="ct-chip ct-chip--error"><IconAlert size={12} />{t('status_error')}</span>}
        {status === 'missing' && (field.required
          ? <span className="ct-chip ct-chip--error"><IconAlert size={12} />{t('status_required')}</span>
          : <span className="ct-chip ct-chip--missing">{t('status_missing')}</span>)}
      </div>

      {editing ? (
        <div className="ct-review__edit">
          <input id={id} ref={input} className={`ct-input${field.kind !== 'text' ? ' ct-input--mono' : ''}`} value={draft}
                 dir={field.rtl ? 'rtl' : field.kind === 'text' ? 'auto' : 'ltr'} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
                 inputMode={field.kind === 'text' ? 'text' : 'numeric'} autoComplete="off" spellCheck={false}
                 placeholder={field.kind === 'date' ? 'DD/MM/YYYY' : undefined}
                 aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined} />
          {error && <p id={`${id}-err`} className="ct-field__error">{t(error)}</p>}
          <div className="ct-review__edit-actions">
            <Button block={false} onClick={commit}>{t('save')}</Button>
            <Button block={false} variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
          </div>
        </div>
      ) : empty ? (
        <button ref={editBtn} type="button" className="ct-review__add" onClick={onEdit} disabled={locked}>
          <IconPlus size={16} />
          <span>{t('addField', { label })}</span>
        </button>
      ) : (
        <div className="ct-review__body">
          <p className={`ct-review__value${value ? '' : ' ct-review__value--empty'}${field.kind !== 'text' ? ' ct-review__value--mono' : ''}`}
             dir={field.rtl ? 'rtl' : field.kind === 'text' ? 'auto' : 'ltr'}>
            {value || t('scanReviewEmpty')}
          </p>
          <button ref={editBtn} type="button" className="ct-review__edit-btn" onClick={onEdit} disabled={locked}
                  aria-label={t('editField', { label })}>
            <IconEdit size={18} />
          </button>
        </div>
      )}

      {!editing && rowError && <p className="ct-field__error">{t(rowError)}</p>}
      {!editing && !rowError && !edited && !empty && field.reason && <p className="ct-review__reason">{t(REASON[field.reason])}</p>}
      {!editing && alt && (
        <div className="ct-review__alt">
          <span>{tk(alt.side === 'EMIRATES_ID_BACK' ? 'scanAltBack' : 'scanAltFront')} <bdi className="ct-review__alt-value">{alt.value}</bdi></span>
          <button type="button" className="ct-review__alt-use" onClick={() => onSave(alt.value)} disabled={locked}>{t('useThis')}</button>
        </div>
      )}
    </li>
  );
}
