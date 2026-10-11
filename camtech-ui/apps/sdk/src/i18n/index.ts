import type { Lang } from '@camtech/api-client';
import { ar } from './ar';
import { en, type MessageKey } from './en';
import { humanizeKey } from '../core/fields';

export type { MessageKey };
/** Every English key must be translated; extra keys hold plural forms. */
export type Messages = Record<MessageKey, string> & Record<string, string>;

const catalogs: Record<Lang, Messages> = { en, ar };

export type Vars = Record<string, string | number>;

export interface Translator {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, vars?: Vars) => string;
  /** Looks up a dynamic key (e.g. `hint_${code}`), or returns `fallback`. */
  tk: (key: string, vars?: Vars, fallback?: string) => string;
  /** Plural form of `key` (`key_one`, `key_other`…) for `n`. */
  tn: (key: string, n: number) => string;
  /** Label of an extracted OCR field. */
  fieldLabel: (key: string) => string;
  formatDate: (iso: string) => string;
}

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function createTranslator(lang: Lang): Translator {
  const cat = catalogs[lang] ?? en;
  const lookup = (key: string): string | undefined => cat[key] ?? (en as Record<string, string>)[key];
  const plural = new Intl.PluralRules(lang === 'ar' ? 'ar' : 'en');
  const dateFmt = (() => {
    try {
      return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch {
      return null;
    }
  })();
  return {
    lang,
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    t: (key, vars) => interpolate(lookup(key) ?? key, vars),
    tk: (key, vars, fallback) => {
      const s = lookup(key);
      return s === undefined ? fallback ?? key : interpolate(s, vars);
    },
    tn: (key, n) => {
      const form = plural.select(n);
      const s = lookup(`${key}_${form}`) ?? lookup(`${key}_other`) ?? key;
      return interpolate(s, { n });
    },
    fieldLabel: (key) => {
      const last = key.split('.').pop() ?? key;
      return lookup(`label_${last.toLowerCase().replace(/[^a-z0-9]/g, '')}`) ?? humanizeKey(last);
    },
    formatDate: (iso) => {
      const ms = Date.parse(`${iso}T00:00:00Z`);
      if (!dateFmt || Number.isNaN(ms)) return iso;
      return dateFmt.format(ms);
    },
  };
}
