import { redirect } from "next/navigation";

/**
 * `/hr/employee` itself isn't a real page — it's a folder grouping the
 * employee self-service routes (home, attendance, tasks, salary, etc.).
 * The sidebar / quick-action tiles already point at `/hr/employee/home` and
 * friends, but direct URL hits land here. Send them straight to the home
 * dashboard so they don't bounce into a 404.
 */
export default function HrEmployeeIndex() {
  redirect("/hr/employee/home");
}
