import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedCorrections, correctionRows, reviewerLabel } from '../src/features/documents/scanReviewLogic.ts';

const fields = [
  { fieldCode: 'fullName', lang: null, rawValue: 'AHMED ALI', confidence: 0.9, validationStatus: 'VALID', reviewedValue: null },
  { fieldCode: 'dateOfBirth', lang: null, rawValue: '01/02/1990', confidence: 0.6, validationStatus: 'LOW_CONFIDENCE', reviewedValue: '02/01/1990' },
  { fieldCode: 'fullName', lang: 'ar', rawValue: 'أحمد', confidence: 0.8, validationStatus: 'VALID' },
];

test('rows: one per field, prefilled with the reviewed value, plus missing fields from the reasons', () => {
  const rows = correctionRows(fields, [
    { code: 'FIELD_LOW_CONFIDENCE', field: 'dateOfBirth', message: null },
    { code: 'FIELD_MISSING', field: 'emiratesIdNumber', message: 'Not read' },
    { code: 'LOW_CONFIDENCE', field: null, message: null },
  ]);
  assert.deepEqual(rows.map((r) => r.fieldCode), ['fullName', 'dateOfBirth', 'emiratesIdNumber']);
  assert.equal(rows[0].original, 'AHMED ALI');
  assert.equal(rows[1].original, '02/01/1990');
  assert.deepEqual(rows[1].reasons, ['FIELD_LOW_CONFIDENCE']);
  assert.equal(rows[2].original, '');
});

test('only changed values are sent', () => {
  const rows = correctionRows(fields, [{ code: 'FIELD_MISSING', field: 'emiratesIdNumber', message: null }]);
  assert.equal(changedCorrections(rows, { fullName: 'AHMED ALI ', dateOfBirth: '02/01/1990', emiratesIdNumber: '' }), undefined);
  assert.deepEqual(changedCorrections(rows, { fullName: 'AHMED ALY', dateOfBirth: '02/01/1990', emiratesIdNumber: ' 784-1990-1234567-1 ' }), {
    fullName: 'AHMED ALY',
    emiratesIdNumber: '784-1990-1234567-1',
  });
});

test('reviewer label', () => {
  assert.equal(reviewerLabel('ADMIN:sara'), 'sara (CamTech)');
  assert.equal(reviewerLabel('TENANT:ops'), 'ops (tenant)');
  assert.equal(reviewerLabel(null), '—');
  assert.equal(reviewerLabel('plain'), 'plain');
});
