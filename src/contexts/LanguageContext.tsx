import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translations, type Lang, type TranslationKey } from '@/i18n/translations';
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

  const setLang = (next: Lang) => {
    setLangState(next);
    storage.set(STORAGE_KEY, next);
  };

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      t: (key) => {
        const dict = translations[lang] as Record<string, string>;
        const fallback = translations.en as Record<string, string>;
        return dict[key] ?? fallback[key] ?? key;
      },
    }),
    [lang]
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
