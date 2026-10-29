// The one currency rule for every price↔value comparison: two currencies are the same only
// when both are known and equal after trimming. Case-sensitive on purpose — "GBp" (an LSE
// quote in pence) is not "GBP" (statements in pounds), and treating them as equal compares
// 3.50 with 350. A mismatch is never converted: the caller reports the check as
// unavailable (a gate) or omits the figure with a note. Pure, shared client and server.

/** true only when both currencies are present and identical after trim(). */
export function sameCurrency(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a?.trim();
  const right = b?.trim();
  return !!left && !!right && left === right;
}
