import { describe, expect, it } from 'vitest';
import { journeyProgress } from './journey-progress';

describe('journey progress', () => {
  const flows = ['SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION'] as const;

  it('splits the selfie verification into a selfie and an ID document stage', () => {
    const selfie = journeyProgress(flows, 0, 'LIVENESS');
    expect(selfie).toMatchObject({ stages: ['selfie', 'document', 'faceAuth'], current: 0, finished: false });
    expect(journeyProgress(flows, 0, 'DOCUMENT_CAPTURE')?.current).toBe(1);
    expect(journeyProgress(flows, 0, 'SCAN_RESULT')?.current).toBe(1);
  });

  it('counts the stages of the earlier flows', () => {
    expect(journeyProgress(flows, 1, 'CAMERA_PERMISSION')).toMatchObject({ current: 2, finished: false, allDone: false });
    expect(journeyProgress(flows, 1, 'RESULT')).toMatchObject({ current: 2, finished: true, allDone: true });
    expect(journeyProgress(flows, 0, 'UNDER_REVIEW')).toMatchObject({ current: 1, finished: true, allDone: false });
  });

  it('keeps the previous position on loading and error steps, and hides on the welcome screen', () => {
    const doc = journeyProgress(flows, 0, 'DOCUMENT_UPLOAD');
    expect(journeyProgress(flows, 0, 'ERROR', doc)).toBe(doc);
    expect(journeyProgress(flows, 0, 'LOADING')).toBeNull();
    expect(journeyProgress(flows, 1, 'LOADING', doc)).toBeNull();
    expect(journeyProgress(flows, 0, 'WELCOME')).toBeNull();
  });

  it('shows nothing for a single-stage journey', () => {
    expect(journeyProgress(['FACE_AUTHENTICATION'], 0, 'LIVENESS')).toBeNull();
    expect(journeyProgress(['DOCUMENT_SCAN'], 0, 'DOCUMENT_CAPTURE')).toBeNull();
    expect(journeyProgress(['SELFIE_ID_VERIFICATION'], 0, 'LIVENESS')?.stages).toEqual(['selfie', 'document']);
  });
});
