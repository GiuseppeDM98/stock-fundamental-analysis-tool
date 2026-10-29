"use client";

// Where one row (or one statement of a year) of a financial dataset came from: the paste,
// or a web page named by its host. A web source the research run never opened is shown as
// unverified; a statement filled by a second source carries "+1".
import { useLanguage } from "@/context/language-context";
import type { DataSource } from "@/types/dataset";

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function SourceChip({ source, mixed = false }: { source: DataSource | null; mixed?: boolean }) {
  const { t } = useLanguage();
  if (!source) return <span className="text-slate-500 print:text-slate-500">—</span>;

  const unverified = !source.verified;
  const label = source.kind === "paste" ? `📋 ${t("sourceChipPaste")}` : `🌐 ${hostOf(source.url) ?? source.title ?? "web"}`;
  const tooltip = source.kind === "web" ? [source.title, source.asOf, unverified ? t("sourceChipUnverified") : null].filter(Boolean).join(" · ") : undefined;

  return (
    <span
      title={tooltip || undefined}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[10px] font-medium print:border-slate-300 print:text-slate-700 ${
        unverified ? "border-warning/50 text-warning" : "border-slate-700 text-slate-300"
      }`}
    >
      {label}
      {mixed && <span className="text-muted">+1</span>}
      {unverified && <span>· {t("sourceChipUnverified")}</span>}
    </span>
  );
}
