import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { SessionResult } from '@camtech/api-client';
import { sleep } from '../../core/retry';
import { Button, Reference, Screen } from '../components/base';
import { IconCheck, IconClock } from '../components/icons';
import { useSdk } from '../context';

export const REVIEW_POLL_MS = 5000;
export const REVIEW_MAX_MS = 60000;

/** Manual review: polls the result every 5 s for up to 60 s, then says the user will be notified. */
export function UnderReviewScreen({ sessionId, doneLabel, onDecided, onResult, onDone }: {
  sessionId: string;
  doneLabel: string;
  onDecided: (r: SessionResult) => void;
  onResult: (r: SessionResult) => void;
  onDone: () => void;
}): ReactElement {
  const { client, i18n, preview, branding } = useSdk();
  const { t } = i18n;
  const [gaveUp, setGaveUp] = useState(false);
  const cbs = useRef({ onDecided, onResult });
  cbs.current = { onDecided, onResult };

  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const started = Date.now();
    void (async () => {
      while (!controller.signal.aborted && Date.now() - started < REVIEW_MAX_MS) {
        try {
          await sleep(REVIEW_POLL_MS, controller.signal);
          const r = await client.getResult(sessionId);
          if (controller.signal.aborted) return;
          cbs.current.onResult(r);
          if (r.decision === 'APPROVED' || r.decision === 'REJECTED') {
            cbs.current.onDecided(r);
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
          // A failed poll is not an error for the user: keep waiting.
        }
      }
      if (!controller.signal.aborted) setGaveUp(true);
    })();
    return () => controller.abort();
  }, [client, sessionId, preview]);

  return (
    <Screen title={t('reviewTitle')} tone="warning" centered className="ct-result" icon={<IconClock size={40} />} lead={t('reviewBody')}
            actions={(
              <>
                <p className="ct-muted ct-center ct-review-status" role="status">
                  {gaveUp ? t('reviewLater') : <><span className="ct-live-dot" aria-hidden="true" /> {t('reviewChecking')}</>}
                </p>
                <Button variant={gaveUp ? 'primary' : 'secondary'} onClick={onDone}>{doneLabel}</Button>
                {!preview && <Reference value={sessionId} />}
              </>
            )}>
      <ol className="ct-timeline">
        <li className="ct-timeline__item ct-timeline__item--done">
          <span className="ct-timeline__dot" aria-hidden="true"><IconCheck size={14} /></span>
          <span className="ct-timeline__text"><span className="ct-timeline__label">{t('reviewStepSubmitted')}</span>
            <span className="ct-timeline__desc">{t('reviewStepSubmittedDesc')}</span></span>
        </li>
        <li className="ct-timeline__item ct-timeline__item--now" aria-current="step">
          <span className="ct-timeline__dot" aria-hidden="true" />
          <span className="ct-timeline__text"><span className="ct-timeline__label">{t('reviewStepCheck')}</span>
            <span className="ct-timeline__desc">{t('reviewStepCheckDesc')}</span></span>
        </li>
        <li className="ct-timeline__item">
          <span className="ct-timeline__dot" aria-hidden="true" />
          <span className="ct-timeline__text"><span className="ct-timeline__label">{t('reviewStepDecision')}</span>
            <span className="ct-timeline__desc">{t('reviewStepDecisionDesc', { name: branding.displayName })}</span></span>
        </li>
      </ol>
    </Screen>
  );
}
