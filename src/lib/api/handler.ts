import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { ZodError, type ZodSchema } from "zod";
import { auth } from "@/lib/auth";

/**
 * Unified API handler utilities. The codebase grew ~334 route handlers with
 * three different auth-check patterns and three different error shapes. These
 * helpers consolidate both into one:
 *
 *   • `withAuth(handler, { role?, modules? })` — wraps a route handler with
 *     session resolution + role/module guards. The handler receives the
 *     session as a third arg.
 *
 *   • `validateBody(schema, request)` — parses + Zod-validates a JSON body.
 *     Returns either `{ ok: true, data }` or `{ ok: false, response }` (a
 *     ready-to-return NextResponse with field-level errors).
 *
 *   • `errorResponse(message, opts?)` / `successResponse(data, opts?)` —
 *     standardized JSON envelopes. Everyone returns `{ error: string,
 *     fieldErrors?: Record<string,string> }` for failures and the bare data
 *     object (or `{ data }`) for successes.
 *
 * Old handlers don't need to be rewritten — they still work — but every NEW
 * route should use these so the surface converges.
 */

// ─── Response helpers ───────────────────────────────────────────────────────

export type ApiErrorBody = {
  error: string;
  /// Per-field validation errors. Empty when the failure is global.
  fieldErrors?: Record<string, string>;
  /// Stable machine-readable code so the client can branch without scraping
  /// the message. e.g. "UNAUTHORIZED", "FORBIDDEN", "VALIDATION_ERROR",
  /// "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR".
  code?: string;
};

export function errorResponse(
  message: string,
  opts: { status?: number; fieldErrors?: Record<string, string>; code?: string } = {}
) {
  const { status = 400, fieldErrors, code } = opts;
  const body: ApiErrorBody = { error: message };
  if (fieldErrors && Object.keys(fieldErrors).length > 0) body.fieldErrors = fieldErrors;
  if (code) body.code = code;
  return NextResponse.json(body, { status });
}

export function successResponse<T>(data: T, opts: { status?: number } = {}) {
  return NextResponse.json(data, { status: opts.status ?? 200 });
}

export const E = {
  unauthorized: () => errorResponse("Unauthorized", { status: 401, code: "UNAUTHORIZED" }),
  forbidden: (msg = "Forbidden") => errorResponse(msg, { status: 403, code: "FORBIDDEN" }),
  notFound: (msg = "Not found") => errorResponse(msg, { status: 404, code: "NOT_FOUND" }),
  validation: (msg: string, fieldErrors?: Record<string, string>) =>
    errorResponse(msg, { status: 400, fieldErrors, code: "VALIDATION_ERROR" }),
  conflict: (msg: string) => errorResponse(msg, { status: 409, code: "CONFLICT" }),
  internal: (msg = "Server error") => errorResponse(msg, { status: 500, code: "INTERNAL_ERROR" }),
};

// ─── Body validation ────────────────────────────────────────────────────────

/**
 * Parse the request JSON body and validate against a Zod schema. On success
 * returns the parsed value; on failure returns a ready-to-return NextResponse
 * with field-level errors so the client can highlight inputs.
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: E.validation("Body must be valid JSON") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of (parsed.error as ZodError).issues) {
      const key = issue.path.join(".") || "_";
      // Keep the first error per field — pages typically show one per field.
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    const first = (parsed.error as ZodError).issues[0]?.message ?? "Validation failed";
    return { ok: false, response: E.validation(first, fieldErrors) };
  }
  return { ok: true, data: parsed.data };
}

// ─── Auth wrapper ───────────────────────────────────────────────────────────

export type AuthContext = {
  session: Session;
  userId: string;
  modules: ("hr" | "crm" | "partners")[];
  hrRoles: string[];
  crmRole?: string;
  isPlatformAdmin: boolean;
  isManager: boolean;
};

export type AuthOptions = {
  /// Require at least one of these HR roles (e.g. ["super_admin", "hr_manager"]).
  hrRoles?: string[];
  /// Require this CRM role (e.g. "MANAGER", "ADMIN").
  crmRoles?: string[];
  /// Require access to this module.
  module?: "hr" | "crm" | "partners";
  /// If true, only platform admins (super_admin OR partners-admin-without-partnerId) pass.
  platformAdminOnly?: boolean;
};

function buildContext(session: Session): AuthContext {
  const modules = (session.user.modules ?? []) as ("hr" | "crm" | "partners")[];
  const hrRoles = session.user.hrRoles ?? [];
  const crmRole = session.user.crmRole as string | undefined;
  const partnerId = session.user.partnerId ?? null;
  const isPlatformAdmin =
    hrRoles.includes("super_admin") ||
    (modules.includes("partners") && !partnerId);
  const isManager =
    isPlatformAdmin ||
    crmRole === "MANAGER" ||
    crmRole === "ADMIN" ||
    hrRoles.includes("hr_manager") ||
    hrRoles.includes("ceo");
  return {
    session,
    userId: session.user.id,
    modules,
    hrRoles,
    crmRole,
    isPlatformAdmin,
    isManager,
  };
}

type RouteHandler<T = unknown> = (
  request: Request,
  context: { params: Promise<T> },
  auth: AuthContext
) => Promise<NextResponse> | NextResponse;

/**
 * Wrap a route handler with session resolution + role/module guards. The
 * handler receives a third `AuthContext` argument so it doesn't need to
 * re-derive any of this from the session.
 */
export function withAuth<T = unknown>(
  handler: RouteHandler<T>,
  options: AuthOptions = {}
) {
  return async (request: Request, context: { params: Promise<T> }) => {
    const session = (await auth()) as Session | null;
    if (!session?.user?.id) return E.unauthorized();
    const ctx = buildContext(session);

    if (options.platformAdminOnly && !ctx.isPlatformAdmin) {
      return E.forbidden("Platform admin access required");
    }
    if (options.module && !ctx.modules.includes(options.module)) {
      return E.forbidden(`${options.module.toUpperCase()} module access required`);
    }
    if (options.hrRoles && options.hrRoles.length > 0) {
      const ok = ctx.isPlatformAdmin || options.hrRoles.some((r) => ctx.hrRoles.includes(r));
      if (!ok) return E.forbidden(`One of [${options.hrRoles.join(", ")}] HR role required`);
    }
    if (options.crmRoles && options.crmRoles.length > 0) {
      const ok = ctx.isPlatformAdmin || (ctx.crmRole && options.crmRoles.includes(ctx.crmRole));
      if (!ok) return E.forbidden(`One of [${options.crmRoles.join(", ")}] CRM role required`);
    }

    try {
      return await handler(request, context, ctx);
    } catch (err) {
      // Last-resort safety net — better than letting Next surface a generic
      // 500 with no JSON body. Keeps the error shape consistent.
      console.error("[withAuth] handler threw:", err);
      return E.internal(err instanceof Error ? err.message : "Server error");
    }
  };
}
