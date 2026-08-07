"use client";

import { useLang } from "./LanguageProvider";
import { LANGS } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/** Compact EN / FR language switch for the top bar. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex rounded-lg border border-line bg-paper p-0.5" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          aria-pressed={lang === l.code}
          title={l.name}
          className={cn(
            "rounded-md px-2 py-1 text-[0.72rem] font-bold transition",
            lang === l.code ? "bg-gold text-[#231b04] shadow-sm" : "text-muted hover:text-ink"
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
