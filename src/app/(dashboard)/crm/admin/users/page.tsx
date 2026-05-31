import { getRequiredSession } from "@/lib/crm/session";
import { getServerT } from "@/lib/i18n/server";
import { getUsers, getEntitiesAdmin } from "../actions";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const [session, { t, locale }] = await Promise.all([
    getRequiredSession(),
    getServerT(),
  ]);

  // MANAGER is "ADMIN minus settings" and runs the sales floor — they
  // create/edit reps and assign teams here, so the gate must include
  // them. The proxy already allows MANAGER for `/crm/admin/users` (but
  // NOT for the settings-table siblings); this server check just
  // mirrors that policy at the page boundary.
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    return <div className="p-6 text-destructive">Unauthorized</div>;
  }

  const [users, entities] = await Promise.all([
    getUsers(),
    getEntitiesAdmin(),
  ]);

  return <UsersClient users={users} entities={entities} />;
}
