import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getServerT } from "@/lib/i18n/server";
import { TaskList } from "@/components/tasks/TaskList";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { locale } = await getServerT();
  const isAr = locale === "ar";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? "مهامي" : "My Tasks"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr ? "كل المهام المسندة إليك عبر الموارد البشرية والـ CRM والشركاء." : "Everything assigned to you across HR, CRM, and Partners."}
        </p>
      </div>
      <TaskList scope="mine" showBuckets={true} />
    </div>
  );
}
