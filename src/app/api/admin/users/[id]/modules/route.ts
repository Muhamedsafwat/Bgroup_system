import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmRole } from "@/generated/prisma";
import { uniqueViolationMessage } from "@/lib/prisma-errors";
import { describeZodError, describeError } from "@/lib/zod-errors";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

/**
 * POST /api/admin/users/[id]/modules
 *
 * Adds one or more modules (HR, CRM, Partners) to an EXISTING user. Used by
 * the admin when, say, a CRM rep gets a partner relationship too and needs
 * partner-portal access, or an HR employee starts a sales rotation and needs
 * a CRM profile.
 *
 * Idempotent per module: if the user already has the module, this endpoint
 * returns 409 with a clear message so the admin doesn't silently overwrite
 * an existing profile. Each block (hr / crm / partner) is the same shape as
 * the create endpoint — minus the user-level fields (email, password, name).
 *
 * Body shape:
 *   { hr?: {...}, crm?: {...}, partner?: {...} }
 *
 * At least one block must be present. Module-access flags on the User row
 * are flipped to true and the corresponding profile is created in one
 * transaction so partial-grant states aren't possible.
 */

const hrBlock = z.object({
  employeeId: z.string().trim().min(1).max(40),
  fullNameEn: z.string().trim().min(1).max(120),
  fullNameAr: z.string().trim().min(1).max(120),
  nationalId: z.string().trim().min(1).max(40),
  gender: z.enum(["male", "female"]),
  positionEn: z.string().trim().max(120).optional(),
  level: z.string().trim().max(40).optional(),
  employmentType: z.string().trim().max(40).optional(),
  workModel: z.string().trim().max(40).optional(),
  companyId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  directManagerId: z.string().min(1).optional().nullable(),
  baseSalary: z.number().nonnegative().max(10_000_000).optional(),
  currency: z.string().trim().max(8).optional(),
  roles: z
    .array(
      z
        .string()
        .refine(
          (r) => r !== "team_lead",
          "team_lead is auto-derived from the org chart, not assigned manually"
        )
    )
    .max(10)
    .optional(),
});

const crmBlock = z.object({
  fullName: z.string().trim().min(1).max(120),
  role: z.nativeEnum(CrmRole),
  entityId: z.string().min(1).optional(),
  monthlyTargetEGP: z.number().nonnegative().optional(),
  managerId: z.string().min(1).optional(),
});

const partnerBlock = z.object({
  companyName: z.string().trim().min(1).max(160),
  contactPhone: z.string().trim().max(40).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
});

const schema = z
  .object({
    hr: hrBlock.optional(),
    crm: crmBlock.optional(),
    partner: partnerBlock.optional(),
  })
  .refine((d) => d.hr || d.crm || d.partner, {
    message: "Provide at least one module block (hr, crm, or partner)",
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const { message, fieldErrors } = describeZodError(parsed.error);
    return NextResponse.json({ error: message, fieldErrors }, { status: 422 });
  }
  const data = parsed.data;

  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      hrAccess: true,
      crmAccess: true,
      partnersAccess: true,
      hrProfile: { select: { id: true } },
      crmProfile: { select: { id: true } },
      partnerProfile: { select: { id: true } },
    },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Block double-grant attempts so the admin gets a clear error instead of
  // a Prisma unique-constraint 500 later in the transaction.
  if (data.hr && target.hrProfile) {
    return NextResponse.json(
      { error: "User already has an HR profile" },
      { status: 409 }
    );
  }
  if (data.crm && target.crmProfile) {
    return NextResponse.json(
      { error: "User already has a CRM profile" },
      { status: 409 }
    );
  }
  if (data.partner && target.partnerProfile) {
    return NextResponse.json(
      { error: "User already has a Partner profile" },
      { status: 409 }
    );
  }

  // Same FK pre-checks as the create endpoint so we 400 cleanly instead of
  // crashing on a foreign-key violation 8 lines into the transaction.
  if (data.hr) {
    const company = await db.hrCompany.findUnique({
      where: { id: data.hr.companyId },
      select: { id: true },
    });
    if (!company)
      return NextResponse.json({ error: "HR companyId not found" }, { status: 400 });
    if (data.hr.departmentId) {
      const dept = await db.hrDepartment.findUnique({
        where: { id: data.hr.departmentId },
        select: { companyId: true },
      });
      if (!dept || dept.companyId !== data.hr.companyId) {
        return NextResponse.json(
          { error: "Department does not belong to the selected company" },
          { status: 400 }
        );
      }
    }
    if (data.hr.directManagerId) {
      const mgr = await db.hrEmployee.findUnique({
        where: { id: data.hr.directManagerId },
        select: { id: true },
      });
      if (!mgr)
        return NextResponse.json(
          { error: "directManagerId not found" },
          { status: 400 }
        );
    }
  }
  if (data.crm?.entityId) {
    const ent = await db.crmEntity.findUnique({
      where: { id: data.crm.entityId },
      select: { id: true },
    });
    if (!ent)
      return NextResponse.json({ error: "CRM entityId not found" }, { status: 400 });
  }
  if (data.crm?.managerId) {
    const mgr = await db.crmUserProfile.findUnique({
      where: { id: data.crm.managerId },
      select: { id: true, role: true },
    });
    if (!mgr)
      return NextResponse.json(
        { error: "CRM managerId not found" },
        { status: 400 }
      );
  }

  try {
    await db.$transaction(async (tx) => {
      // HR — flip the flag and create the employee + profile + roles.
      if (data.hr) {
        const hrProfile = await tx.hrUserProfile.create({
          data: {
            userId: target.id,
            username: target.email.split("@")[0],
            firstName: data.hr.fullNameEn.split(" ")[0] ?? "",
            lastName: data.hr.fullNameEn.split(" ").slice(1).join(" "),
            isSuperuser: (data.hr.roles ?? []).includes("super_admin"),
            isStaff: true,
            isActive: true,
          },
        });
        await tx.hrEmployee.create({
          data: {
            userId: target.id,
            hrUserProfileId: hrProfile.id,
            employeeId: data.hr.employeeId,
            fullNameEn: data.hr.fullNameEn,
            fullNameAr: data.hr.fullNameAr,
            nationalId: data.hr.nationalId,
            gender: data.hr.gender,
            positionEn: data.hr.positionEn ?? "",
            level: data.hr.level ?? "junior",
            employmentType: data.hr.employmentType ?? "full_time",
            workModel: data.hr.workModel ?? "onsite",
            companyId: data.hr.companyId,
            departmentId: data.hr.departmentId ?? null,
            directManagerId: data.hr.directManagerId ?? null,
            baseSalary: data.hr.baseSalary ?? 0,
            currency: data.hr.currency ?? "EGP",
            status: "active",
            contractStart: new Date(),
          },
        });
        for (const roleName of data.hr.roles ?? []) {
          const role = await tx.hrRole.upsert({
            where: { name: roleName },
            create: { name: roleName },
            update: {},
          });
          await tx.hrUserRole.upsert({
            where: { userId_roleId: { userId: target.id, roleId: role.id } },
            create: { userId: target.id, roleId: role.id },
            update: {},
          });
        }
        await tx.user.update({
          where: { id: target.id },
          data: { hrAccess: true },
        });
      }

      if (data.crm) {
        await tx.crmUserProfile.create({
          data: {
            userId: target.id,
            fullName: data.crm.fullName,
            role: data.crm.role,
            entityId: data.crm.entityId ?? null,
            monthlyTargetEGP: data.crm.monthlyTargetEGP ?? null,
            managerId: data.crm.managerId ?? null,
            active: true,
          },
        });
        await tx.user.update({
          where: { id: target.id },
          data: { crmAccess: true },
        });
      }

      if (data.partner) {
        await tx.partnerProfile.create({
          data: {
            userId: target.id,
            companyName: data.partner.companyName,
            contactPhone: data.partner.contactPhone ?? null,
            commissionRate: data.partner.commissionRate ?? 10,
            isActive: true,
          },
        });
        await tx.user.update({
          where: { id: target.id },
          data: { partnersAccess: true },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const dup = uniqueViolationMessage(e, "value");
    if (dup) return NextResponse.json({ error: dup }, { status: 409 });
    console.error("[admin/users/[id]/modules POST]", e);
    return NextResponse.json(
      { error: `Couldn't grant module: ${describeError(e)}` },
      { status: 500 }
    );
  }
}
