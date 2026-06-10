import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmRole } from "@/generated/prisma";
import { describeZodError, describeError } from "@/lib/zod-errors";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

/**
 * PATCH /api/admin/users/[id]
 *
 * Edits user details across whichever modules they already have. Each block
 * is partial — provide only the fields you want to change. The route exists
 * because /admin/users used to expose only "Reset password" and "Add module"
 * actions; admins had no in-page way to fix a typo'd name, change a CRM role,
 * adjust a monthly target, swap a rep's manager, or set a manager's team.
 *
 * Body shape:
 *   {
 *     name?: string,            // user.name (display name)
 *     hr?: { positionEn?, level?, baseSalary?, currency?, directManagerId?, departmentId? },
 *     crm?: { fullName?, role?, entityId?, monthlyTargetEGP?, managerId?, active?, teamMemberIds? },
 *     partner?: { companyName?, contactPhone?, commissionRate?, isActive? },
 *   }
 *
 * `crm.teamMemberIds` is the manager's direct reports — when present, the
 * route syncs `CrmTeamMembership` join rows so this manager has exactly the
 * listed reps on their team. A rep can be on multiple managers' teams, so
 * this only touches memberships owned by THIS manager — other managers'
 * memberships for the same rep are preserved. Only meaningful when the
 * target user is a MANAGER/ADMIN.
 */
const hrBlock = z
  .object({
    positionEn: z.string().trim().max(120).optional().nullable(),
    level: z.string().trim().max(40).optional().nullable(),
    employmentType: z.string().trim().max(40).optional().nullable(),
    workModel: z.string().trim().max(40).optional().nullable(),
    baseSalary: z.number().nonnegative().max(10_000_000).optional(),
    currency: z.string().trim().max(8).optional(),
    directManagerId: z.string().min(1).optional().nullable(),
    departmentId: z.string().min(1).optional().nullable(),
  })
  .strict();

const crmBlock = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    role: z.nativeEnum(CrmRole).optional(),
    entityId: z.string().min(1).optional().nullable(),
    monthlyTargetEGP: z.number().nonnegative().optional().nullable(),
    managerId: z.string().min(1).optional().nullable(),
    active: z.boolean().optional(),
    teamMemberIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const partnerBlock = z
  .object({
    companyName: z.string().trim().min(1).max(160).optional(),
    contactPhone: z.string().trim().max(40).optional().nullable(),
    commissionRate: z.number().min(0).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const schema = z
  .object({
    name: z.string().trim().max(160).optional().nullable(),
    hr: hrBlock.optional(),
    crm: crmBlock.optional(),
    partner: partnerBlock.optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.hr || d.crm || d.partner,
    "Provide at least one field to update"
  );

export async function PATCH(
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
      hrProfile: { select: { id: true } },
      crmProfile: { select: { id: true, role: true } },
      partnerProfile: { select: { id: true } },
    },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (data.hr && !target.hrProfile) {
    return NextResponse.json(
      { error: "User has no HR profile to edit. Use 'Add module' first." },
      { status: 400 }
    );
  }
  if (data.crm && !target.crmProfile) {
    return NextResponse.json(
      { error: "User has no CRM profile to edit. Use 'Add module' first." },
      { status: 400 }
    );
  }
  if (data.partner && !target.partnerProfile) {
    return NextResponse.json(
      { error: "User has no Partner profile to edit. Use 'Add module' first." },
      { status: 400 }
    );
  }

  // Pre-check FKs the same way /modules does — turns FK violations into 400s.
  if (data.hr?.directManagerId) {
    const mgr = await db.hrEmployee.findUnique({
      where: { id: data.hr.directManagerId },
      select: { id: true },
    });
    if (!mgr) {
      return NextResponse.json({ error: "directManagerId not found" }, { status: 400 });
    }
  }
  if (data.hr?.departmentId) {
    const dept = await db.hrDepartment.findUnique({
      where: { id: data.hr.departmentId },
      select: { id: true },
    });
    if (!dept) {
      return NextResponse.json({ error: "departmentId not found" }, { status: 400 });
    }
  }
  if (data.crm?.entityId) {
    const ent = await db.crmEntity.findUnique({
      where: { id: data.crm.entityId },
      select: { id: true },
    });
    if (!ent) {
      return NextResponse.json({ error: "CRM entityId not found" }, { status: 400 });
    }
  }
  if (data.crm?.managerId) {
    const mgr = await db.crmUserProfile.findUnique({
      where: { id: data.crm.managerId },
      select: { id: true },
    });
    if (!mgr) {
      return NextResponse.json({ error: "CRM managerId not found" }, { status: 400 });
    }
  }

  try {
    await db.$transaction(async (tx) => {
      if (data.name !== undefined) {
        await tx.user.update({
          where: { id: target.id },
          data: { name: data.name?.trim() || null },
        });
      }

      if (data.hr && target.hrProfile) {
        const hr = data.hr;
        await tx.hrEmployee.update({
          where: { userId: target.id },
          data: {
            ...(hr.positionEn !== undefined ? { positionEn: hr.positionEn ?? "" } : {}),
            ...(hr.level !== undefined ? { level: hr.level ?? "junior" } : {}),
            ...(hr.employmentType !== undefined
              ? { employmentType: hr.employmentType ?? "full_time" }
              : {}),
            ...(hr.workModel !== undefined ? { workModel: hr.workModel ?? "onsite" } : {}),
            ...(hr.baseSalary !== undefined ? { baseSalary: hr.baseSalary } : {}),
            ...(hr.currency !== undefined ? { currency: hr.currency } : {}),
            ...(hr.directManagerId !== undefined
              ? { directManagerId: hr.directManagerId }
              : {}),
            ...(hr.departmentId !== undefined ? { departmentId: hr.departmentId } : {}),
          },
        });
      }

      if (data.crm && target.crmProfile) {
        const crm = data.crm;
        const profileId = target.crmProfile.id;
        await tx.crmUserProfile.update({
          where: { id: profileId },
          data: {
            ...(crm.fullName !== undefined ? { fullName: crm.fullName } : {}),
            ...(crm.role !== undefined ? { role: crm.role } : {}),
            ...(crm.entityId !== undefined ? { entityId: crm.entityId } : {}),
            ...(crm.monthlyTargetEGP !== undefined
              ? { monthlyTargetEGP: crm.monthlyTargetEGP }
              : {}),
            ...(crm.managerId !== undefined ? { managerId: crm.managerId } : {}),
            ...(crm.active !== undefined ? { active: crm.active } : {}),
          },
        });

        if (crm.teamMemberIds) {
          // Sync the many-to-many CrmTeamMembership rows for THIS manager
          // only. A rep can belong to multiple managers' teams, so we must
          // not touch memberships owned by other managers. Delete the
          // memberships for this manager that aren't in the new set, then
          // upsert the new ones. The legacy single-FK `managerId` is left
          // alone here — scope helpers OR both relations, so the M2M side
          // is authoritative for "is this rep on my team".
          await tx.crmTeamMembership.deleteMany({
            where: {
              managerId: profileId,
              repId: { notIn: crm.teamMemberIds.length ? crm.teamMemberIds : ["__none__"] },
            },
          });
          for (const repId of crm.teamMemberIds) {
            await tx.crmTeamMembership.upsert({
              where: { managerId_repId: { managerId: profileId, repId } },
              create: { managerId: profileId, repId },
              update: {},
            });
          }
        }
      }

      if (data.partner && target.partnerProfile) {
        const partner = data.partner;
        await tx.partnerProfile.update({
          where: { id: target.partnerProfile.id },
          data: {
            ...(partner.companyName !== undefined ? { companyName: partner.companyName } : {}),
            ...(partner.contactPhone !== undefined
              ? { contactPhone: partner.contactPhone }
              : {}),
            ...(partner.commissionRate !== undefined
              ? { commissionRate: partner.commissionRate }
              : {}),
            ...(partner.isActive !== undefined ? { isActive: partner.isActive } : {}),
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[admin/users/[id] PATCH]", e);
    return NextResponse.json(
      { error: `Couldn't update user: ${describeError(e)}` },
      { status: 500 }
    );
  }
}
