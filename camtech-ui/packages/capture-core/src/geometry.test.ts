import { describe, expect, it } from 'vitest';
import { fitShortSide, fitWidth } from './capture';
import { documentGuideRect, documentKindOf, DOCUMENT_ASPECT } from './document-analyzer';
import { coverTransform, expandRect, insetRect, viewRectToVideoRect, visibleVideoRect } from './geometry';

describe('coverTransform', () => {
  it('scales a landscape video into a portrait view by height and crops the sides', () => {
    const t = coverTransform(1280, 720, 360, 640);
    expect(t.scale).toBeCloseTo(640 / 720);
    expect(t.offsetY).toBeCloseTo(0);
    expect(t.offsetX).toBeCloseTo((360 - 1280 * (640 / 720)) / 2);
  });

  it('is identity for degenerate sizes', () => {
    expect(coverTransform(0, 0, 100, 100)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe('viewRectToVideoRect', () => {
  it('maps the whole view to the visible centre band of the video', () => {
    const r = visibleVideoRect(360, 640, 1280, 720);
    expect(r.height).toBeCloseTo(720);
    expect(r.width).toBeCloseTo(360 / (640 / 720));
    expect(r.x).toBeCloseTo((1280 - r.width) / 2);
  });

  it('maps a centred guide to a centred video rect', () => {
    const guide = { x: 18, y: 200, width: 324, height: 204 };
    const r = viewRectToVideoRect(guide, 360, 640, 1920, 1080);
    const scale = 640 / 1080;
    expect(r.width).toBeCloseTo(324 / scale);
    expect(r.x + r.width / 2).toBeCloseTo(960);
  });

  it('un-mirrors a rect drawn on a mirrored preview', () => {
    const left = { x: 0, y: 0, width: 100, height: 100 };
    const plain = viewRectToVideoRect(left, 400, 400, 400, 400, false);
    const mirrored = viewRectToVideoRect(left, 400, 400, 400, 400, true);
    expect(plain.x).toBe(0);
    expect(mirrored.x).toBe(300);
  });

  it('clamps to the video bounds', () => {
    const r = viewRectToVideoRect({ x: -50, y: -50, width: 1000, height: 1000 }, 400, 400, 400, 400);
    expect(r).toEqual({ x: 0, y: 0, width: 400, height: 400 });
  });
});

describe('rect helpers', () => {
  it('expands with a margin and clamps', () => {
    expect(expandRect({ x: 100, y: 100, width: 100, height: 50 }, 0.04, 1000, 1000))
      .toEqual({ x: 96, y: 98, width: 108, height: 54 });
    expect(expandRect({ x: 0, y: 0, width: 100, height: 100 }, 0.1, 105, 1000).width).toBe(105);
  });

  it('insets around the centre', () => {
    expect(insetRect({ x: 0, y: 0, width: 100, height: 50 }, 0.8)).toEqual({ x: 10, y: 5, width: 80, height: 40 });
  });
});

describe('documentGuideRect', () => {
  it('keeps the document aspect ratio and centres the guide', () => {
    for (const kind of ['ID_CARD', 'PASSPORT', 'A4'] as const) {
      const r = documentGuideRect(kind, 390, 700);
      expect(r.width / r.height).toBeCloseTo(DOCUMENT_ASPECT[kind], 3);
      expect(r.x + r.width / 2).toBeCloseTo(195);
      expect(r.y + r.height / 2).toBeCloseTo(350);
    }
  });

  it('is limited by height on a landscape view', () => {
    const r = documentGuideRect('A4', 1000, 500);
    expect(r.height).toBeCloseTo(400);
  });

  it('maps API types to kinds', () => {
    expect(documentKindOf('EMIRATES_ID_FRONT')).toBe('ID_CARD');
    expect(documentKindOf('PASSPORT')).toBe('PASSPORT');
    expect(documentKindOf('TRADE_LICENCE')).toBe('A4');
  });
});

describe('output sizing', () => {
  it('fits the selfie short side between 720 and 1280', () => {
    expect(fitShortSide(2560, 1440, 720, 1280)).toEqual({ width: 2276, height: 1280 });
    expect(fitShortSide(1920, 1080, 720, 1280)).toEqual({ width: 1920, height: 1080 });
    expect(fitShortSide(640, 480, 720, 1280)).toEqual({ width: 960, height: 720 });
    expect(fitShortSide(1280, 720, 720, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('fits the document width between 1200 and 2000', () => {
    expect(fitWidth(3000, 1890, 1200, 2000)).toEqual({ width: 2000, height: 1260 });
    expect(fitWidth(1000, 630, 1200, 2000)).toEqual({ width: 1200, height: 756 });
  });
});
