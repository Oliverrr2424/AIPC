"use client";

import { Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const { t } = useLocale();
  useEffect(() => {
    const next = localStorage.theme ? localStorage.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.theme = next ? "dark" : "light";
  };
  return <button type="button" aria-label={t("theme.toggle")} title={t("theme.toggle")} onClick={toggle} className="grid size-10 place-items-center rounded-lg border border-[var(--line)] bg-[var(--panel)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]">{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
}
