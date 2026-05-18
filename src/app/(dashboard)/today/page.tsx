import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTodayData } from "@/lib/today/aggregator";
import { getServerT } from "@/lib/i18n/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Phone,
  TrendingUp,
  Inbox,
  PartyPopper,
  ListTodo,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getTodayData(session);
  const { t, locale } = await getServerT();

  const today = new Date();
  // Format the date in the active locale so Arabic users see Arabic months
  // and weekday names instead of the browser's default English.
  const formattedDate = today.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t.pages.today}</h1>
        <p className="text-sm text-muted-foreground mt-1">{formattedDate}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* My Tasks */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTodo className="h-4 w-4 text-primary" />
              {locale === "ar" ? "مهامي" : "My tasks"}
              {data.tasks.total > 0 && (
                <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded">
                  {data.tasks.total}
                </span>
              )}
            </CardTitle>
            <Link href="/tasks" className="text-xs text-muted-foreground hover:text-foreground">
              {locale === "ar" ? "عرض الكل →" : "View all →"}
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.tasks.items.length === 0 ? (
              <EmptyState
                size="sm"
                icon={CheckCircle2}
                title={locale === "ar" ? "صندوق وارد فارغ" : "Inbox zero"}
                description={locale === "ar" ? "لا توجد مهام بانتظارك الآن." : "No tasks waiting on you right now."}
              />
            ) : (
              <ul className="space-y-1">
                {data.tasks.items.map((row) => (
                  <li key={row.id}>
                    <Link
                      href="/tasks"
                      className="flex items-start gap-3 px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <span
                        className={`mt-1 inline-flex h-1.5 w-1.5 rounded-full shrink-0 ${
                          row.priority === "URGENT"
                            ? "bg-red-500"
                            : row.priority === "HIGH"
                            ? "bg-amber-500"
                            : "bg-primary"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{row.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.dueAt
                            ? row.isOverdue
                              ? `Overdue · ${new Date(row.dueAt).toLocaleDateString()}`
                              : `Due ${new Date(row.dueAt).toLocaleDateString()}`
                            : "No due date"}
                          {" · "}
                          <span className="uppercase">{row.module}</span>
                        </p>
                      </div>
                      {row.isOverdue && (
                        <span className="text-[10px] uppercase font-semibold text-red-600 dark:text-red-400 shrink-0 mt-1">
                          Overdue
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Approvals */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              {locale === "ar" ? "اعتمادات قيد الانتظار" : "Pending approvals"}
              {data.approvals.total > 0 && (
                <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded">
                  {data.approvals.total}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.approvals.items.length === 0 ? (
              <EmptyState
                size="sm"
                icon={CheckCircle2}
                title={locale === "ar" ? "أنجزتَ كل شيء" : "All caught up"}
                description={locale === "ar" ? "لا توجد طلبات بانتظارك الآن." : "No items waiting on you right now."}
              />
            ) : (
              <ul className="space-y-1">
                {data.approvals.items.map((row) => (
                  <li key={`${row.module}-${row.type}-${row.id}`}>
                    <Link
                      href={row.href}
                      className="flex items-start gap-3 px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <span className="mt-1 inline-flex h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{row.label}</p>
                        {row.sublabel && (
                          <p className="text-xs text-muted-foreground truncate">{row.sublabel}</p>
                        )}
                      </div>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 mt-1">
                        {row.module}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Calls today */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="h-4 w-4 text-primary" />
              {locale === "ar" ? "مكالمات اليوم" : "Today's calls"}
              {data.callsToday.total > 0 && (
                <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded">
                  {data.callsToday.total}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.callsToday.items.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Inbox}
                title={locale === "ar" ? "لا توجد مكالمات مجدولة" : "No calls scheduled"}
                description={locale === "ar" ? "ستظهر هنا المكالمات التي تسجلها اليوم." : "Calls you log today will appear here."}
              />
            ) : (
              <ul className="space-y-1">
                {data.callsToday.items.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={c.href}
                      className="flex items-center justify-between px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {c.company}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(c.callAt).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {c.outcome && ` · ${c.outcome}`}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Closing this week */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              {locale === "ar" ? "إغلاق هذا الأسبوع" : "Closing this week"}
              {data.closingThisWeek.total > 0 && (
                <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded">
                  {data.closingThisWeek.total}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.closingThisWeek.items.length === 0 ? (
              <EmptyState
                size="sm"
                icon={CalendarClock}
                title={locale === "ar" ? "لا توجد صفقات قريبة الإغلاق" : "No deals closing soon"}
                description={locale === "ar" ? "ستظهر هنا الفرص المتوقع إغلاقها خلال 7 أيام." : "Opportunities expected to close in the next 7 days will show up here."}
              />
            ) : (
              <ul className="space-y-1">
                {data.closingThisWeek.items.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={o.href}
                      className="flex items-center justify-between px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {o.company}
                        </p>
                        <p className="text-xs text-muted-foreground ltr-nums">
                          {o.code} · {new Date(o.expectedCloseDate).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-foreground shrink-0 ms-3">
                        {Math.round(o.weightedValueEGP / 1000).toLocaleString()}k
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Milestones */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PartyPopper className="h-4 w-4 text-primary" />
              {locale === "ar" ? "مناسبات قادمة" : "Upcoming milestones"}
              {data.milestones.total > 0 && (
                <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded">
                  {data.milestones.total}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.milestones.items.length === 0 ? (
              <EmptyState
                size="sm"
                icon={AlertCircle}
                title="No upcoming milestones"
                description="Probation endings and contract renewals coming up will appear here."
              />
            ) : (
              <ul className="space-y-1">
                {data.milestones.items.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={m.href}
                      className="flex items-center justify-between px-2 py-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {m.employeeName}
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {m.type.replace("_", " ")} · {new Date(m.date).toLocaleDateString()}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
