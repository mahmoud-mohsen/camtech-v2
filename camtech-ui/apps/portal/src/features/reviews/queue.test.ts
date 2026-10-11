import { describe, expect, it } from 'vitest';
import { caseInQueue, queuePosition, scanInQueue } from './queue';

const link = (id: number) => `/x/${id}`;

describe('review queue position', () => {
  it('finds the neighbours and what opens after a decision', () => {
    expect(queuePosition([5, 7, 9], 3, 7, link)).toEqual({ position: 2, total: 3, prev: '/x/5', next: '/x/9', afterDecision: '/x/9', remaining: 2 });
  });

  it('goes back to the first one after deciding the last', () => {
    expect(queuePosition([5, 7, 9], 3, 9, link)).toMatchObject({ position: 3, next: null, afterDecision: '/x/5', remaining: 2 });
  });

  it('says the queue is done after deciding the only one', () => {
    expect(queuePosition([7], 1, 7, link)).toMatchObject({ position: 1, prev: null, next: null, afterDecision: null, remaining: 0 });
  });

  it('offers the first entry when the current one is no longer queued', () => {
    expect(queuePosition([5, 9], 2, 7, link)).toMatchObject({ position: null, prev: null, next: '/x/5', afterDecision: '/x/5', remaining: 2 });
  });

  it('builds links that keep the queue context', () => {
    expect(scanInQueue(4)).toBe('/scans/4?from=reviews');
    expect(caseInQueue(4, 'OPEN')).toBe('/reviews/4');
    expect(caseInQueue(4, 'mine')).toBe('/reviews/4?queue=mine');
  });
});
