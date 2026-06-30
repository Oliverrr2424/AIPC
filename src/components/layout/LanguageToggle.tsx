"use client";

import { Translate } from "@phosphor-icons/react";
import { useLocale } from "@/lib/i18n/LocaleProvider";

export function LanguageToggle() {
  const { locale, toggleLocale, t } = useLocale();
  return <button
    type="button"
    aria-label={t("language.toggle")}
    title={t("language.toggle")}
    onClick={toggleLocale}
    className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 text-xs font-semibold text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
  >
    <Translate size={17}/><span>{locale === "en" ? "中" : "EN"}</span>
  </button>;
}
