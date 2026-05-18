import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getServerT } from "@/lib/i18n/server";
import { TeamCalendar } from "@/components/hr/calendar/TeamCalendar";

export const dynamic = "force-dynamic";

export default async function TimeOffCalendarPage() {
  const session = await auth();
  if (!session?.user || !session.user.modules?.includes("hr")) {
    redirect("/");
  }
  const { locale } = await getServerT();
  const isAr = locale === "ar";
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? "تقويم الإجازات" : "Time-off calendar"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr ? "من في إجازة ومتى، مع كشف التعارضات لكل قسم." : "Who's out and when, with conflict detection per department."}
        </p>
      </div>
      <TeamCalendar />
    </div>
  );
}
