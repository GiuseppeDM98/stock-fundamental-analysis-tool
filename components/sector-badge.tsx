"use client";

import { detectSector, getRecommendedMethod, getSectorColor } from "@/lib/valuation/sector";

type Props = {
  sector: string | null;
  industry: string | null;
};

export function SectorBadge({ sector }: Props) {
  if (!sector) return null;
  const s = detectSector(sector);
  const { label } = getRecommendedMethod(s);
  const colorClasses = getSectorColor(s);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colorClasses}`}>
      {sector} · {label}
    </span>
  );
}
