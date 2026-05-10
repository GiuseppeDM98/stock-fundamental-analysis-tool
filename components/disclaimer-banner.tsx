"use client";

import { useLanguage } from "@/context/language-context";

export function DisclaimerBanner() {
  const { t } = useLanguage();
  return (
    <div className="card border-warning/40 bg-warning/10 text-sm text-amber-100">
      <p className="font-semibold">{t("disclaimerTitle")}</p>
      <p className="mt-1 text-amber-200/90">{t("disclaimerText")}</p>
    </div>
  );
}
