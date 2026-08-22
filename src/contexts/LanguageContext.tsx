import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, loadLocale, type Dictionary, type Lang, type TranslationKey } from '@/i18n/translations';
import { storage } from '@/lib/utils';

const STORAGE_KEY = 'medcrm.lang';

interface LanguageContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function detectInitialLang(): Lang {
  const saved = storage.get<Lang | null>(STORAGE_KEY, null);
  if (saved === 'en' || saved === 'hi') return saved;
  // Browser language fallback — anything starting with `hi` → Hindi.
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('hi')) {
    return 'hi';
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  // Apply lang to <html> for screen readers + font fallback
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Devanagari is ~4 font files that English users never render a glyph from,
  // so it is kept out of index.html and injected the first time Hindi is
  // selected. Idempotent: the id check makes repeated language toggles free.
  useEffect(() => {
    if (lang !== 'hi') return;
    const ID = 'medcrm-font-devanagari';
    if (document.getElementById(ID)) return;
    const link = document.createElement('link');
    link.id = ID;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, [lang]);

  // English ships in the entry chunk; other locales arrive over the network.
  // Until the requested one lands, `dict` stays on English rather than
  // blocking render — a brief English flash beats a blank screen, and the
  // swap is a single re-render.
  const [dict, setDict] = useState<Dictionary>(en);

  useEffect(() => {
    let cancelled = false;
    if (lang === 'en') { setDict(en); return; }
    loadLocale(lang)
      .then((loaded) => { if (!cancelled) setDict(loaded); })
      .catch((err) => {
        // Staying on English is a working app in the wrong language, which is
        // far better than an unhandled rejection during startup.
        console.warn(`[i18n] could not load "${lang}", staying on English:`, err);
      });
    return () => { cancelled = true; };
  }, [lang]);

  const setLang = (next: Lang) => {
    setLangState(next);
    storage.set(STORAGE_KEY, next);
  };

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      // en is the fallback for any key the active locale has not translated.
      t: (key) => dict[key] ?? en[key] ?? key,
    }),
    [lang, dict]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}

/** Convenience hook for components that only need the `t()` function. */
export function useT() {
  return useLanguage().t;
}
