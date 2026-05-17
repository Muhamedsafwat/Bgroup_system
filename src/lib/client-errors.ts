/**
 * Pulls a useful error string out of a fetch Response when the server
 * returned a non-2xx. Tries the structured `{ error, fieldErrors }` shape
 * first (every API in this app now returns that on validation failure),
 * then falls back to `detail`, `message`, the raw response text, and
 * finally the HTTP status.
 *
 * Use everywhere a client form catches a failed fetch — it stops the
 * "Save failed" toast that hides the actual cause from the user.
 *
 *   const res = await fetch(...);
 *   if (!res.ok) {
 *     toast.error(await describeFetchError(res));
 *     return;
 *   }
 *
 * If you already called `res.json()` and have the body, prefer
 * `describeErrorBody(body, res.status)` — same result without re-reading
 * the stream.
 */
export async function describeFetchError(res: Response): Promise<string> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Fall through — try text below
  }
  if (body) {
    const msg = describeErrorBody(body, res.status);
    if (msg) return msg;
  }
  try {
    const text = (await res.text()).trim();
    if (text) return text.length > 300 ? text.slice(0, 300) + "…" : text;
  } catch {
    // ignore
  }
  return `Request failed (HTTP ${res.status}${res.statusText ? ` — ${res.statusText}` : ""})`;
}

export function describeErrorBody(body: unknown, status?: number): string {
  if (!body || typeof body !== "object") return "";
  const o = body as {
    error?: string;
    detail?: string;
    message?: string;
    fieldErrors?: Record<string, string[]>;
  };
  // Prefer the structured `error` field — that's what every endpoint in
  // this app sets. Falls back to common alternatives so handlers calling
  // 3rd-party APIs still surface something meaningful.
  if (typeof o.error === "string" && o.error.trim()) return o.error;
  if (typeof o.detail === "string" && o.detail.trim()) return o.detail;
  if (typeof o.message === "string" && o.message.trim()) return o.message;
  if (o.fieldErrors) {
    const parts: string[] = [];
    for (const [k, vs] of Object.entries(o.fieldErrors)) {
      if (Array.isArray(vs) && vs.length) parts.push(`${k}: ${vs.join(", ")}`);
    }
    if (parts.length) return parts.join(" · ");
  }
  return status ? `HTTP ${status}` : "";
}

/**
 * Convenience for the most common pattern — fetch + check + toast.
 *
 *   const res = await fetch("/api/...");
 *   const data = await res.json().catch(() => ({}));
 *   if (!res.ok) {
 *     toast.error(serverError(res, data));
 *     return;
 *   }
 *
 * Use this when you've already parsed the body and need a one-liner. The
 * async `describeFetchError` is for the simpler "don't even bother parsing"
 * shortcut.
 */
export function serverError(res: Response, body: unknown): string {
  return (
    describeErrorBody(body, res.status) ||
    `Request failed (HTTP ${res.status}${res.statusText ? ` — ${res.statusText}` : ""})`
  );
}
