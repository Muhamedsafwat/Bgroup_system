import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ChangePasswordClient } from "./client";

/**
 * Force-change-password page. Reachable any time, but the proxy redirects
 * every navigation to this URL while `session.user.mustChangePassword` is
 * true. Successful change clears the flag (in the API endpoint) and the user
 * is bounced back to wherever they were trying to go.
 */
export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { next } = await searchParams;

  return (
    <div className="max-w-md mx-auto py-12">
      <ChangePasswordClient
        forced={!!session.user.mustChangePassword}
        email={session.user.email}
        nextHref={typeof next === "string" && next.startsWith("/") ? next : "/"}
      />
    </div>
  );
}
