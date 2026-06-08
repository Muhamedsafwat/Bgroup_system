import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import type {
  CrmRole,
} from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Type augmentation
// ---------------------------------------------------------------------------

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | null;
      // Module access
      modules: ("hr" | "crm" | "partners")[];
      // HR-specific
      hrRoles?: string[];
      hrProfileId?: string;
      hrCompanies?: string[];
      // CRM-specific
      crmRole?: CrmRole;
      crmEntityId?: string | null;
      crmProfileId?: string;
      // Partners-specific
      partnerId?: string;
      partnerProfileId?: string;
      // True when the user signed in with a password the admin set for them
      // and hasn't replaced it yet. The proxy redirects every navigation to
      // /account/change-password while this is true.
      mustChangePassword?: boolean;
      // Tier-1 #30 — impersonation marker. When set, this is the
      // original admin's user id; the session's own `user.id` is the
      // TARGET being impersonated. The banner reads this to render.
      actingAs?: string;
      // The admin's own crmProfileId when impersonation is active.
      // Audit-log writers SHOULD record this alongside the action so
      // the banner's "audited under your admin account" promise
      // resolves. Today only the schema columns exist; wiring every
      // CrmActivityLog / CrmStageHistory / CrmNote write to pass it
      // is tracked separately. Undefined when not impersonating.
      actingAsCrmProfileId?: string;
      /// The admin's own hrProfileId when impersonation is active —
      /// HrAuditLog writers consume this to record the admin behind
      /// the target's row.
      actingAsHrProfileId?: string;
      /// The admin's own auth User.id when impersonation is active —
      /// PartnerAuditLog records this as `actingAdminId` alongside
      /// the target's userId.
      actingAsUserId?: string;
    };
  }

  interface User {
    modules?: ("hr" | "crm" | "partners")[];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
    modules?: ("hr" | "crm" | "partners")[];
    hrRoles?: string[];
    hrProfileId?: string;
    hrCompanies?: string[];
    crmRole?: CrmRole;
    crmEntityId?: string | null;
    crmProfileId?: string;
    partnerId?: string;
    partnerProfileId?: string;
    mustChangePassword?: boolean;
    modulesRefreshedAt?: number;
    // Tier-1 #30 — impersonation. `actingAs` holds the admin's user
    // id once the JWT has been swapped onto a target; `adminEmail`
    // stashes the admin's own email so stop-impersonation can resolve
    // back to it without an extra DB hit.
    actingAs?: string;
    adminEmail?: string;
    // CRM / HR profile ids of the actual admin (set alongside
    // actingAs so audit-log writes can attribute to the admin
    // even though session.user.crmProfileId / hrProfileId have
    // been swapped to the target).
    actingAsCrmProfileId?: string;
    actingAsHrProfileId?: string;
    /// Auth User.id of the admin behind the action — duplicated from
    /// `actingAs` for symmetry with the per-module id fields and to
    /// make PartnerAuditLog writers (which key by User.id) consistent.
    actingAsUserId?: string;
  }
}

// ---------------------------------------------------------------------------
// Password utilities (Django + bcrypt)
// ---------------------------------------------------------------------------

async function verifyDjangoPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 4) return false;
  const [algorithm, iterationsStr, salt, storedHash] = parts;
  if (algorithm !== "pbkdf2_sha256") return false;
  const iterations = parseInt(iterationsStr, 10);

  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, "sha256", (err, key) => {
      if (err) return reject(err);
      const computed = key.toString("base64");
      const expected = Buffer.from(storedHash, "utf8");
      const actual = Buffer.from(computed, "utf8");
      if (expected.length !== actual.length) return resolve(false);
      resolve(crypto.timingSafeEqual(expected, actual));
    });
  });
}

async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  if (storedHash.startsWith("pbkdf2_sha256$")) {
    return verifyDjangoPassword(password, storedHash);
  }
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$")) {
    return bcrypt.compare(password, storedHash);
  }
  return false;
}

// ---------------------------------------------------------------------------
// NextAuth config
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db) as ReturnType<typeof PrismaAdapter>,
  providers: [
    // CRM: Google OAuth
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: false,
    }),

    // CRM: Magic link via Resend
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM || "B Group <noreply@bgroup.com>",
    }),

    // Unified email + password credentials. Accepts any user with a password
    // AND at least one active module (HR, CRM, or Partners). The provider ID
    // stays "hr-credentials" for backwards compatibility with the login form
    // and the test scripts, but it now authenticates CRM-only and
    // CRM+HR users too — which fixes the case where an admin creates a user
    // in /crm/admin/users (crmAccess: true, hrAccess: false) and that user
    // hits "Invalid email or password" on every login attempt.
    Credentials({
      id: "hr-credentials",
      name: "Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await db.user.findUnique({
          where: { email },
          include: {
            hrProfile: true,
            crmProfile: true,
            partnerProfile: true,
          },
        });
        if (!user || !user.password) return null;

        // The user needs at least one active module-attachment to log in.
        // For HR, the profile must be active. For CRM, the profile must be
        // active. For Partners, the profile (if present) must be active.
        const hasHr = !!user.hrAccess && user.hrProfile?.isActive !== false;
        const hasCrm = !!user.crmAccess && (user.crmProfile?.active ?? true) !== false;
        const hasPartner =
          !!user.partnersAccess &&
          (user.partnerProfile == null || user.partnerProfile.isActive);
        if (!hasHr && !hasCrm && !hasPartner) return null;

        const valid = await verifyPassword(password, user.password);
        if (!valid) return null;

        // Re-hash Django passwords to bcrypt on successful login
        if (user.password.startsWith("pbkdf2_sha256$")) {
          const newHash = await bcrypt.hash(password, 12);
          await db.user.update({
            where: { id: user.id },
            data: { password: newHash },
          });
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),

    // Partners: Email + password
    Credentials({
      id: "partner-credentials",
      name: "Partner Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await db.user.findUnique({
          where: { email },
          include: { partnerProfile: true },
        });
        if (!user || !user.partnersAccess || !user.password) return null;
        if (!user.partnerProfile?.isActive) return null;

        const valid = await verifyPassword(password, user.password);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],

  pages: {
    signIn: "/login",
    error: "/login",
  },

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const dbUser = await db.user.findUnique({
        where: { email: user.email },
        select: {
          hrAccess: true,
          crmAccess: true,
          partnersAccess: true,
          hrProfile: { select: { isActive: true } },
          crmProfile: { select: { active: true } },
          partnerProfile: { select: { isActive: true } },
        },
      });
      if (!dbUser) return false;

      // At least one module must be active. For Partners, users without a
      // partnerProfile are platform ADMINS and are allowed through.
      const hasAccess =
        (dbUser.hrAccess && dbUser.hrProfile?.isActive !== false) ||
        (dbUser.crmAccess && dbUser.crmProfile?.active !== false) ||
        (dbUser.partnersAccess &&
          (dbUser.partnerProfile == null || dbUser.partnerProfile.isActive));

      return hasAccess;
    },

    async jwt({ token, user, trigger }) {
      // Refresh module/role data on sign-in, manual update, or at most once a
      // minute on normal navigation — so permission/module changes picked up
      // without a forced log-out.
      const lastRefresh = (token.modulesRefreshedAt as number | undefined) ?? 0;
      const stale = Date.now() - lastRefresh > 60_000;
      const shouldRefresh = !!user?.email || trigger === "update" || !token.modules || stale;
      if (shouldRefresh) {
        let email = (user?.email || token.email) as string;
        // Tier-1 #30 — impersonation swap. Before resolving the user
        // from DB, check whether the actual signed-in admin has an
        // active CrmImpersonationSession. If yes, swap `email` to
        // the target's email so the rest of the callback resolves
        // their identity instead — and stamp `actingAs` on the token
        // so downstream UI knows to render a banner. The original
        // admin email is stashed in `adminEmail` so stop-impersonation
        // can snap back. Failures here keep the admin's own session
        // intact (we never lock the admin out due to an impersonation
        // bookkeeping error).
        // Resolve the *actual* admin id. Once impersonation is in
        // flight `token.userId` is the TARGET (rewritten near line
        // 347), so we MUST prefer `token.actingAs` whenever it's
        // set — otherwise the second refresh keys the lookup off
        // the target's id, finds nothing, and silently snaps the
        // admin back out of impersonation after ~60s.
        const candidateAdminId =
          (token.actingAs as string | undefined) ??
          (token.userId as string | undefined) ??
          user?.id;
        const candidateAdminEmail =
          (token.adminEmail as string | undefined) ?? email;
        // Stage every impersonation mutation into local variables
        // and only apply them to the token AFTER the dbUser lookup
        // (line ~410) succeeds. Previously we mutated the token
        // first; a transient Neon error during the dbUser fetch
        // would then return a token where actingAs/email/name
        // described the target but userId/crmProfileId/role were
        // still the admin's. RBAC saw the admin while the banner
        // said target — a real race window we close here.
        let pendingActingAs: string | undefined;
        let pendingAdminEmail: string | undefined;
        let pendingActingAsCrmProfileId: string | undefined;
        let pendingActingAsHrProfileId: string | undefined;
        let pendingDropImpersonation = false;
        if (candidateAdminId) {
          // Distinguish DB error (preserve current swap state)
          // from row-missing (the legitimate "admin stopped
          // impersonating" signal). A swallowed-as-null catch
          // here was previously cancelling impersonation on
          // transient Neon blips.
          let impersonation:
            | { targetUserId: string }
            | null
            | undefined;
          try {
            impersonation = await db.crmImpersonationSession.findUnique({
              where: { adminUserId: candidateAdminId },
              select: { targetUserId: true },
            });
          } catch (e) {
            console.warn(
              "[auth.jwt] impersonation lookup failed, preserving prior state:",
              e,
            );
            impersonation = undefined; // unknown — leave token alone
          }
          if (impersonation) {
            let targetUser: { email: string; name: string | null } | null = null;
            try {
              targetUser = await db.user.findUnique({
                where: { id: impersonation.targetUserId },
                select: { email: true, name: true },
              });
            } catch (e) {
              console.warn(
                "[auth.jwt] impersonation target lookup failed, preserving prior state:",
                e,
              );
            }
            if (targetUser?.email) {
              // Stage the swap — applied later if dbUser succeeds.
              // The dbUser lookup uses `email` (which we point at
              // the target's email here), so dbUser will already
              // carry the target's name. The pending commit at the
              // top of the `if (dbUser)` branch is what actually
              // applies the change to the token.
              pendingActingAs = candidateAdminId;
              pendingAdminEmail = candidateAdminEmail;
              email = targetUser.email;
              // Capture the admin's OWN module-profile ids while we
              // know who they are. dbUser will rewrite the session's
              // module-specific ids to the target's; audit writers in
              // each module read these to honour "audited under your
              // admin account". One query per module is cheap and
              // these only run on the impersonation hot-path.
              try {
                const [adminCrm, adminHr] = await Promise.all([
                  db.crmUserProfile.findFirst({
                    where: { userId: candidateAdminId },
                    select: { id: true },
                  }),
                  db.hrUserProfile.findFirst({
                    where: { userId: candidateAdminId },
                    select: { id: true },
                  }),
                ]);
                pendingActingAsCrmProfileId = adminCrm?.id;
                pendingActingAsHrProfileId = adminHr?.id;
              } catch {
                pendingActingAsCrmProfileId = undefined;
                pendingActingAsHrProfileId = undefined;
              }
            }
          } else if (impersonation === null && token.actingAs) {
            // Row was definitively missing (not a DB error) AND we
            // were previously impersonating — admin must have hit
            // the stop endpoint. Restore the admin's identity.
            const adminEmail = token.adminEmail as string | undefined;
            if (adminEmail) email = adminEmail;
            pendingDropImpersonation = true;
          }
        }
        // Wrap the refresh in try/catch — a transient DB blip during JWT
        // refresh would otherwise propagate up to NextAuth and return a null
        // session, which the proxy interprets as "unauthenticated" and
        // redirects. Better to ship the stale token than to log the user out
        // on a flake.
        const dbUser = await db.user
          .findUnique({
            where: { email },
            include: {
              hrProfile: {
                include: {
                  roles: { include: { role: true } },
                  companies: true,
                },
              },
              crmProfile: true,
              partnerProfile: true,
              hrEmployee: {
                select: {
                  id: true,
                  subordinates: { take: 1, select: { id: true } },
                },
              },
            },
          })
          .catch((err: unknown) => {
            console.warn(
              "[auth.jwt] refresh DB lookup failed, keeping stale token:",
              err instanceof Error ? err.message : err
            );
            return null;
          });
        if (!dbUser && shouldRefresh) {
          // If we couldn't refresh and we already had a token, return it
          // unchanged so existing sessions remain valid.
          if (token.modules) return token;
        }

        if (dbUser) {
          // Commit any staged impersonation mutations now that we
          // know the dbUser lookup succeeded — this closes the race
          // window where a transient DB error during dbUser fetch
          // would leave the token in a half-swapped state.
          if (pendingActingAs) {
            token.actingAs = pendingActingAs;
            token.adminEmail = pendingAdminEmail;
            token.actingAsCrmProfileId = pendingActingAsCrmProfileId;
            token.actingAsHrProfileId = pendingActingAsHrProfileId;
            // `actingAs` already is the auth User.id; duplicate it
            // onto `actingAsUserId` for symmetry with the per-module
            // id fields (PartnerAuditLog writers key by User.id).
            token.actingAsUserId = pendingActingAs;
          }
          if (pendingDropImpersonation) {
            delete token.actingAs;
            delete token.adminEmail;
            delete token.actingAsCrmProfileId;
            delete token.actingAsHrProfileId;
            delete token.actingAsUserId;
          }
          token.userId = dbUser.id;
          token.mustChangePassword = !!dbUser.mustChangePassword;
          // Keep token.name in sync with whichever identity the
          // dbUser lookup resolved (admin OR impersonation target).
          // Without this the banner and any UI consumer reading
          // session.user.name would show the original sign-in name
          // forever — wrong during impersonation, and stale after
          // a name change.
          if (dbUser.name) token.name = dbUser.name;
          token.email = dbUser.email;

          // Determine accessible modules
          const modules: ("hr" | "crm" | "partners")[] = [];
          if (dbUser.hrAccess && dbUser.hrProfile?.isActive) {
            modules.push("hr");
          }
          if (dbUser.crmAccess && dbUser.crmProfile?.active) {
            modules.push("crm");
          }
          if (
            dbUser.partnersAccess &&
            (dbUser.partnerProfile == null || dbUser.partnerProfile.isActive)
          ) {
            modules.push("partners");
          }
          token.modules = modules;

          // CRM data — only surface when the profile is ACTIVE. Without
          // this, deactivating a CRM profile excluded "crm" from
          // `modules` but kept `crmRole` / `crmProfileId` on the token,
          // so cross-module helpers that branched on crmRole (saved
          // views isAdmin, email templates, etc.) treated the user as
          // an active CRM admin. Reset to undefined so deactivation is
          // observable everywhere.
          token.crmProfileId = undefined;
          token.crmRole = undefined;
          token.crmEntityId = undefined;
          if (dbUser.crmProfile && dbUser.crmProfile.active) {
            token.crmProfileId = dbUser.crmProfile.id;
            token.crmRole = dbUser.crmProfile.role;
            token.crmEntityId = dbUser.crmProfile.entityId;
          }

          // HR data — same pattern: reset before re-applying so a
          // deactivated HR profile doesn't leak roles forward.
          token.hrProfileId = undefined;
          token.hrRoles = undefined;
          token.hrCompanies = undefined;
          if (dbUser.hrProfile && dbUser.hrProfile.isActive) {
            token.hrProfileId = dbUser.hrProfile.id;
            const explicitRoles = dbUser.hrProfile.roles.map((r) => r.role.name);
            const derivedLead =
              !!dbUser.hrEmployee?.subordinates?.length &&
              !explicitRoles.includes("team_lead");
            token.hrRoles = derivedLead
              ? [...explicitRoles, "team_lead"]
              : explicitRoles;
            token.hrCompanies = dbUser.hrProfile.companies.map(
              (c) => c.companyId,
            );
          }

          // Partners data (reset first in case a profile was removed)
          token.partnerProfileId = undefined;
          token.partnerId = undefined;
          if (dbUser.partnerProfile && dbUser.partnerProfile.isActive) {
            token.partnerProfileId = dbUser.partnerProfile.id;
            token.partnerId = dbUser.partnerProfile.id;
          }

          token.modulesRefreshedAt = Date.now();
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.userId as string;
        session.user.modules = (token.modules as ("hr" | "crm" | "partners")[]) || [];
        session.user.hrRoles = token.hrRoles as string[] | undefined;
        session.user.hrProfileId = token.hrProfileId as string | undefined;
        session.user.hrCompanies = token.hrCompanies as string[] | undefined;
        session.user.crmRole = token.crmRole as CrmRole | undefined;
        session.user.crmEntityId = token.crmEntityId as string | null | undefined;
        session.user.crmProfileId = token.crmProfileId as string | undefined;
        session.user.partnerId = token.partnerId as string | undefined;
        session.user.partnerProfileId = token.partnerProfileId as string | undefined;
        session.user.mustChangePassword = !!token.mustChangePassword;
        // Tier-1 #30 — surface impersonation marker for the banner.
        // `actingAs` = the original admin's user id; the session's
        // own user.id is the TARGET we're impersonating.
        session.user.actingAs = token.actingAs;
        session.user.actingAsCrmProfileId = token.actingAsCrmProfileId;
        session.user.actingAsHrProfileId = token.actingAsHrProfileId;
        session.user.actingAsUserId = token.actingAsUserId;
      }
      return session;
    },
  },
});
