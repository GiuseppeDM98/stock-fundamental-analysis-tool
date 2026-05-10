"use client";

import { useLanguage } from "@/context/language-context";
import type { Translations } from "@/lib/i18n/translations";

type Props = {
  titleKey: keyof Translations;
  descKey: keyof Translations;
};

export function PageHeader({ titleKey, descKey }: Props) {
  const { t } = useLanguage();
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-slate-100">{t(titleKey)}</h1>
      <p className="mt-1 text-sm text-slate-400">{t(descKey)}</p>
    </div>
  );
}
