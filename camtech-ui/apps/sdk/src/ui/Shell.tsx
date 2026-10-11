// Theme root and chrome (header with logo / language / close, "Powered by"), shared by the app and the preview.
import { useMemo, useRef, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { Branding } from '@camtech/api-client';
import type { JourneyProgress } from '../core/journey-progress';
import type { Translator } from '../i18n';
import { resolveScheme, safeLogo, themeVars } from '../theme/theme';
import { trapTab } from './components/dialog';
import { useMediaQuery } from './components/hooks';
import { IconClose } from './components/icons';
import { JourneySteps } from './components/steps';
import css from './styles.css?inline';

export type ShellMode = 'hosted' | 'modal' | 'inline' | 'iframe';

export interface ShellProps {
  branding: Branding;
  i18n: Translator;
  mode: ShellMode;
  children: ReactNode;
  /** Close (X) button: asks for confirmation upstream. */
  onClose?: () => void;
  onToggleLang?: () => void;
  /** Esc asks to cancel (modal and iframe). */
  onEscape?: () => void;
  /** Rendered above everything (confirmation dialog). */
  overlay?: ReactNode;
  /** "Step 2 of 3" under the header. */
  journey?: JourneyProgress | null;
  /** A camera screen is shown: no header or footer, the camera takes the whole area. */
  immersive?: boolean;
}

export function Shell({ branding, i18n, mode, children, onClose, onToggleLang, onEscape, overlay, journey, immersive }: ShellProps): ReactElement {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const scheme = resolveScheme(branding.themeMode, prefersDark);
  const vars = useMemo(() => themeVars(branding, scheme), [branding, scheme]);
  const rootRef = useRef<HTMLDivElement>(null);
  const logo = safeLogo(branding.logoDataUrl);
  const { t } = i18n;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && onEscape && !overlay) {
      e.preventDefault();
      onEscape();
    }
    if (mode === 'modal' && !overlay) trapTab(e, rootRef.current);
  };

  const app = (
    <div className={`ct-app${immersive ? ' ct-app--immersive' : ''}`}>
      {!immersive && (
        <header className="ct-header">
          <div className="ct-header__row">
            <div className="ct-header__brand">
              {logo ? <img className="ct-logo" src={logo} alt={branding.displayName} /> : <span className="ct-brand-name">{branding.displayName}</span>}
            </div>
            <div className="ct-header__actions">
              {onToggleLang && (
                <button type="button" className="ct-lang" onClick={onToggleLang} aria-label={t('switchLanguageLabel')}
                        lang={i18n.lang === 'ar' ? 'en' : 'ar'}>
                  {t('switchLanguage')}
                </button>
              )}
              {onClose && (
                <button type="button" className="ct-icon-btn ct-icon-btn--plain" onClick={onClose} aria-label={t('closeVerification')}>
                  <IconClose />
                </button>
              )}
            </div>
          </div>
          {journey && <JourneySteps journey={journey} i18n={i18n} />}
        </header>
      )}
      <main className="ct-main">{children}</main>
      {branding.showPoweredBy && !immersive && <footer className="ct-footer">{t('poweredBy')}</footer>}
    </div>
  );

  return (
    <div ref={rootRef} className={`ct-root ct-root--${mode} ct-root--${scheme}`} dir={i18n.dir} lang={i18n.lang}
         style={vars as CSSProperties} onKeyDown={onKeyDown}>
      <style>{css}</style>
      {mode === 'modal'
        ? (
          <div className="ct-overlay">
            <div className="ct-modal" role="dialog" aria-modal="true" aria-label={branding.displayName}>{app}</div>
          </div>
        )
        : app}
      {overlay}
    </div>
  );
}
