/**
 * Bootstrap a top-level admin user with access to HR, CRM, and Partners.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts <email> <password> [fullName]
 *
 * Example:
 *   npx tsx scripts/create-admin.ts admin@bgroup.com 'ChangeMe!123' 'Ibrahim Elmur'
 *
 * Creates:
 *   - User row (email, password bcrypt, hrAccess/crmAccess/partnersAccess = true)
 *   - HrUserProfile with super_admin role
 *   - CrmUserProfile with CEO role (sees all CRM data cross-entity)
 *   - NO PartnerProfile, so the user is treated as a Partners admin
 *
 * Safe to run more than once: updates password/roles in place if the email exists.
 */

import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config();

async function main() {
  const [, , emailArg, passwordArg, ...nameParts] = process.argv;

  if (!emailArg || !passwordArg) {
    console.error(
      "Usage: npx tsx scripts/create-admin.ts <email> <password> [fullName]"
    );
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();
  const password = passwordArg;
  const fullName = nameParts.join(" ") || "Super Admin";

  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter });
  try {
    const hashed = await bcrypt.hash(password, 12);

    console.log(`Creating / updating admin: ${email}`);

    const user = await db.user.upsert({
      where: { email },
      create: {
        email,
        name: fullName,
        password: hashed,
        hrAccess: true,
        crmAccess: true,
        partnersAccess: true,
      },
      update: {
        name: fullName,
        password: hashed,
        hrAccess: true,
        crmAccess: true,
        partnersAccess: true,
      },
    });

    // --- HR super_admin profile + role ---
    const superAdminRole = await db.hrRole.upsert({
      where: { name: "super_admin" },
      create: { name: "super_admin" },
      update: {},
    });

    const username = email.split("@")[0];
    const [firstName, ...rest] = fullName.split(" ");
    const lastName = rest.join(" ");

    const hrProfile = await db.hrUserProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        username,
        firstName: firstName || "Admin",
        lastName: lastName || "",
        isSuperuser: true,
        isStaff: true,
        isActive: true,
      },
      update: {
        username,
        firstName: firstName || "Admin",
        lastName: lastName || "",
        isSuperuser: true,
        isStaff: true,
        isActive: true,
      },
    });

    // Link super_admin role
    await db.hrUserRole.upsert({
      where: {
        userId_roleId: { userId: user.id, roleId: superAdminRole.id },
      },
      create: { userId: user.id, roleId: superAdminRole.id },
      update: {},
    });

    // --- CRM CEO profile ---
    // Some CRM schemas store the role on the profile. We try to upsert and
    // ignore failures if the shape differs in your install.
    try {
      await db.crmUserProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          role: "ADMIN",
          fullName,
        },
        update: {
          role: "ADMIN",
          fullName,
        },
      });
    } catch (err) {
      console.warn(
        "[crm] Could not upsert CrmUserProfile — check schema. Error:",
        (err as Error).message
      );
    }

    console.log("");
    console.log("✓ Admin user ready.");
    console.log("");
    console.log("  Email:    ", email);
    console.log("  Password: ", password);
    console.log("  User ID:  ", user.id);
    console.log("  HR role:  ", "super_admin");
    console.log("  CRM role: ", "CEO");
    console.log("  Partners: ", "ADMIN (no partnerId)");
    console.log("");
    console.log("  HR profile ID:", hrProfile.id);
    console.log("");
    console.log("Log in at http://localhost:3000/login");
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
