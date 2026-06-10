// Centralized audit-failure reporter.
//
// audit v12 MEDIUM (MED-52) followup: HR audit writes were swallowing failures
// with only console.error, so connection loss / schema drift / constraint
// violations never reached monitoring. This hook auto-detects Sentry (global
// or @sentry/node) when present and falls back to console.error otherwise —
// so the route is in place now and wiring an SDK later is a one-step change.

type AuditFailureContext = {
  userId?: string;
  entityType?: string;
  action?: string;
};

type SentryLike = {
  captureException?: (e: unknown, hint?: unknown) => void;
};

function tryGlobalSentry(): SentryLike | null {
  try {
    const g = globalThis as unknown as { Sentry?: SentryLike };
    if (g.Sentry && typeof g.Sentry.captureException === "function") return g.Sentry;
  } catch {
    /* not in scope */
  }
  return null;
}

async function tryNodeSentry(): Promise<SentryLike | null> {
  if (process.env.NEXT_RUNTIME === "edge") return null;
  // Optional dependency — wrapped in try/catch + dynamic-string import so
  // bundlers and tsc don't fail when the package isn't installed.
  try {
    const moduleName = "@sentry/node";
    const mod = (await (import(/* webpackIgnore: true */ moduleName).catch(
      () => null,
    ) as Promise<SentryLike | null>));
    if (mod && typeof mod.captureException === "function") return mod;
  } catch {
    /* package not installed */
  }
  return null;
}

let cachedClient: SentryLike | null | undefined;
async function getSentryClient(): Promise<SentryLike | null> {
  if (cachedClient !== undefined) return cachedClient;
  const global = tryGlobalSentry();
  if (global) {
    cachedClient = global;
    return global;
  }
  const node = await tryNodeSentry();
  cachedClient = node;
  return node;
}

export function reportAuditFailure(error: unknown, ctx?: AuditFailureContext): void {
  // Fire-and-forget — never await; audit failure reporting must not block
  // the user operation that just succeeded.
  void (async () => {
    try {
      const client = await getSentryClient();
      if (client?.captureException) {
        client.captureException(error, { extra: { audit: ctx } });
        return;
      }
    } catch {
      /* fall through to stdout */
    }
    const tag = ctx
      ? `[AUDIT FAILURE] ${ctx.entityType ?? "?"}/${ctx.action ?? "?"} user=${ctx.userId ?? "?"}`
      : "[AUDIT FAILURE]";
    console.error(tag, error);
  })();
}
