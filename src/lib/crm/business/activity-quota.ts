import { db } from "@/lib/db";

/**
 * Tier-2 #43 — activity quota gate.
 *
 * Audit v11 MEDIUM #10: documented in the schema (`CrmStageActivityQuota`)
 * but never enforced. Before allowing an opp to leave a stage, the opp
 * must have logged at least `minCount` of `activityType` in the last
 * `windowDays` while in that stage.
 *
 * Returns null when the move is allowed, or an error string listing
 * what's missing.
 */
export async function checkActivityQuota(
  opportunityId: string,
  fromStage: string,
): Promise<string | null> {
  const quotas = await db.crmStageActivityQuota.findMany({
    where: { stage: fromStage, active: true },
  });
  if (quotas.length === 0) return null;

  const missing: string[] = [];
  for (const q of quotas) {
    const since = new Date(Date.now() - q.windowDays * 24 * 60 * 60 * 1000);
    let count = 0;
    if (q.activityType === "call") {
      // audit v12 HIGH: exclude unproductive outcomes (NO_ANSWER, WRONG_NUMBER)
      // so reps cannot pad quota with stub calls that never connected.
      count = await db.crmCall.count({
        where: {
          opportunityId,
          callAt: { gte: since },
          outcome: {
            in: [
              "POSITIVE",
              "NEUTRAL",
              "NEGATIVE",
              "VOICEMAIL",
              "MEETING_BOOKED",
              "PROPOSAL_REQUEST",
              "WON",
              "LOST",
              "RESCHEDULE",
              "NOT_INTERESTED",
            ],
          },
        },
      });
    } else if (q.activityType === "meeting") {
      // audit v12 HIGH: only count past meetings in approved/completed states;
      // future or unreviewed/denied/cancelled meetings must not satisfy quota.
      count = await db.crmMeeting.count({
        where: {
          opportunityId,
          startAt: { gte: since, lte: new Date() },
          status: { in: ["APPROVED", "CONFIRMED", "DONE"] },
        },
      });
    } else if (q.activityType === "email") {
      // audit v12 HIGH: email quota was silently skipped (fail-open).
      // Count CrmEmailThread rows linked to this opportunity that had
      // activity within the quota window.
      count = await db.crmEmailThread.count({
        where: {
          opportunityIds: { has: opportunityId },
          lastMessageAt: { gte: since },
        },
      });
    } else {
      // Unknown activity type — fail open (don't block on a typo'd
      // admin config).
      continue;
    }
    if (count < q.minCount) {
      missing.push(
        `${q.minCount - count} more ${q.activityType}${q.minCount - count === 1 ? "" : "s"} required`,
      );
    }
  }
  if (missing.length === 0) return null;
  return `Can't leave ${fromStage} yet — ${missing.join(", ")}.`;
}
