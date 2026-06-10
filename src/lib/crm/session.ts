import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { SessionUser } from "@/types";

export async function getRequiredSession(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id || !session.user.modules?.includes("crm")) {
    redirect("/login");
  }
  return {
    id: session.user.crmProfileId || session.user.id,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
    actingAdminId: session.user.actingAsCrmProfileId,
    // audit v12 MEDIUM (MED-35): propagate super_admin platform role so
    // CRM scoping helpers can grant full access without a CrmRole match.
    isSuperAdmin: !!session.user.hrRoles?.includes("super_admin"),
  };
}

export async function getOptionalSession(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.modules?.includes("crm")) return null;
  return {
    id: session.user.crmProfileId || session.user.id,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole!,
    entityId: session.user.crmEntityId ?? null,
    actingAdminId: session.user.actingAsCrmProfileId,
    // audit v12 MEDIUM (MED-35): propagate super_admin platform role.
    isSuperAdmin: !!session.user.hrRoles?.includes("super_admin"),
  };
}
