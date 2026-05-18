import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getServerT } from "@/lib/i18n/server";
import { NewUserForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin =
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId);
  if (!isAdmin) redirect("/");

  // Pre-load the reference data the form needs so it can render snappily.
  const [companies, departments, managers, crmEntities, hrRoles] = await Promise.all([
    db.hrCompany.findMany({
      where: { isActive: true, nameEn: { not: "" } },
      select: { id: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    db.hrDepartment.findMany({
      where: { isActive: true },
      select: { id: true, nameEn: true, companyId: true },
      orderBy: { nameEn: "asc" },
    }),
    db.hrEmployee.findMany({
      where: { status: { in: ["active", "probation"] } },
      select: { id: true, fullNameEn: true, positionEn: true, companyId: true },
      orderBy: { fullNameEn: "asc" },
      take: 500,
    }),
    db.crmEntity.findMany({
      where: { active: true },
      select: { id: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    db.hrRole.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  ]);

  const { locale } = await getServerT();
  const isAr = locale === "ar";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{isAr ? "مستخدم جديد" : "New user"}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAr
            ? "نموذج واحد لأي مستخدم — موظف، مندوب مبيعات (موظف + ملف CRM)، شريك، أو أدمن. شغّل الوحدات التي يشارك فيها واملأ الحقول التي تحتاجها فقط."
            : "One form for any user — employee, sales rep (employee + CRM profile), partner, or admin. Toggle the modules they participate in and fill in just the fields you need."}
        </p>
      </div>
      <NewUserForm
        companies={companies}
        departments={departments}
        managers={managers}
        crmEntities={crmEntities}
        hrRoles={hrRoles.map((r) => r.name).filter((n) => n !== "team_lead")}
      />
    </div>
  );
}
