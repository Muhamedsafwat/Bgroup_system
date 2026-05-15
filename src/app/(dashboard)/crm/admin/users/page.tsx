import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getUsers, getEntitiesAdmin } from "../actions";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const [session, { t, locale }] = await Promise.all([
    getRequiredSession(),
    getServerT(),
  ]);

  if (session.role !== "ADMIN") {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }

  const [users, entities] = await Promise.all([
    getUsers(),
    getEntitiesAdmin(),
  ]);

  return <UsersClient users={users} entities={entities} />;
}
