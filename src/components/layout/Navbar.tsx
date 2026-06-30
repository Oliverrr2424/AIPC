"use client";

import Link from "next/link";
import { Cpu, List, X } from "@phosphor-icons/react";
import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { ButtonLink } from "../ui/Button";
import { useLocale } from "@/lib/i18n/LocaleProvider";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();
  const links = [
    ["/build/chat", t("nav.rag")],
    ["/build", t("nav.form")],
    ["/parts", t("nav.parts")],
    ["/builds/example/gaming-4k", t("nav.examples")],
  ] as const;
  return <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color:var(--bg)]/90 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight"><span className="grid size-8 place-items-center rounded-lg bg-[var(--accent)] text-white"><Cpu size={19} weight="bold"/></span>AI PC Builder</Link>
      <nav className="hidden items-center gap-6 text-sm text-[var(--muted)] md:flex">{links.map(([href, label]) => <Link key={href} className="hover:text-[var(--text)]" href={href}>{label}</Link>)}</nav>
      <div className="hidden items-center gap-2 md:flex"><LanguageToggle/><ThemeToggle/><ButtonLink href="/build/chat">{t("nav.describe")}</ButtonLink></div>
      <button className="grid size-10 place-items-center rounded-lg md:hidden" aria-label={t("nav.menu")} onClick={() => setOpen(!open)}>{open ? <X/> : <List/>}</button>
    </div>
    {open && <div className="nav-panel-enter border-t border-[var(--line)] px-4 py-4 md:hidden">
      <nav className="grid gap-1">{links.map(([href, label]) => <Link key={href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 hover:bg-[var(--panel-2)]" href={href}>{label}</Link>)}</nav>
      <div className="mt-3 flex gap-2"><LanguageToggle/><ThemeToggle/><ButtonLink className="flex-1" href="/build/chat">{t("nav.describe")}</ButtonLink></div>
    </div>}
  </header>;
}
