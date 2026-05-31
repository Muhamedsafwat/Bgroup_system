import { redirect } from "next/navigation";

/**
 * /partners — every signed-in partner user lands on their dashboard.
 * Without this page the route 404'd.
 */
export default function PartnersLanding() {
  redirect("/partners/dashboard");
}
