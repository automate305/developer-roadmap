import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { STRINGS, type Lang, type StringKey } from './strings';

export type { Lang, StringKey } from './strings';

const KEY = 'petviza.lang.v1';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Look up a string and fill {placeholders}. Falls back to English. */
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  ready: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'es';
}

interface ProviderProps {
  children: ReactNode;
  /** A language requested by the launch URL (?lang=es). Wins over the saved one. */
  initialLang?: Lang;
}

export function LanguageProvider({ children, initialLang }: ProviderProps) {
  const [lang, setLangState] = useState<Lang>(initialLang ?? 'en');
  const [ready, setReady] = useState(Boolean(initialLang));

  useEffect(() => {
    if (initialLang) {
      AsyncStorage.setItem(KEY, initialLang).catch(() => {});
      return;
    }
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        if (isLang(saved)) setLangState(saved);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [initialLang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) => interpolate(STRINGS[lang][key] ?? STRINGS.en[key], vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t, ready }), [lang, setLang, t, ready]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}

/** Shorthand for components that only need the translator. */
export function useT() {
  return useLanguage().t;
}
