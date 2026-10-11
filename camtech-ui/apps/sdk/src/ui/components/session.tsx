import { useEffect, useRef, useState, type ReactElement } from 'react';
import { IconClock } from './icons';
import { useNow } from './hooks';
import { useT } from '../context';

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** The countdown stays out of sight until this close to the expiry: a visible clock only adds pressure. */
export const TIMER_VISIBLE_MS = 120_000;

/** Countdown to the session expiry: a banner in the last two minutes, an alert under one, and expiry reported once. */
export function SessionTimer({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }): ReactElement | null {
  const { t } = useT();
  const end = Date.parse(expiresAt);
  const now = useNow(1000, Number.isFinite(end));
  const remaining = end - now;
  const fired = useRef(false);
  const [warned, setWarned] = useState(false);
  useEffect(() => {
    if (!Number.isFinite(end)) return;
    if (remaining <= 0 && !fired.current) {
      fired.current = true;
      onExpire();
    } else if (remaining < 60_000 && !warned) {
      setWarned(true);
    }
  }, [remaining, end, onExpire, warned]);
  if (!Number.isFinite(end) || remaining <= 0 || remaining > TIMER_VISIBLE_MS) return null;
  const soon = remaining < 60_000;
  return (
    <div className={`ct-timer${soon ? ' ct-timer--soon' : ''}`}>
      <IconClock size={18} className="ct-timer__icon" />
      <p className="ct-timer__text">
        <strong className="ct-timer__value">{t('sessionExpiresIn', { time: formatRemaining(remaining) })}</strong>{' '}
        {t('sessionFinishSoon')}
      </p>
      {warned && soon && <span className="ct-visually-hidden" role="alert">{t('sessionExpiringSoon')}</span>}
    </div>
  );
}
