"use client";

import { useLocale } from "@/lib/i18n/LocaleProvider";

export function RagChatIntro() {
  const { t } = useLocale();
  return <div className="mb-10 max-w-3xl">
    <p className="mono text-xs font-semibold text-[var(--accent)]">{t("chat.eyebrow")}</p>
    <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{t("chat.title")}</h1>
    <p className="mt-4 text-lg leading-8 text-[var(--muted)]">{t("chat.subtitle")}</p>
  </div>;
}
