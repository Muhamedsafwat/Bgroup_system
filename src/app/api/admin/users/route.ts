import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CrmRole } from "@/generated/prisma";
import { uniqueViolationMessage } from "@/lib/prisma-errors";

function isPlatformAdmin(session: Session) {
  return (
    !!session.user.hrRoles?.includes("super_admin") ||
    (!!session.user.modules?.includes("partners") && !session.user.partnerId)
  );
}

/**
 * GET /api/admin/users — one row per User, with their profile attachments
 * across HR, CRM, and Partners modules. The admin sees who is what — an
 * employee, a sales rep, a partner — and decides who to action on.
 */
export async function GET() {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      hrAccess: true,
      crmAccess: true,
      partnersAccess: true,
      createdAt: true,
      hrEmployee: {
        select: {
          id: true,
          employeeId: true,
          fullNameEn: true,
          positionEn: true,
          status: true,
          baseSalary: true,
          currency: true,
          directManager: { select: { id: true, fullNameEn: true } },
          company: { select: { id: true, nameEn: true } },
        },
      },
      hrProfile: {
        select: {
          id: true,
          isSuperuser: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      },
      crmProfile: { select: { id: true, fullName: true, role: true } },
      partnerProfile: { select: { id: true, companyName: true, commissionRate: true, isActive: true } },
    },
  });

  // Shape: collapse roles into a flat string array.
  const shaped = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    createdAt: u.createdAt.toISOString(),
    modules: {
      hr: u.hrAccess,
      crm: u.crmAccess,
      partners: u.partnersAccess,
    },
    hr: u.hrEmployee
      ? {
          employee: u.hrEmployee,
          roles: u.hrProfile?.roles?.map((r) => r.role.name) ?? [],
          isSuperuser: u.hrProfile?.isSuperuser ?? false,
        }
      : null,
    crm: u.crmProfile,
    partner: u.partnerProfile,
  }));

  return NextResponse.json({ users: shaped });
}

/**
 * POST /api/admin/users — unified user creation.
 *
 * Body shape (all profile blocks are optional, in arbitrary combination):
 * {
 *   email, password, name,
 *   hr?: {
 *     employeeId, fullNameEn, fullNameAr, nationalId, gender,
 *     positionEn, level?, employmentType?, workModel?,
 *     companyId, departmentId?, directManagerId?,
 *     baseSalary?, currency?,
 *     roles?: string[]   // HR role names: super_admin, hr_manager, ceo, accountant, employee
 *   },
 *   crm?: {
 *     fullName, role: "REP"|"MANAGER"|"ASSISTANT"|"ACCOUNT_MGR"|"ADMIN",
 *     entityId?, monthlyTargetEGP?
 *   },
 *   partner?: {
 *     companyName, contactPhone?, commissionRate?
 *   }
 * }
 *
 * A "sales rep" is a user with BOTH `hr` and `crm` blocks — they are real
 * employees with a CRM profile. A "partner" is a user with `partner` only
 * (or `partner` + `crm`). The unified form means the admin creates one
 * record per person and chooses what modules they participate in.
 */

const hrSchema = z.object({
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
  // `team_lead` is intentionally omitted — that role is auto-derived from the
  // org chart at session time (anyone with subordinates is a team lead). An
  // admin assigning it explicitly here would be at best redundant.
  roles: z.array(z.string().refine((r) => r !== "team_lead", "team_lead is auto-derived from the org chart, not assigned manually")).max(10).optional(),
});

const crmSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  role: z.nativeEnum(CrmRole),
  entityId: z.string().min(1).optional(),
  monthlyTargetEGP: z.number().nonnegative().optional(),
});

const partnerSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
  contactPhone: z.string().trim().max(40).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
});

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(120),
  hr: hrSchema.optional(),
  crm: crmSchema.optional(),
  partner: partnerSchema.optional(),
});

export async function POST(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPlatformAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  // Verify referenced ids exist (HR company / department / manager / CRM entity)
  // before we open the transaction so we return a clean 400 instead of FK 500.
  if (data.hr) {
    const company = await db.hrCompany.findUnique({ where: { id: data.hr.companyId }, select: { id: true } });
    if (!company) return NextResponse.json({ error: "HR companyId not found" }, { status: 400 });
    if (data.hr.departmentId) {
      const dept = await db.hrDepartment.findUnique({ where: { id: data.hr.departmentId }, select: { companyId: true } });
      if (!dept || dept.companyId !== data.hr.companyId) {
        return NextResponse.json({ error: "Department does not belong to the selected company" }, { status: 400 });
      }
    }
    if (data.hr.directManagerId) {
      const mgr = await db.hrEmployee.findUnique({ where: { id: data.hr.directManagerId }, select: { id: true } });
      if (!mgr) return NextResponse.json({ error: "directManagerId not found" }, { status: 400 });
    }
  }
  if (data.crm?.entityId) {
    const ent = await db.crmEntity.findUnique({ where: { id: data.crm.entityId }, select: { id: true } });
    if (!ent) return NextResponse.json({ error: "CRM entityId not found" }, { status: 400 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const hashed = await bcrypt.hash(data.password, 12);
      const user = await tx.user.create({
        data: {
          email: data.email.toLowerCase(),
          name: data.name,
          password: hashed,
          hrAccess: !!data.hr,
          crmAccess: !!data.crm,
          partnersAccess: !!data.partner,
        },
      });

      // HR side: employee + hrProfile + roles
      if (data.hr) {
        const hrProfile = await tx.hrUserProfile.create({
          data: {
            userId: user.id,
            username: data.email.split("@")[0],
            firstName: data.hr.fullNameEn.split(" ")[0] ?? "",
            lastName: data.hr.fullNameEn.split(" ").slice(1).join(" "),
            isSuperuser: (data.hr.roles ?? []).includes("super_admin"),
            isStaff: true,
            isActive: true,
          },
        });

        await tx.hrEmployee.create({
          data: {
            userId: user.id,
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

        // Attach HR roles.
        for (const roleName of data.hr.roles ?? []) {
          const role = await tx.hrRole.upsert({
            where: { name: roleName },
            create: { name: roleName },
            update: {},
          });
          await tx.hrUserRole.upsert({
            where: { userId_roleId: { userId: user.id, roleId: role.id } },
            create: { userId: user.id, roleId: role.id },
            update: {},
          });
        }
      }

      // CRM profile (sales rep): the user is now searchable as a CRM owner.
      if (data.crm) {
        await tx.crmUserProfile.create({
          data: {
            userId: user.id,
            fullName: data.crm.fullName,
            role: data.crm.role,
            entityId: data.crm.entityId ?? null,
            monthlyTargetEGP: data.crm.monthlyTargetEGP ?? null,
            active: true,
          },
        });
      }

      // Partner profile.
      if (data.partner) {
        await tx.partnerProfile.create({
          data: {
            userId: user.id,
            companyName: data.partner.companyName,
            contactPhone: data.partner.contactPhone ?? null,
            commissionRate: data.partner.commissionRate ?? 10,
            isActive: true,
          },
        });
      }

      return user;
    });
    return NextResponse.json({ user: { id: result.id, email: result.email } }, { status: 201 });
  } catch (e) {
    const dup = uniqueViolationMessage(e, "value");
    if (dup) return NextResponse.json({ error: dup }, { status: 409 });
    console.error("[admin/users POST]", e);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
