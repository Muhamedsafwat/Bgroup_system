// In-process pub/sub for live updates (notifications, kanban moves, etc.).
//
// Today this is single-process. On a multi-instance deployment swap the
// internals for Redis pub/sub or a hosted broker (PartyKit, Ably, Soketi)
// without changing call sites.

import { EventEmitter } from "node:events";

export type AppEvent =
  // Notifications. `module` reflects the source bucket so the client
  // can route the toast / badge update; `id` is the row id for
  // optimistic local updates if needed.
  | {
      type: "notification.created";
      userId: string;
      payload: {
        id?: string;
        module?: "hr" | "partners" | "crm";
        title: string;
        message: string;
      };
    }
  | { type: "notification.read"; userId: string; payload: { id: string } }
  // Partners deal lifecycle (so other admins watching the queue see live updates)
  | { type: "partners.deal.updated"; userId: string; payload: { id: string; status: string } }
  // Tasks lifecycle (so the assignee's My Tasks list refreshes live)
  | { type: "task.created"; userId: string; payload: { id: string; title: string; module: string } }
  | { type: "task.updated"; userId: string; payload: { id: string; status: string } }
  // Generic refresh hint — clients invalidate the listed query keys
  | { type: "data.invalidate"; userId: string; payload: { queryKeys: string[][] } };

// Symbol on globalThis so the singleton survives Next.js hot-reload in dev.
const KEY = Symbol.for("bgroup.events.bus");
type GlobalWithBus = typeof globalThis & { [KEY]?: EventEmitter };
const g = globalThis as GlobalWithBus;
const emitter: EventEmitter = g[KEY] ?? new EventEmitter();
emitter.setMaxListeners(0);
g[KEY] = emitter;

/** Publish an event. Server-side use only. */
export function publish(event: AppEvent): void {
  emitter.emit("event", event);
}

/**
 * Subscribe to events. Returns an unsubscribe function.
 *
 * Use this from an SSE route handler to forward events to a specific user.
 */
export function subscribe(listener: (event: AppEvent) => void): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}
