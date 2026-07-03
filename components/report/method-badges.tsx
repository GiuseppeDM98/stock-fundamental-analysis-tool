// Sector + valuation-method pill pair — shared between the live panel and the
// saved-analysis detail page (previously duplicated in both).
export default function MethodBadges({ sector, method }: { sector: string; method: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-medium text-slate-300 print:border print:border-slate-300 print:bg-transparent print:text-slate-700">
        {sector}
      </span>
      <span className="rounded-full bg-violet-900/50 px-3 py-1 text-xs font-semibold text-violet-300 print:border print:border-violet-400 print:bg-transparent print:text-violet-700">
        {method}
      </span>
    </div>
  );
}
