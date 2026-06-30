"use client";

import Link from "next/link";
import { Cpu } from "@phosphor-icons/react";
import { useLocale } from "@/lib/i18n/LocaleProvider";

export function Footer() {
  const { t } = useLocale();
  return <footer className="mt-24 border-t border-[var(--line)]"><div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto]"><div><div className="flex items-center gap-2 font-semibold"><Cpu size={20}/>AI PC Builder</div><p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">{t("footer.description")}</p></div><div className="flex flex-wrap gap-6 text-sm text-[var(--muted)]"><Link href="/build/chat">{t("nav.rag")}</Link><Link href="/build">{t("nav.form")}</Link><Link href="/parts">{t("nav.parts")}</Link><Link href="/builds/example/ai-workstation">{t("nav.examples")}</Link></div></div></footer>;
}
