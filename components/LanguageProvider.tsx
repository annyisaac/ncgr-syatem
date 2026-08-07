"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { translate, type Lang } from "@/lib/i18n";

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate an English source string into the active language. */
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "ncgr:lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Server + first client render use English; the stored choice is applied after
  // mount to avoid a hydration mismatch.
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    // Deliberate mount-only sync from localStorage: the server always renders
    // English, then the stored choice is applied on the client after hydration.
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    if (saved === "fr" || saved === "en") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLangState(saved);
    }
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key: string) => translate(lang, key), [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used within a LanguageProvider");
  return ctx;
}
