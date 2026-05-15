/**
 * Pure utilities used by both the WelcomeHero client component AND its
 * server-rendered callers (the root page, module home pages). Keeping these
 * outside the "use client" boundary lets server components import them
 * without Turbopack's "client function from server" guard rejecting it.
 */

export type Tone = "rose" | "sky" | "emerald" | "amber" | "violet" | "indigo";

export function timeOfDay(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export function firstNameOf(name?: string | null, email?: string | null): string {
  if (name && name.trim().length > 0) return name.trim().split(/\s+/)[0];
  if (email) return email.split("@")[0];
  return "there";
}
