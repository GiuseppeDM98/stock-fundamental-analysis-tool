export function DisclaimerBanner() {
  return (
    <div className="card border-warning/40 bg-warning/10 text-sm text-amber-100">
      <p className="font-semibold">Informational use only</p>
      <p className="mt-1 text-amber-200/90">
        This tool is for educational analysis and not financial advice. Fair value estimates depend on assumptions and
        incomplete market data can affect outputs.
      </p>
    </div>
  );
}
