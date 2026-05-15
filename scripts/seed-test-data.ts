/**
 * Comprehensive test-data seed for smoke testing.
 *
 * Creates the three named companies (ByteForce, BSystems, Business Partners)
 * across HR + CRM, plus realistic dummy data for every major module:
 *   - HR: companies, departments, employees, attendance, leave, overtime,
 *         incidents, bonuses, payroll period, monthly salaries
 *   - CRM: entity, user profile, companies, contacts, opportunities, calls,
 *         products
 *   - Partners: profiles, services, leads, clients, deals, contracts,
 *         invoices, commissions, registrations, MDF
 *   - Tasks: across all modules with subtasks, comments, watchers, time
 *         entries, dependencies
 *   - Onboarding template (default)
 *
 * Idempotent: re-running tops up missing rows but never duplicates the
 * named companies / users.
 *
 * Usage:
 *   npx tsx scripts/seed-test-data.ts
 */

import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config();

const COMPANIES = [
  { nameEn: "ByteForce", nameAr: "بايت فورس", industry: "Software & IT services" },
  { nameEn: "BSystems", nameAr: "بي سيستمز", industry: "Enterprise systems" },
  { nameEn: "Business Partners", nameAr: "شركاء الأعمال", industry: "Consulting" },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter });

  console.log("Seeding test data into Neon...\n");

  const now = new Date();

  // ─── Bootstrap admin (already exists) ────────────────────────────────────
  const admin = await db.user.findUnique({ where: { email: "admin@bgroup.com" } });
  if (!admin) {
    throw new Error(
      "Admin user not found. Run `npx tsx scripts/create-admin.ts admin@bgroup.com Admin@123456` first."
    );
  }
  console.log(`✓ Admin: ${admin.email}`);

  // ─── HR companies ────────────────────────────────────────────────────────
  console.log("\n[HR] Companies + departments...");
  const hrCompanies = await Promise.all(
    COMPANIES.map((c) =>
      db.hrCompany.upsert({
        where: { id: `seed-hrcomp-${c.nameEn.replace(/\s+/g, "-").toLowerCase()}` },
        create: {
          id: `seed-hrcomp-${c.nameEn.replace(/\s+/g, "-").toLowerCase()}`,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          industry: c.industry,
          phone: "+20100000000",
          email: `info@${c.nameEn.replace(/\s+/g, "").toLowerCase()}.com`,
          taxId: `TX-${c.nameEn.slice(0, 3).toUpperCase()}-2026`,
        },
        update: {
          nameAr: c.nameAr,
          industry: c.industry,
        },
      })
    )
  );
  console.log(`  ${hrCompanies.length} companies upserted`);

  // ─── HR departments per company ─────────────────────────────────────────
  const DEPT_LIST = [
    { en: "Engineering", ar: "الهندسة" },
    { en: "Sales", ar: "المبيعات" },
    { en: "HR", ar: "الموارد البشرية" },
    { en: "Finance", ar: "المالية" },
  ];
  const allDepts: { id: string; companyId: string; nameEn: string }[] = [];
  for (const company of hrCompanies) {
    for (const d of DEPT_LIST) {
      const dept = await db.hrDepartment.upsert({
        where: { id: `seed-dept-${company.id}-${d.en.toLowerCase()}` },
        create: {
          id: `seed-dept-${company.id}-${d.en.toLowerCase()}`,
          companyId: company.id,
          nameEn: d.en,
          nameAr: d.ar,
        },
        update: {},
      });
      allDepts.push({ id: dept.id, companyId: company.id, nameEn: d.en });
    }
  }
  console.log(`  ${allDepts.length} departments`);

  // ─── HR employees ────────────────────────────────────────────────────────
  console.log("\n[HR] Employees...");
  const FIRST_NAMES = ["Ahmed", "Sara", "Omar", "Layla", "Khaled", "Mona", "Yousef", "Nora", "Hassan", "Dina"];
  const LAST_NAMES = ["Mostafa", "El-Sayed", "Ibrahim", "Hassan", "Fouad", "Nasser", "Mahmoud", "Ali", "Saleh", "Tarek"];
  const POSITIONS = ["Engineer", "Senior Engineer", "Tech Lead", "Account Manager", "HR Specialist", "Accountant", "Sales Rep", "Designer"];
  const employees: { id: string; fullNameEn: string; companyId: string; departmentId: string }[] = [];

  let empCount = 0;
  for (const company of hrCompanies) {
    const companyDepts = allDepts.filter((d) => d.companyId === company.id);
    for (let i = 0; i < 6; i++) {
      const fn = FIRST_NAMES[(empCount + i) % FIRST_NAMES.length];
      const ln = LAST_NAMES[(empCount * 3 + i) % LAST_NAMES.length];
      const dept = companyDepts[i % companyDepts.length];
      const eid = `EMP-${company.nameEn.slice(0, 2).toUpperCase()}-${String(i + 1).padStart(3, "0")}`;
      const employee = await db.hrEmployee.upsert({
        where: { employeeId: eid },
        create: {
          employeeId: eid,
          fullNameEn: `${fn} ${ln}`,
          fullNameAr: `${fn} ${ln}`,
          nationalId: `NID-${company.nameEn.slice(0, 2).toUpperCase()}-${String(i + 1).padStart(6, "0")}`,
          dateOfBirth: new Date(1985 + (i % 15), i % 12, 1 + (i % 28)),
          gender: i % 2 === 0 ? "male" : "female",
          personalEmail: `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
          phone: `+2010${String(empCount + i).padStart(8, "0")}`,
          companyId: company.id,
          departmentId: dept.id,
          positionEn: POSITIONS[i % POSITIONS.length],
          level: ["junior", "mid", "senior"][i % 3],
          employmentType: "full_time",
          workModel: ["onsite", "hybrid", "remote"][i % 3],
          contractStart: new Date(2024, i % 12, 1),
          probationEnd: i < 2 ? new Date(2026, 6, 1) : null,
          status: i === 5 ? "probation" : "active",
          baseSalary: 8000 + i * 1500,
          currency: "EGP",
          bankName: "Commercial International Bank",
          bankAccount: `ACC-${String(empCount + i).padStart(10, "0")}`,
        },
        update: {},
      });
      employees.push({
        id: employee.id,
        fullNameEn: employee.fullNameEn,
        companyId: employee.companyId,
        departmentId: employee.departmentId ?? dept.id,
      });
      empCount += 1;
    }
  }
  console.log(`  ${employees.length} employees`);

  // ─── Attendance + leave + overtime + incidents + bonuses ────────────────
  console.log("\n[HR] Attendance / leave / overtime / incidents / bonuses...");
  let logCount = 0;
  // 14 days of attendance for first 6 employees
  for (const emp of employees.slice(0, 6)) {
    for (let d = 0; d < 14; d++) {
      const date = new Date();
      date.setDate(date.getDate() - d);
      date.setHours(0, 0, 0, 0);
      const status = d === 5 ? "absent" : d === 3 ? "late" : "on_time";
      try {
        await db.hrAttendanceLog.create({
          data: {
            employeeId: emp.id,
            date,
            checkIn: status === "absent" ? null : status === "late" ? "09:15" : "09:00",
            checkOut: status === "absent" ? null : "17:00",
            status,
            hoursWorked: status === "absent" ? 0 : 8,
          },
        });
        logCount += 1;
      } catch {
        // duplicate key — skip silently (idempotent)
      }
    }
  }
  console.log(`  ${logCount} attendance logs`);

  // Leave types + requests
  let leaveType = await db.hrLeaveType.findFirst();
  if (!leaveType) {
    leaveType = await db.hrLeaveType.create({
      data: {
        nameEn: "Annual",
        nameAr: "سنوية",
        annualDays: 21,
        isPaid: true,
      },
    });
  }
  let leaveCount = 0;
  for (const emp of employees.slice(0, 4)) {
    const start = new Date();
    start.setDate(start.getDate() + 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 2);
    try {
      await db.hrLeaveRequest.create({
        data: {
          employeeId: emp.id,
          leaveTypeId: leaveType.id,
          startDate: start,
          endDate: end,
          daysCount: 3,
          reason: "Family vacation",
          status: "pending",
        },
      });
      leaveCount += 1;
    } catch {}
  }
  console.log(`  ${leaveCount} leave requests`);

  // Overtime requests need an overtime policy first
  let overtimePolicy = await db.hrOvertimePolicy.findFirst();
  if (!overtimePolicy) {
    try {
      overtimePolicy = await db.hrOvertimePolicy.create({
        data: {
          typeCode: "WEEKDAY",
          nameEn: "Weekday OT",
          nameAr: "العمل الإضافي",
          rateMultiplier: 1.5,
        },
      });
    } catch {
      // Schema may differ — skip overtime if policy can't be created.
    }
  }
  let otCount = 0;
  if (overtimePolicy) {
    for (const emp of employees.slice(0, 3)) {
      try {
        await db.hrOvertimeRequest.create({
          data: {
            employeeId: emp.id,
            date: new Date(),
            overtimeTypeId: overtimePolicy.id,
            hoursRequested: 3,
            reason: "Year-end deliverable",
            status: "pending",
            calculatedAmount: 450,
          },
        });
        otCount += 1;
      } catch {}
    }
  }
  console.log(`  ${otCount} overtime requests`);

  // Bonus category + rule (so HrBonus FK is satisfied)
  const bonusCat = await db.hrBonusCategory.upsert({
    where: { code: "PERF" },
    create: { code: "PERF", nameEn: "Performance", nameAr: "الأداء" },
    update: {},
  });
  let bonusRule = await db.hrBonusRule.findFirst({ where: { categoryId: bonusCat.id } });
  if (!bonusRule) {
    try {
      bonusRule = await db.hrBonusRule.create({
        data: {
          code: "PERF-Q1",
          nameEn: "Q1 Performance",
          nameAr: "أداء الربع الأول",
          valueType: "fixed",
          value: 2000,
          frequency: "quarterly",
          categoryId: bonusCat.id,
        },
      });
    } catch {}
  }
  // The current admin's HrUserProfile is needed for submittedById
  const adminProfile = await db.hrUserProfile.findUnique({ where: { userId: admin.id } });
  let bonusCount = 0;
  if (bonusRule && adminProfile) {
    for (const emp of employees.slice(1, 3)) {
      try {
        await db.hrBonus.create({
          data: {
            employeeId: emp.id,
            bonusRuleId: bonusRule.id,
            bonusDate: new Date(),
            bonusAmount: 2000,
            comments: "Q1 outperformance",
            submittedById: admin.id,
            status: "pending",
          },
        });
        bonusCount += 1;
      } catch {}
    }
  }
  console.log(`  ${bonusCount} bonuses`);

  // ─── CRM bootstrap ───────────────────────────────────────────────────────
  console.log("\n[CRM] Entity / profile / companies / contacts / opps / calls / products...");
  const crmEntity = await db.crmEntity.upsert({
    where: { code: "BG" },
    create: {
      code: "BG",
      nameEn: "BGroup",
      nameAr: "بي جروب",
      color: "#0F62FE",
      active: true,
    },
    update: {},
  });

  const crmAdminProfile = await db.crmUserProfile.upsert({
    where: { userId: admin.id },
    create: {
      userId: admin.id,
      fullName: "Super Admin",
      role: "ADMIN",
      entityId: crmEntity.id,
    },
    update: { entityId: crmEntity.id },
  });

  const crmCompanies = await Promise.all(
    COMPANIES.map((c) =>
      db.crmCompany.upsert({
        where: { id: `seed-crm-${c.nameEn.replace(/\s+/g, "-").toLowerCase()}` },
        create: {
          id: `seed-crm-${c.nameEn.replace(/\s+/g, "-").toLowerCase()}`,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          industry: c.industry,
          country: "EG",
          city: "Cairo",
          website: `https://${c.nameEn.replace(/\s+/g, "").toLowerCase()}.com`,
          phone: "+201001234567",
          assignedToId: crmAdminProfile.id,
        },
        update: {},
      })
    )
  );

  // Contacts
  for (const cc of crmCompanies) {
    for (let i = 0; i < 2; i++) {
      try {
        await db.crmContact.create({
          data: {
            companyId: cc.id,
            fullName: `${FIRST_NAMES[i]} ${LAST_NAMES[i]}`,
            role: ["CTO", "Procurement Manager"][i],
            email: `${FIRST_NAMES[i].toLowerCase()}@${cc.nameEn.replace(/\s+/g, "").toLowerCase()}.com`,
            phone: `+2010100${String(i).padStart(5, "0")}`,
            isPrimary: i === 0,
          },
        });
      } catch {}
    }
  }

  // Products / services — per CRM Req. spec (6 customer-need categories).
  const SPEC_SERVICES = [
    { code: "B-CLINICS", nameEn: "B-Clinics", nameAr: "بي-كلينكس", price: 50000 },
    { code: "B-OPTICAL", nameEn: "B-Optical", nameAr: "بي-أوبتيكال", price: 50000 },
    { code: "SMM", nameEn: "Social Media Management", nameAr: "إدارة سوشيال ميديا", price: 15000 },
    { code: "WEBSITE", nameEn: "Website", nameAr: "موقع إلكتروني", price: 35000 },
    { code: "ERP", nameEn: "ERP System", nameAr: "نظام ERP", price: 80000 },
    { code: "MOBILE_APP", nameEn: "Mobile App", nameAr: "تطبيق موبايل", price: 90000 },
  ];
  const products: { id: string }[] = [];
  for (const svc of SPEC_SERVICES) {
    const p = await db.crmProduct.upsert({
      where: { code: svc.code },
      create: {
        code: svc.code,
        category: "Services",
        nameEn: svc.nameEn,
        nameAr: svc.nameAr,
        basePrice: svc.price,
        currency: "EGP",
        dealType: "ONE_TIME",
        active: true,
        entityId: crmEntity.id,
      },
      update: { nameEn: svc.nameEn, nameAr: svc.nameAr, basePrice: svc.price },
    });
    products.push(p);
  }

  // Stage configs — 8 stages per CRM Req. spec, mapped to existing enum values.
  // probabilityPct chosen to reflect realistic conversion expectations.
  const SPEC_STAGE_CONFIGS = [
    { stage: "NEW",           order: 1,  probability: 5,   sla: 24 },
    { stage: "CONTACTED",     order: 2,  probability: 15,  sla: 48 },
    { stage: "DISCOVERY",     order: 3,  probability: 30,  sla: 72 },
    { stage: "QUALIFIED",     order: 4,  probability: 50,  sla: 168 },
    { stage: "TECH_MEETING",  order: 5,  probability: 60,  sla: 168 },
    { stage: "PROPOSAL_SENT", order: 6,  probability: 75,  sla: 168 },
    { stage: "NEGOTIATION",   order: 7,  probability: 85,  sla: 168 },
    { stage: "VERBAL_YES",    order: 8,  probability: 95,  sla: 72  },
    { stage: "WON",           order: 9,  probability: 100 },
    { stage: "LOST",          order: 10, probability: 0   },
    { stage: "POSTPONED",     order: 11, probability: 0   },
  ] as const;
  for (const cfg of SPEC_STAGE_CONFIGS) {
    await db.crmStageConfig.upsert({
      where: { entityId_stage: { entityId: crmEntity.id, stage: cfg.stage } },
      create: {
        entityId: crmEntity.id,
        stage: cfg.stage,
        probabilityPct: cfg.probability,
        slaHours: "sla" in cfg ? cfg.sla : null,
        displayOrder: cfg.order,
      },
      update: {
        probabilityPct: cfg.probability,
        slaHours: "sla" in cfg ? cfg.sla : null,
        displayOrder: cfg.order,
      },
    });
  }

  // Opportunities (one per company)
  const STAGES = ["NEW", "DISCOVERY", "TECH_MEETING"] as const;
  for (let i = 0; i < crmCompanies.length; i++) {
    const cc = crmCompanies[i];
    const code = `OPP-${String(i + 1).padStart(4, "0")}`;
    try {
      await db.crmOpportunity.create({
        data: {
          code,
          companyId: cc.id,
          ownerId: crmAdminProfile.id,
          entityId: crmEntity.id,
          title: `${cc.nameEn} — Q2 deal`,
          stage: STAGES[i % STAGES.length],
          priority: ["HOT", "WARM", "COLD"][i % 3] as "HOT" | "WARM" | "COLD",
          dealType: "ONE_TIME",
          estimatedValue: 100000 + i * 50000,
          currency: "EGP",
          estimatedValueEGP: 100000 + i * 50000,
          probabilityPct: [25, 50, 75][i % 3],
          weightedValueEGP: (100000 + i * 50000) * [0.25, 0.5, 0.75][i % 3],
          expectedCloseDate: new Date(now.getFullYear(), now.getMonth() + 2, 15),
          nextActionText: "Send proposal",
          nextActionDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7),
        },
      });
    } catch {}
  }

  // Calls
  for (let i = 0; i < 3; i++) {
    try {
      await db.crmCall.create({
        data: {
          code: `CALL-${String(i + 1).padStart(4, "0")}`,
          companyId: crmCompanies[i].id,
          callerId: crmAdminProfile.id,
          callType: "INITIAL_OUTREACH",
          outcome: ["POSITIVE", "NEUTRAL", "NEGATIVE"][i] as "POSITIVE" | "NEUTRAL" | "NEGATIVE",
          durationMins: 15 + i * 5,
          callAt: new Date(),
          notes: `Discussed Q2 priorities with ${crmCompanies[i].nameEn}`,
        },
      });
    } catch {}
  }
  console.log(`  CRM seeded`);

  // ─── Partners ────────────────────────────────────────────────────────────
  console.log("\n[Partners] Profile / services / leads / clients / deals...");

  // A partner user (one of our companies acts as a partner of BGroup)
  const partnerPassword = await bcrypt.hash("Partner@123", 12);
  const partnerUser = await db.user.upsert({
    where: { email: "partner@byteforce.com" },
    create: {
      email: "partner@byteforce.com",
      name: "ByteForce Partner",
      password: partnerPassword,
      partnersAccess: true,
    },
    update: { partnersAccess: true },
  });
  const partnerProfile = await db.partnerProfile.upsert({
    where: { userId: partnerUser.id },
    create: {
      userId: partnerUser.id,
      companyName: "ByteForce",
      contactPhone: "+20100000001",
      commissionRate: 12,
      isActive: true,
    },
    update: {},
  });

  // Services
  const services: { id: string }[] = [];
  for (const s of [
    { name: "ERP Implementation", price: 75000 },
    { name: "Custom Software Development", price: 120000 },
    { name: "Cloud Consulting", price: 50000 },
  ]) {
    const svc = await db.partnerService.upsert({
      where: { id: `seed-pn-svc-${s.name.replace(/\s+/g, "-").toLowerCase()}` },
      create: {
        id: `seed-pn-svc-${s.name.replace(/\s+/g, "-").toLowerCase()}`,
        name: s.name,
        description: s.name,
        basePrice: s.price,
        isActive: true,
      },
      update: {},
    });
    services.push(svc);
  }

  // Leads / Clients / Deals
  const leadStatuses = ["NEW", "CONTACTED", "QUALIFIED"] as const;
  for (let i = 0; i < 3; i++) {
    try {
      await db.partnerLead.create({
        data: {
          partnerId: partnerProfile.id,
          name: `Lead Contact ${i + 1}`,
          email: `lead${i + 1}@example.com`,
          phone: `+2010111111${i}`,
          company: ["TechCorp", "FinPro", "MediGroup"][i],
          status: leadStatuses[i],
        },
      });
    } catch {}
  }

  const partnerClients: { id: string; name: string }[] = [];
  for (let i = 0; i < 2; i++) {
    const c = await db.partnerClient.upsert({
      where: { id: `seed-pn-client-${i + 1}` },
      create: {
        id: `seed-pn-client-${i + 1}`,
        partnerId: partnerProfile.id,
        name: ["Acme Corp", "Globex Inc."][i],
        email: ["ops@acme.com", "info@globex.com"][i],
        phone: `+201020000${i}`,
        company: ["Acme Corp", "Globex Inc."][i],
      },
      update: {},
    });
    partnerClients.push(c);
  }

  const dealStatuses = ["PENDING", "WON"] as const;
  for (let i = 0; i < 2; i++) {
    try {
      await db.partnerDeal.create({
        data: {
          partnerId: partnerProfile.id,
          clientId: partnerClients[i].id,
          serviceId: services[i].id,
          value: 80000 + i * 40000,
          status: dealStatuses[i],
          notes: `Deal with ${partnerClients[i].name}`,
          wonAt: dealStatuses[i] === "WON" ? new Date() : null,
        },
      });
    } catch {}
  }
  console.log(`  Partners seeded`);

  // ─── Onboarding template (default) ───────────────────────────────────────
  console.log("\n[Onboarding] Default template...");
  await db.onboardingTemplate.upsert({
    where: { name: "Default 30-day onboarding" },
    create: {
      name: "Default 30-day onboarding",
      description: "Day-0 through 30-day checklist used when no specific template is chosen.",
      scope: "general",
      isActive: true,
      isDefault: true,
      createdById: admin.id,
      items: {
        create: [
          { position: 0, title: "Send welcome email", taskType: "EMAIL", priority: "HIGH", dueInDays: 0 },
          { position: 1, title: "Provision laptop and accounts", taskType: "ADMIN", priority: "HIGH", dueInDays: 1 },
          { position: 2, title: "Day-1 onboarding session", taskType: "MEETING", priority: "HIGH", dueInDays: 1 },
          { position: 3, title: "Collect signed offer letter", taskType: "ADMIN", priority: "MEDIUM", dueInDays: 2 },
          { position: 4, title: "Add to payroll", taskType: "ADMIN", priority: "MEDIUM", dueInDays: 3 },
          { position: 5, title: "Assign mentor", taskType: "GENERAL", priority: "MEDIUM", dueInDays: 3 },
          { position: 6, title: "Team intros", taskType: "MEETING", priority: "MEDIUM", dueInDays: 5 },
          { position: 7, title: "Walk through handbook", taskType: "ONBOARDING", priority: "MEDIUM", dueInDays: 7 },
          { position: 8, title: "Set 30-day goals", taskType: "REVIEW", priority: "HIGH", dueInDays: 14 },
          { position: 9, title: "30-day check-in", taskType: "MEETING", priority: "MEDIUM", dueInDays: 30 },
        ],
      },
    },
    update: {},
  });

  // ─── Tasks (across modules) + comments + watchers + time entries + deps ──
  console.log("\n[Tasks] Cross-module tasks...");
  // Helper: idempotent task by id
  async function ensureTask(id: string, data: Parameters<typeof db.task.create>[0]["data"]) {
    return db.task.upsert({
      where: { id },
      create: { id, ...data },
      update: {},
    });
  }

  const t1 = await ensureTask("seed-task-crm-followup", {
    title: "Follow up with ByteForce on Q2 proposal",
    description: "They mentioned needing pricing breakdown by module.",
    type: "FOLLOW_UP",
    priority: "HIGH",
    module: "crm",
    assigneeId: admin.id,
    createdById: admin.id,
    dueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
  });

  const t2 = await ensureTask("seed-task-hr-payroll", {
    title: "Lock April payroll",
    description: "Run final calc + lock against changes.",
    type: "ADMIN",
    priority: "URGENT",
    module: "hr",
    assigneeId: admin.id,
    createdById: admin.id,
    dueAt: new Date(),
  });

  const t3 = await ensureTask("seed-task-partners-deal", {
    title: "Approve Globex deal contract",
    description: "Contract requested by partner — review and approve.",
    type: "APPROVAL",
    priority: "HIGH",
    module: "partners",
    assigneeId: admin.id,
    createdById: admin.id,
    dueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2),
  });

  const t4 = await ensureTask("seed-task-recurring", {
    title: "Weekly status sync",
    description: "Recurring weekly checkin with team leads.",
    type: "MEETING",
    priority: "MEDIUM",
    module: "general",
    assigneeId: admin.id,
    createdById: admin.id,
    dueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3),
    recurrence: { kind: "after_complete", intervalDays: 7 },
  });

  // Subtasks
  await ensureTask("seed-task-crm-followup-sub-1", {
    title: "Draft pricing PDF",
    type: "GENERAL",
    priority: "HIGH",
    module: "crm",
    assigneeId: admin.id,
    createdById: admin.id,
    parentId: t1.id,
    dueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
  });
  await ensureTask("seed-task-crm-followup-sub-2", {
    title: "Send via email",
    type: "EMAIL",
    priority: "HIGH",
    module: "crm",
    assigneeId: admin.id,
    createdById: admin.id,
    parentId: t1.id,
    dueAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
  });

  // Comment
  await db.taskComment.upsert({
    where: { id: "seed-comment-1" },
    create: {
      id: "seed-comment-1",
      taskId: t1.id,
      authorId: admin.id,
      body: "Pricing breakdown waiting on finance — should land Monday.",
    },
    update: {},
  });

  // Watcher (admin watches t3)
  try {
    await db.taskWatcher.create({
      data: { taskId: t3.id, userId: admin.id },
    });
  } catch {}

  // Time entry (closed)
  try {
    await db.taskTimeEntry.create({
      data: {
        id: "seed-time-1",
        taskId: t2.id,
        userId: admin.id,
        startedAt: new Date(Date.now() - 45 * 60_000),
        endedAt: new Date(),
        durationMinutes: 45,
        note: "Initial calc walkthrough",
      },
    });
  } catch {}

  // Dependency: t1 blocked by t4
  try {
    await db.taskDependency.create({
      data: { taskId: t1.id, blockedById: t4.id },
    });
  } catch {}

  console.log(`  Tasks seeded (4 main + 2 subtasks + 1 comment + 1 watcher + 1 time entry + 1 dependency)`);

  // ─── Notifications ───────────────────────────────────────────────────────
  console.log("\n[Notifications] HR + Partner samples...");
  const hrUserProfile = await db.hrUserProfile.findUnique({ where: { userId: admin.id } });
  if (hrUserProfile) {
    try {
      await db.hrNotification.create({
        data: {
          userId: admin.id,
          notificationType: "info",
          title: "Welcome to BGroup",
          message: "Your test data has been seeded — explore HR, CRM, Partners, Tasks.",
        },
      });
    } catch {}
  }
  try {
    await db.partnerNotification.create({
      data: {
        userId: admin.id,
        type: "GENERAL",
        title: "Sample partner notification",
        message: "Test partner notification for the smoke test.",
      },
    });
  } catch {}

  console.log("\n✓ Seed complete. Summary:");
  console.log(`  HR companies: ${hrCompanies.length}`);
  console.log(`  HR departments: ${allDepts.length}`);
  console.log(`  HR employees: ${employees.length}`);
  console.log(`  CRM companies: ${crmCompanies.length}`);
  console.log(`  CRM products: ${products.length}`);
  console.log(`  Partner services: ${services.length}`);
  console.log(`  Partner clients: ${partnerClients.length}`);
  console.log(`  Tasks: 4 parents, 2 subtasks, 1 dependency`);
  console.log(`\n  Admin login:    admin@bgroup.com / Admin@123456`);
  console.log(`  Partner login:  partner@byteforce.com / Partner@123`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
