import { redirect } from "next/navigation";

/**
 * HR Settings landing is now consolidated under /admin/settings.
 * Deep links to specific surfaces (e.g. /hr/settings/companies) still work;
 * only the landing redirects so the sidebar entries unify there.
 */
export default function HrSettingsPage() {
  redirect("/admin/settings");
}
