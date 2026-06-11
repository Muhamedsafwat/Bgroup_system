import { z } from "zod";

/**
 * URL field shared across CRM/HR/Partners write surfaces. Accepts
 * http/https only — rejects `javascript:` / `data:` / `file:` URIs
 * that would render as live links in the UI. Allows empty string so
 * optional fields stay clearable.
 *
 * Audit v11 HIGH: every user-supplied URL field (company.website,
 * job apply resumeUrl, expense receiptUrl, partner logoUrl, etc.)
 * should use this instead of bare `z.string().url()`.
 */
export const safeUrlField = z
  .string()
  .trim()
  .max(2000, "URL is too long")
  .refine(
    (v) => {
      if (!v) return true;
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be an http(s) URL" },
  );
