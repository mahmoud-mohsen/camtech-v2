/** Mask character used for hidden identifiers. */
export const MASK_CHAR = '•';

/**
 * Masks a document number so only the last `visible` letters/digits show. Separators (dashes, spaces)
 * keep their place so the format stays recognisable: 784-1990-1234567-1 -> •••-••••-••••567-1.
 */
export function maskDocumentNumber(value: string | null | undefined, visible = 4): string {
  if (!value) return '';
  const alnum = value.replace(/[^A-Za-z0-9]/g, '').length;
  let toHide = Math.max(0, alnum - visible);
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9]/.test(ch) && toHide > 0) {
      out += MASK_CHAR;
      toHide--;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Shortens a secret-like id for display: ck_1a2b3c…9f0e. */
export function shortKey(value: string, head = 10, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
