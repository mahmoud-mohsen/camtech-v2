import {
  useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type Ref,
  type ReactNode, type SelectHTMLAttributes,
} from 'react';
import { SdkContext } from '../context';
import { IconAlert, IconCheck, IconInfo } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'ghost-danger' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'primary', block = true, loading = false, icon, children, className, disabled, type, ...rest }: ButtonProps): ReactElement {
  return (
    <button type={type ?? 'button'} className={`ct-btn ct-btn--${variant}${block ? ' ct-btn--block' : ''}${className ? ` ${className}` : ''}`}
            disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="ct-spinner ct-spinner--sm" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
}

export interface ScreenProps {
  title: string;
  /** Short text under the title. */
  lead?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  children?: ReactNode;
  /** Bottom actions (buttons). */
  actions?: ReactNode;
  /** Move focus to the heading when shown (default true). */
  focusHeading?: boolean;
  className?: string;
  centered?: boolean;
  /** Long, scrolling screens: the actions sit on a solid bar that never covers the content. */
  barActions?: boolean;
}

/** One step of the flow: heading (focused for screen readers), content and actions at the bottom. */
export function Screen({ title, lead, icon, tone = 'brand', children, actions, focusHeading = true, className, centered, barActions }: ScreenProps): ReactElement {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  // The static preview (inside the portal) must not take the focus away from the editor.
  const preview = useContext(SdkContext)?.preview ?? false;
  useEffect(() => {
    if (focusHeading && !preview) headingRef.current?.focus({ preventScroll: false });
  }, [focusHeading, title, preview]);
  return (
    <section className={`ct-screen${centered ? ' ct-screen--centered' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={`${id}-h`}>
      <div className="ct-screen__body">
        {icon && <div className={`ct-badge ct-badge--${tone}`} aria-hidden="true">{icon}</div>}
        <h1 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="ct-title">{title}</h1>
        {lead && <div className="ct-lead">{lead}</div>}
        {children}
      </div>
      {actions && <div className={`ct-actions${barActions ? ' ct-actions--bar' : ''}`}>{actions}</div>}
    </section>
  );
}

export function Spinner({ label, size = 'md' }: { label?: string; size?: 'sm' | 'md' | 'lg' }): ReactElement {
  return (
    <span className="ct-spinner-wrap" role={label ? 'status' : undefined}>
      <span className={`ct-spinner ct-spinner--${size}`} aria-hidden="true" />
      {label && <span className="ct-visually-hidden">{label}</span>}
    </span>
  );
}

export function Alert({ tone = 'info', title, children, role }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children?: ReactNode; role?: 'alert' | 'status' }): ReactElement {
  const Icon = tone === 'success' ? IconCheck : tone === 'info' ? IconInfo : IconAlert;
  return (
    <div className={`ct-alert ct-alert--${tone}`} role={role}>
      <Icon size={20} className="ct-alert__icon" />
      <div>
        {title && <p className="ct-alert__title">{title}</p>}
        {children && <div className="ct-alert__body">{children}</div>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number | null; label: string }): ReactElement {
  const pct = value === null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`ct-progress${pct === null ? ' ct-progress--indeterminate' : ''}`} role="progressbar" aria-label={label}
         aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
      <div className="ct-progress__bar" style={pct === null ? undefined : { transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  help?: string;
  error?: string | null;
  optionalText?: string;
  onValue: (value: string) => void;
}

export function TextField({ label, help, error, optionalText, onValue, id, required, ...rest }: FieldProps): ReactElement {
  const autoId = useId();
  const fid = id ?? autoId;
  const describedBy = [help ? `${fid}-help` : '', error ? `${fid}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`ct-field${error ? ' ct-field--error' : ''}`}>
      <label htmlFor={fid} className="ct-field__label">
        {label}{!required && optionalText ? <span className="ct-field__opt"> ({optionalText})</span> : null}
      </label>
      <input id={fid} className="ct-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy}
             required={required} onChange={(e) => onValue(e.target.value)} {...rest} />
      {help && <p id={`${fid}-help`} className="ct-field__help">{help}</p>}
      {error && <p id={`${fid}-err`} className="ct-field__error">{error}</p>}
    </div>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label: string;
  options: { value: string; label: string }[];
  onValue: (value: string) => void;
  help?: string;
}

export function SelectField({ label, options, onValue, help, id, ...rest }: SelectFieldProps): ReactElement {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className="ct-field">
      <label htmlFor={fid} className="ct-field__label">{label}</label>
      <select id={fid} className="ct-input ct-select" onChange={(e) => onValue(e.target.value)}
              aria-describedby={help ? `${fid}-help` : undefined} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <p id={`${fid}-help`} className="ct-field__help">{help}</p>}
    </div>
  );
}

/**
 * Polite live region for camera hints. Announces at most every `minIntervalMs`, and only when the text changes,
 * so screen reader users are not flooded while the hint updates at frame rate.
 */
export function LiveRegion({ text, minIntervalMs = 2500 }: { text: string; minIntervalMs?: number }): ReactElement {
  const [spoken, setSpoken] = useState('');
  const lastAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (text === spoken) return;
    const wait = Math.max(0, lastAt.current + minIntervalMs - Date.now());
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      lastAt.current = Date.now();
      setSpoken(text);
    }, wait);
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, [text, spoken, minIntervalMs]);
  return <div className="ct-visually-hidden" aria-live="polite" aria-atomic="true">{spoken}</div>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return <a className="ct-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

/** Session reference to quote to support, with a copy button. */
export function Reference({ value }: { value: string }): ReactElement {
  const { t } = useContext(SdkContext)?.i18n ?? { t: (k: string) => k };
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined);
  };
  return (
    <p className="ct-ref">
      <span>{t('reference')}</span>{' '}
      <bdi className="ct-ref__value" dir="ltr">{value}</bdi>
      {typeof navigator !== 'undefined' && navigator.clipboard && (
        <button type="button" className="ct-ref__copy" onClick={copy} aria-live="polite">{t(copied ? 'copied' : 'copy')}</button>
      )}
    </p>
  );
}
