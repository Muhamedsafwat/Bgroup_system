import { db } from "@/lib/db";
import { publish } from "@/lib/events/bus";
import { z } from "zod";
import { TaskEntityType, TaskPriority, TaskType } from "@/generated/prisma";
import { moduleForEntityType } from "@/lib/tasks/helpers";

/**
 * Action registry. Each action declares an id, a Zod config schema, and an
 * `execute(config, input)` function. The dispatcher uses the schemas to
 * validate workflow definitions before persisting them.
 */

export type ActionContext = {
  workflowId: string;
  runId: string;
  /** The entity / payload that triggered the run. */
  input: Record<string, unknown>;
};

export type ActionDefinition<TConfig> = {
  id: string;
  label: string;
  description: string;
  config: z.ZodType<TConfig>;
  execute: (config: TConfig, ctx: ActionContext) => Promise<{ ok: true; result?: unknown } | { ok: false; error: string }>;
};

// ─── notify-user ──────────────────────────────────────────────────────────
const NotifyConfig = z.object({
  /** User to notify. Either a literal id, or "$input.userId" / "$input.partnerId" etc. */
  userId: z.string(),
  module: z.enum(["hr", "partners"]),
  title: z.string().min(1),
  message: z.string().min(1),
});

const notifyUser: ActionDefinition<z.infer<typeof NotifyConfig>> = {
  id: "notify-user",
  label: "Notify a user",
  description: "Create an in-app notification (and push it via SSE).",
  config: NotifyConfig,
  async execute(config, ctx) {
    const userId = resolvePlaceholder(config.userId, ctx.input);
    if (!userId) return { ok: false, error: "userId resolved to empty" };
    if (config.module === "hr") {
      // HrNotification needs an HR profile FK — we wired userId → HrUserProfile.userId.
      const notif = await db.hrNotification.create({
        data: {
          userId,
          notificationType: "workflow",
          title: config.title,
          message: config.message,
        },
      });
      publish({
        type: "notification.created",
        userId,
        payload: { id: notif.id, module: "hr", title: config.title, message: config.message },
      });
      return { ok: true, result: { notificationId: notif.id } };
    }
    const notif = await db.partnerNotification.create({
      data: {
        userId,
        type: "GENERAL",
        title: config.title,
        message: config.message,
      },
    });
    publish({
      type: "notification.created",
      userId,
      payload: { id: notif.id, module: "partners", title: config.title, message: config.message },
    });
    return { ok: true, result: { notificationId: notif.id } };
  },
};

// ─── webhook ───────────────────────────────────────────────────────────────
const WebhookConfig = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  /** "$input" sends the trigger payload as-is. Otherwise an object literal. */
  body: z.unknown().optional(),
});

const webhook: ActionDefinition<z.infer<typeof WebhookConfig>> = {
  id: "webhook",
  label: "Call an HTTP webhook",
  description: "Send a POST request to an external URL with the trigger payload.",
  config: WebhookConfig,
  async execute(config, ctx) {
    try {
      const body =
        config.body === "$input" || config.body === undefined
          ? ctx.input
          : config.body;
      // audit v12 LOW (LOW-14): add 10-second timeout to prevent indefinite hang
      const res = await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(config.headers ?? {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000), // 10-second timeout
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, result: { status: res.status } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Webhook failed" };
    }
  },
};

// ─── delay ─────────────────────────────────────────────────────────────────
const DelayConfig = z.object({
  seconds: z.number().int().positive().max(86_400),
});

const delay: ActionDefinition<z.infer<typeof DelayConfig>> = {
  id: "delay",
  label: "Wait N seconds",
  description: "Pause the run before continuing.",
  config: DelayConfig,
  async execute(config) {
    await new Promise((r) => setTimeout(r, config.seconds * 1000));
    return { ok: true };
  },
};

// ─── create-task ───────────────────────────────────────────────────────────
const CreateTaskConfig = z.object({
  /** Assignee user id. Supports placeholders like "$input.userId". */
  assigneeId: z.string(),
  /** Task title. Supports template substitution with $input.* values. */
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.nativeEnum(TaskType).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  /** Optional polymorphic link — both must be provided together. */
  entityType: z.nativeEnum(TaskEntityType).optional(),
  entityId: z.string().optional(),
  /** Days from now until the task is due. Set 0 for no due date. */
  dueInDays: z.number().int().min(0).max(365).optional(),
});

const createTask: ActionDefinition<z.infer<typeof CreateTaskConfig>> = {
  id: "create-task",
  label: "Create a task",
  description: "Spawn a to-do for a user, optionally linked to an entity.",
  config: CreateTaskConfig,
  async execute(config, ctx) {
    const assigneeId = resolvePlaceholder(config.assigneeId, ctx.input);
    if (!assigneeId) return { ok: false, error: "assigneeId resolved to empty" };

    const entityId = config.entityId ? resolvePlaceholder(config.entityId, ctx.input) : null;
    const entityType = config.entityType ?? null;
    if ((entityType && !entityId) || (!entityType && entityId)) {
      return { ok: false, error: "entityType and entityId must both be set" };
    }

    const title = renderTemplate(config.title, ctx.input);
    const description = config.description ? renderTemplate(config.description, ctx.input) : "";

    let dueAt: Date | null = null;
    if (typeof config.dueInDays === "number" && config.dueInDays > 0) {
      dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + config.dueInDays);
    }

    const task = await db.task.create({
      data: {
        title,
        description,
        type: config.type ?? "GENERAL",
        priority: config.priority ?? "MEDIUM",
        assigneeId,
        createdById: assigneeId,
        entityType,
        entityId: entityId ?? null,
        dueAt,
        module: moduleForEntityType(entityType),
        workflowRunId: ctx.runId,
      },
    });

    publish({
      type: "task.created",
      userId: assigneeId,
      payload: { id: task.id, title: task.title, module: task.module },
    });
    return { ok: true, result: { taskId: task.id } };
  },
};

export const ACTIONS: ActionDefinition<unknown>[] = [
  notifyUser as ActionDefinition<unknown>,
  webhook as ActionDefinition<unknown>,
  delay as ActionDefinition<unknown>,
  createTask as ActionDefinition<unknown>,
];

export function findAction(id: string): ActionDefinition<unknown> | undefined {
  return ACTIONS.find((a) => a.id === id);
}

/** Replace `$input.foo.bar` placeholders with values from the trigger input. */
function resolvePlaceholder(template: string, input: Record<string, unknown>): string {
  if (!template.startsWith("$input.")) return template;
  const path = template.slice("$input.".length).split(".");
  let cursor: unknown = input;
  for (const key of path) {
    if (cursor && typeof cursor === "object" && key in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[key];
    } else {
      return "";
    }
  }
  return typeof cursor === "string" ? cursor : "";
}

/** Inline `{{input.foo}}` templating used for human-readable strings. */
function renderTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{input\.([\w.]+)\}\}/g, (_, path: string) => {
    return resolvePlaceholder(`$input.${path}`, input);
  });
}
