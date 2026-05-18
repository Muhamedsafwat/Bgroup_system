import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getServerT } from "@/lib/i18n/server";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";

export const dynamic = "force-dynamic";

export default async function TasksCalendarPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { locale } = await getServerT();
  const isAr = locale === "ar";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? 'تقويم المهام' : 'Tasks calendar'}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr ? 'عرض شهري للمهام حسب تاريخ الاستحقاق — اضغط على يوم لاستكشافه، أو على مهمة لتعديلها.' : 'Month view of tasks by due date — click a day to drill in, click a task to edit.'}
        </p>
      </div>
      <TaskCalendar />
    </div>
  );
}
