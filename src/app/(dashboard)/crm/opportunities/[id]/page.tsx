import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOpportunity } from "../actions";
import { OpportunityDetailClient } from "@/components/crm/opportunities/OpportunityDetailClient";

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { locale } = await getServerT();
  const [session, opp] = await Promise.all([auth(), getOpportunity(id)]);

  if (!opp) notFound();

  // Sales managers (and CEO) see the "Start workflow" CTA. Pre-fetch the
  // active workflow list so the picker dialog opens instantly when clicked.
  const crmRole = session?.user?.crmRole ?? null;
  const canStartWorkflow = crmRole === "MANAGER" || crmRole === "ADMIN";
  const workflows = canStartWorkflow
    ? await db.sequentialWorkflow.findMany({
        where: { isActive: true, consumedAt: null },
        select: { id: true, name: true, description: true, module: true, kind: true },
        orderBy: { name: "asc" },
        take: 50,
      })
    : [];

  // user-feature 2026-06-19: the document delete control is uploader-only.
  // Pass the same identity the upload path stamps (crmProfileId, falling
  // back to the auth user id) so the client can show delete only on the
  // current user's own uploads.
  const currentUserId = session?.user?.crmProfileId ?? session?.user?.id ?? "";

  return (
    <OpportunityDetailClient
      opportunity={JSON.parse(JSON.stringify(opp))}
      locale={locale}
      canStartWorkflow={canStartWorkflow}
      workflows={JSON.parse(JSON.stringify(workflows))}
      currentUserId={currentUserId}
    />
  );
}
