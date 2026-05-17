import type { ZodError } from "zod";

/**
 * Turn a Zod failure into a user-friendly message that **names the field**.
 *
 * Before:  parsed.error.issues[0].message  →  "Required"
 * After:                                    →  "Company: Required · Email: Invalid email"
 *
 * Why: the bare `issues[0].message` collapses multi-field validation into a
 * single context-free sentence, so the user has no idea WHICH field broke.
 * This helper:
 *   - prefixes every issue with the field path it came from
 *   - joins multiple issues with " · " so a single submission with three
 *     wrong fields surfaces all three (Toasts are short, the punctuation
 *     keeps the message scannable.)
 *
 * The full structured list is also returned so dialogs can render inline
 * per-field errors without having to re-parse the joined string.
 */
export function describeZodError(err: ZodError): {
  message: string;
  fieldErrors: Record<string, string[]>;
} {
  const fieldErrors: Record<string, string[]> = {};
  const parts: string[] = [];
  for (const issue of err.issues) {
    const path = issue.path
      .map((p) => String(p))
      .filter((p) => p && p !== "")
      .join(".");
    const label = path
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    parts.push(label ? `${label}: ${issue.message}` : issue.message);
    const key = path || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  // De-dup parts in case multiple issues had identical text (e.g. two
  // optional fields both rejecting null on the same union).
  const seen = new Set<string>();
  const dedup = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return { message: dedup.join(" · "), fieldErrors };
}

/**
 * Convert ANY thrown value into a useful string for an error response /
 * toast. Handles native Error, Prisma's well-known codes (unique violation,
 * FK violation, not-found), and falls back to the JSON-stringified value as
 * a last-ditch debugging aid. Never returns "Internal error" or the empty
 * string — every code path returns something the user can act on.
 */
export function describeError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;

  // Prisma errors expose `code` + `meta` — pull a friendly message out of
  // them before the generic Error.message stringification, which would
  // otherwise dump the SQL + stack into a user-facing toast.
  const e = err as { code?: string; meta?: Record<string, unknown>; message?: string };
  if (typeof e.code === "string" && e.code.startsWith("P")) {
    if (e.code === "P2002") {
      const target = (e.meta?.target as string[] | string | undefined) ?? "value";
      const targetStr = Array.isArray(target) ? target.join(", ") : target;
      return `Duplicate value — ${targetStr} is already in use`;
    }
    if (e.code === "P2003") {
      const field = (e.meta?.field_name as string | undefined) ?? "referenced record";
      return `Referenced record not found: ${field}`;
    }
    if (e.code === "P2025") {
      return (
        (e.meta?.cause as string | undefined) ??
        "The record you tried to update doesn't exist (it may have been deleted)"
      );
    }
  }

  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
