// Document scan (server OCR): choose → (issuer) → capture (Emirates ID: front and back) → scan → review and correct the details.
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { DocumentScanResponse, ScanDocumentType } from '@camtech/api-client';
import type { ScanType } from '../../config/options';
import { classifyError, isFatal, type ClassifiedError } from '../../core/errors';
import { buildReview, withMissing } from '../../core/scan-review';
import { scanTypesFor, uploadAllowed } from '../../core/journey';
import type { DocumentScanResult, StepName } from '../../core/protocol';
import { CamtechApiError } from '@camtech/api-client';
import { useSdk, useStep } from '../context';
import { DocumentCaptureScreen } from '../screens/capture';
import { documentTips, ErrorScreen, NoticeScreen, UploadStep } from '../screens/common';
import { ChoiceScreen, docIcon, TradeLicenceFormatScreen } from '../screens/documents';
import { ScanReviewScreen } from '../screens/scan-review';
import type { FlowProps } from './SelfieVerificationFlow';

interface Shot {
  type: ScanDocumentType;
  image: Blob;
}

interface Scanned {
  type: ScanDocumentType;
  res: DocumentScanResponse;
}

type ScanScreen =
  | { name: 'choose' }
  | { name: 'format' }
  | { name: 'capture'; index: number }
  | { name: 'scanning' }
  | { name: 'fields'; scanned: Scanned[]; photos: Shot[] }
  | { name: 'failed'; message: string | null }
  | { name: 'error'; error: ClassifiedError };

const STEP: Record<ScanScreen['name'], StepName> = {
  choose: 'DOCUMENT_CHOICE', format: 'DOCUMENT_FORMAT', capture: 'DOCUMENT_CAPTURE', scanning: 'DOCUMENT_UPLOAD',
  fields: 'SCAN_RESULT', failed: 'DOCUMENT_RESCAN', error: 'ERROR',
};

/** API types to capture for a document. */
export function sidesOf(type: ScanType): ScanDocumentType[] {
  return type === 'EMIRATES_ID' ? ['EMIRATES_ID_FRONT', 'EMIRATES_ID_BACK'] : [type];
}

export function DocumentScanFlow({ isLast, onDone }: FlowProps<DocumentScanResult>): ReactElement {
  const { client, caps, config, i18n, subjectRef, reportError, setCancelInfo } = useSdk();
  const { t } = i18n;
  const types = useMemo(() => scanTypesFor(caps, config.scanTypes), [caps, config.scanTypes]);
  const [type, setType] = useState<ScanType | null>(types.length === 1 ? types[0] : null);
  const [format, setFormat] = useState('');
  const [screen, setScreen] = useState<ScanScreen>(() => {
    if (types.length !== 1) return { name: 'choose' };
    return types[0] === 'TRADE_LICENCE' ? { name: 'format' } : { name: 'capture', index: 0 };
  });
  const shots = useRef<Shot[]>([]);
  const done = useRef<Scanned[]>([]);
  useStep('DOCUMENT_SCAN', STEP[screen.name]);

  useEffect(() => {
    setCancelInfo({ sessionId: null });
    return () => setCancelInfo(null);
  }, [setCancelInfo]);

  const sides = type ? sidesOf(type) : [];
  const restart = () => {
    shots.current = [];
    done.current = [];
    setScreen({ name: 'capture', index: 0 });
  };

  switch (screen.name) {
    case 'choose':
      return (
        <ChoiceScreen<ScanType> title={t('scanChooseTitle')} options={types.map((d) => ({
          value: d, label: t(`doc_${d}`), description: d === 'EMIRATES_ID' ? t('scanDoc_EMIRATES_ID_desc') : t(`doc_${d}_desc`), icon: docIcon(d),
        }))} onChoose={(d) => {
          setType(d);
          shots.current = [];
          done.current = [];
          setScreen(d === 'TRADE_LICENCE' ? { name: 'format' } : { name: 'capture', index: 0 });
        }} />
      );
    case 'format':
      return <TradeLicenceFormatScreen initial={format} onContinue={(f) => { setFormat(f); setScreen({ name: 'capture', index: 0 }); }} />;
    case 'capture': {
      const side = sides[screen.index];
      if (!side) return <></>;
      return (
        <DocumentCaptureScreen key={side} documentType={side}
                               sub={sides.length > 1 ? t('sideOf', { n: screen.index + 1 }) : undefined}
                               uploadAllowed={uploadAllowed(caps, 'DOCUMENT_SCAN')}
                               onCaptured={(image) => {
                                 shots.current = [...shots.current.slice(0, screen.index), { type: side, image }];
                                 if (screen.index + 1 < sides.length) setScreen({ name: 'capture', index: screen.index + 1 });
                                 else {
                                   done.current = [];
                                   setScreen({ name: 'scanning' });
                                 }
                               }} />
      );
    }
    case 'scanning':
      return (
        <UploadStep<Scanned[]> title={t('scanningDocument')} context="SCAN"
                               run={async (signal) => {
                                 // Sides already scanned (stored) are not sent again on "Try again".
                                 for (const shot of shots.current.slice(done.current.length)) {
                                   const res = await client.scanDocument(shot.image, shot.type,
                                     { store: true, subjectRef: subjectRef ?? undefined, format: format || undefined }, signal);
                                   if (!res.success) throw new CamtechApiError(422, { code: 'SCAN_FAILED', message: res.message ?? '' });
                                   done.current = [...done.current, { type: shot.type, res }];
                                 }
                                 return done.current;
                               }}
                               onSuccess={(scanned) => setScreen({ name: 'fields', scanned, photos: shots.current })}
                               onFailure={(c) => {
                                 reportError({ code: c.code, message: c.message ?? c.code, fatal: isFatal(c.action), status: c.status, flow: 'DOCUMENT_SCAN' });
                                 if (isFatal(c.action) || c.action === 'SERVICE_BUSY' || c.action === 'FEATURE_UNAVAILABLE') setScreen({ name: 'error', error: c });
                                 else setScreen({ name: 'failed', message: c.message || null });
                               }} />
      );
    case 'fields':
      return (
        <ReviewStep type={type ?? 'EMIRATES_ID'} scanned={screen.scanned} photos={screen.photos} onRescan={restart}
                    onConfirm={(fields, editedFields) => {
                      const ids = screen.scanned.map((s) => s.res.scanId).filter((x): x is string => typeof x === 'string' && x.length > 0);
                      onDone({ flow: 'DOCUMENT_SCAN', documentType: type ?? 'EMIRATES_ID', scanId: ids[0] ?? null, scanIds: ids, fields, editedFields });
                    }} />
      );
    case 'failed':
      return (
        <NoticeScreen title={t('scanFailedTitle')} message={screen.message} fallback={t('scanFailedBody')} attemptsRemaining={null}
                      tips={documentTips(t)}
                      actionLabel={t('scanAgain')} onAction={restart}
                      secondary={types.length > 1 ? { label: t('useOtherDocument'), onClick: () => setScreen({ name: 'choose' }) } : { label: t(isLast ? 'close' : 'continue'), onClick: () => onDone(null) }} />
      );
    case 'error':
      return <ErrorScreen error={screen.error} onRetry={isFatal(screen.error.action) ? undefined : restart} onClose={() => onDone(null)} />;
    default:
      return <ErrorScreen error={classifyError(null, 'SCAN')} onClose={() => onDone(null)} />;
  }
}

/** The merged, editable review of every scanned side. */
function ReviewStep({ type, scanned, photos, onConfirm, onRescan }: {
  type: ScanType;
  scanned: Scanned[];
  photos: Shot[];
  onConfirm: (fields: Record<string, string>, edited: string[]) => void;
  onRescan: () => void;
}): ReactElement {
  const { t } = useSdk().i18n;
  const fields = useMemo(() => withMissing(type, buildReview(scanned)), [type, scanned]);
  const shots = useMemo(() => photos.map((p) => ({ side: p.type, image: p.image })), [photos]);
  return <ScanReviewScreen title={t(`doc_${type}`)} fields={fields} photos={shots} onConfirm={onConfirm} onRescan={onRescan} />;
}
