// Consistent colour semantics (antd Tag preset colours):
// green = approved/passed, amber = review, red = rejected/failed, blue = in progress, grey = expired/cancelled.
export type Tone = 'success' | 'warning' | 'error' | 'processing' | 'default';

export const SESSION_STATUS_TONE: Record<string, Tone> = {
  CREATED: 'processing',
  IN_PROGRESS: 'processing',
  COMPLETED: 'success',
  EXPIRED: 'default',
  FAILED: 'error',
  CANCELLED: 'default',
};
export const DECISION_TONE: Record<string, Tone> = { APPROVED: 'success', REVIEW: 'warning', REJECTED: 'error' };
export const REVIEW_STATUS_TONE: Record<string, Tone> = { OPEN: 'warning', IN_REVIEW: 'processing', APPROVED: 'success', REJECTED: 'error' };
export const STEP_STATUS_TONE: Record<string, Tone> = {
  PENDING: 'default',
  IN_PROGRESS: 'processing',
  PASSED: 'success',
  FAILED: 'error',
  REVIEW: 'warning',
  SKIPPED: 'default',
};
export const OUTCOME_TONE: Record<string, Tone> = { PASS: 'success', REVIEW: 'warning', FAIL: 'error', SKIPPED: 'default' };
export const DOC_STATUS_TONE: Record<string, Tone> = { CAPTURED: 'processing', VERIFIED: 'success', EXPIRED: 'default', REJECTED: 'error' };
export const SCAN_STATUS_TONE: Record<string, Tone> = {
  PENDING: 'default',
  PROCESSING: 'processing',
  COMPLETED: 'success',
  NEEDS_REVIEW: 'warning',
  REJECTED: 'error',
  FAILED: 'error',
};
export const DELIVERY_STATUS_TONE: Record<string, Tone> = { PENDING: 'processing', DELIVERED: 'success', RETRYING: 'warning', FAILED: 'error' };
export const ACTIVE_TONE: Record<string, Tone> = { ACTIVE: 'success', DISABLED: 'default', REVOKED: 'default', ENROLLED: 'success', SESSION: 'processing' };

/** Hex values for charts and bars (noqodi semantic ramps, readable in light and dark). */
export const TONE_HEX = {
  success: '#079455',
  warning: '#F79009',
  error: '#D92D20',
  processing: '#0074C1',
  default: '#98A2B3',
};

/** noqodi design tokens. Light values come from the design system; dark values are derived from them. */
export const PALETTE = {
  light: {
    primary: '#0074C1',
    success: '#079455',
    warning: '#F79009',
    error: '#D92D20',
    heading: '#0B2545',
    text: '#292D32',
    textSecondary: '#475467',
    textTertiary: '#667085',
    page: '#F9FAFB',
    card: '#FFFFFF',
    subtle: '#F9FAFB',
    rowHover: '#F5FAFF',
    border: '#D0D5DD',
    borderSubtle: '#EAECF0',
    sider: '#0B2545',
  },
  dark: {
    primary: '#3E97FF',
    success: '#32D583',
    warning: '#FDB022',
    error: '#F97066',
    heading: '#F2F4F7',
    text: '#E4E7EC',
    textSecondary: '#A6AFBF',
    textTertiary: '#8A94A6',
    page: '#0A1322',
    card: '#111C2E',
    subtle: '#15223A',
    rowHover: '#17263F',
    border: '#2C3A52',
    borderSubtle: '#1E2B42',
    sider: '#071528',
  },
};
