import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { Button } from './base';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab / Shift+Tab inside `container` (works inside a shadow root). */
export function trapTab(e: KeyboardEvent | globalThis.KeyboardEvent, container: HTMLElement | null): void {
  if (e.key !== 'Tab' || !container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const root = container.getRootNode() as Document | ShadowRoot;
  const active = root.activeElement;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (active === first || !container.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !container.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}

export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onClose, busy }: ConfirmDialogProps): ReactElement {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const root = ref.current?.getRootNode() as Document | ShadowRoot | undefined;
    const previous = root?.activeElement as HTMLElement | null | undefined;
    keepRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="ct-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} className="ct-dialog-box" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}
           onKeyDown={(e) => {
             if (e.key === 'Escape') {
               e.stopPropagation();
               if (!busy) onClose();
             }
             trapTab(e, ref.current);
           }}>
        <span className="ct-dialog-box__handle" aria-hidden="true" />
        <h2 id={`${id}-t`} className="ct-dialog-box__title">{title}</h2>
        <p id={`${id}-d`} className="ct-dialog-box__body">{body}</p>
        <div className="ct-dialog-box__actions">
          <Button ref={keepRef} variant="primary" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant="ghost-danger" onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
