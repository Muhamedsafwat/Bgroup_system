/**
 * Shared from/to validation for the CRM report endpoints.
 *
 * Returns `{ from, to }` if both are present and form a valid range,
 * `null` if at least one is missing (the caller can default), or an
 * error string when the inputs are malformed / inverted.
 *
 * Audit v11 HIGH: previously every report endpoint (sales-report,
 * pdf, cohort-matrix, loss-analytics, win-rate-cube) accepted
 * `from=2026-12-31&to=2026-01-01` and silently returned empty
 * results. Reps couldn't tell the difference between "no data" and
 * "you swapped the dates."
 */
export type DateRangeResult =
  | { ok: true; from: Date; to: Date }
  | { ok: true; from: null; to: null }
  | { ok: false; error: string };

export function parseDateRangeParam(
  fromParam: string | null,
  toParam: string | null,
): DateRangeResult {
  if (!fromParam && !toParam) return { ok: true, from: null, to: null };
  if (!fromParam || !toParam) {
    return { ok: false, error: "Both `from` and `to` are required." };
  }
  const from = new Date(fromParam);
  const to = new Date(toParam);
  if (Number.isNaN(from.getTime())) {
    return { ok: false, error: "`from` is not a valid date." };
  }
  if (Number.isNaN(to.getTime())) {
    return { ok: false, error: "`to` is not a valid date." };
  }
  if (from > to) {
    return { ok: false, error: "`from` must be on or before `to`." };
  }
  return { ok: true, from, to };
}
