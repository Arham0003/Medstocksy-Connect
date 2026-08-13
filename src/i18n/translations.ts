/**
 * Translation registry. Keys follow `<area>.<thing>` convention.
 *
 * To add more strings:
 *   1. Add the key to `en.ts` first — it defines `TranslationKey`.
 *   2. Add the same key to `hi.ts`; TS fails the build if you forget.
 *   3. Use `const t = useT()` and `{t('your.key')}` in JSX.
 *
 * English is bundled eagerly (it is the fallback for every missing key);
 * every other locale is fetched on demand by `loadLocale`.
 */
import { en } from './en';

export { en };

export type Lang = 'en' | 'hi';

export const SUPPORTED_LANGUAGES: { code: Lang; label: string; nativeLabel: string }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
];

export type TranslationKey = keyof typeof en;

/** A fully-resolved dictionary for one language. */
export type Dictionary = Record<TranslationKey, string>;

/**
 * Fetch a locale's strings. English resolves synchronously from the already
 * bundled module; anything else is a dynamic import, so the chunk is only
 * downloaded by users who actually switch to it.
 */
export async function loadLocale(lang: Lang): Promise<Dictionary> {
  if (lang === 'en') return en;
  const mod = await import('./hi');
  return mod.hi;
}
