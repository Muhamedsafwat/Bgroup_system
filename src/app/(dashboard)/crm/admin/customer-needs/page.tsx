import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listCustomerNeeds } from "../actions";
import { CustomerNeedsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function CustomerNeedsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin =
    session.user.crmRole === "ADMIN" ||
    !!session.user.hrRoles?.includes("super_admin");
  if (!isAdmin) redirect("/crm/my");

  const needs = await listCustomerNeeds();
  return <CustomerNeedsClient initial={needs} />;
}
