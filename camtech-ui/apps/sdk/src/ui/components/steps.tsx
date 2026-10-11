// Journey progress: "Step 2 of 3 · ID document" with a segmented bar (header), or a compact pill (camera screens).
import type { ReactElement } from 'react';
import type { JourneyProgress } from '../../core/journey-progress';
import type { Translator } from '../../i18n';

function texts(journey: JourneyProgress, i18n: Translator): { now: string; next: string | null } {
  const { t, tk } = i18n;
  const label = (i: number) => tk(`stage_${journey.stages[i]}`);
  if (journey.allDone) return { now: t('stepsAllDone'), next: null };
  const now = t('stepOf', { n: journey.current + 1, total: journey.stages.length, label: label(journey.current) });
  const following = journey.current + 1 < journey.stages.length ? label(journey.current + 1) : null;
  return { now, next: following ? t('stepNext', { label: following }) : null };
}

export function JourneySteps({ journey, i18n }: { journey: JourneyProgress; i18n: Translator }): ReactElement {
  const { now, next } = texts(journey, i18n);
  return (
    <div className="ct-steps" role="group" aria-label={i18n.t('journeyProgress')}>
      <p className="ct-steps__text">
        <span className="ct-steps__now">{now}</span>
        {next && <span className="ct-steps__next">{next}</span>}
      </p>
      <ol className="ct-steps__bar" aria-hidden="true">
        {journey.stages.map((s, i) => (
          <li key={`${s}-${i}`} className={`ct-steps__seg${i <= journey.current ? ' ct-steps__seg--done' : ''}`} />
        ))}
      </ol>
    </div>
  );
}

export function JourneyPill({ journey, i18n }: { journey: JourneyProgress; i18n: Translator }): ReactElement {
  return <span className="ct-cap-pill">{texts(journey, i18n).now}</span>;
}
