import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMeetingTypeConfigs } from "../actions";
import { MeetingTypesClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MeetingTypesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin =
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin");
  if (!isAdmin) redirect("/crm/my");

  const types = await listMeetingTypeConfigs();
  return <MeetingTypesClient initial={types} />;
}
