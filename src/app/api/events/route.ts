import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { subscribe, type AppEvent } from "@/lib/events/bus";

// SSE endpoint: streams events meant for the authenticated user.
//
// Usage on the client:
//   const es = new EventSource("/api/events");
//   es.addEventListener("notification.created", (e) => …);
//   es.onerror = () => es.close();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;
  // Snapshot the caller's module set at connect time. Used below to
  // filter notification events so a user who lost access to a
  // module (e.g. deactivated CRM profile) doesn't keep receiving
  // that module's `notification.created` / `data.invalidate`
  // events while the SSE stays open.
  const modules = new Set(session.user.modules ?? []);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      const send = (data: string) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          isClosed = true;
        }
      };

      // Initial hello so the client knows the connection is live.
      send(`: connected\n\n`);

      // Heartbeat every 25s to keep proxies/Vercel from killing the stream.
      const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);

      // Forward bus events tagged for this user (or broadcast).
      const unsubscribe = subscribe((event: AppEvent) => {
        // Per-user filtering — bus events carry a userId field.
        if ("userId" in event && event.userId !== userId) return;
        // Per-module filtering — a notification.created event for
        // module X should only stream to users whose `modules`
        // includes X. Without this, a deactivated CRM profile
        // would keep receiving CRM notifications + invalidation
        // events on every SSE keepalive.
        if (event.type === "notification.created") {
          const m = event.payload?.module;
          if (m && !modules.has(m)) return;
        }
        const payload = JSON.stringify(event.payload);
        send(`event: ${event.type}\n`);
        send(`data: ${payload}\n\n`);
      });

      // Close on client disconnect.
      const abort = req.signal;
      const onAbort = () => {
        isClosed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      if (abort.aborted) onAbort();
      else abort.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
