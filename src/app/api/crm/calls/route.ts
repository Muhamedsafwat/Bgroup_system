import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCall, getCalls } from "@/app/(dashboard)/crm/calls/actions";
import { createCallSchema } from "@/lib/crm/validations/call";
import { scopeCompanyByRole } from "@/lib/crm/rbac";
import { describeZodError } from "@/lib/zod-errors";
import type { SessionUser } from "@/types";
import type { CrmRole } from "@/generated/prisma";

async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!session.user.modules?.includes("crm")) return null;
  // CRM data tables (calls, opportunities, contacts, …) FK to
  // `CrmUserProfile.id`, NOT to `User.id`. Passing the auth-layer
  // `session.user.id` here meant `scopeCallByRole` was comparing
  // `CrmCall.callerId` against the wrong column — for any user whose
  // CrmUserProfile id differs from their User id (i.e. every user),
  // a REP got back zero rows OR (worse, in edge cases where IDs
  // happened to collide between tables) other reps' calls. Use the
  // CRM profile id, same as getRequiredSession() in lib/crm/session.ts.
  return {
    id: session.user.crmProfileId ?? session.user.id,
    email: session.user.email!,
    fullName: session.user.name!,
    role: session.user.crmRole as CrmRole,
    entityId: session.user.crmEntityId ?? null,
  };
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const action = searchParams.get("action");

  // Company search endpoint for the drawer autocomplete
  if (action === "searchCompanies") {
    const search = searchParams.get("search") || "";
    if (search.length < 2) {
      return NextResponse.json({ companies: [] });
    }

    const companies = await db.crmCompany.findMany({
      where: {
        ...scopeCompanyByRole(session),
        OR: [
          { nameEn: { contains: search, mode: "insensitive" } },
          { nameAr: { contains: search, mode: "insensitive" } },
        ],
      },
      select: { id: true, nameEn: true, nameAr: true },
      take: 10,
      orderBy: { nameEn: "asc" },
    });

    return NextResponse.json({ companies });
  }

  // Default: get calls list
  try {
    const result = await getCalls(session, {
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
      outcome: searchParams.get("outcome") || undefined,
      callType: searchParams.get("callType") || undefined,
      search: searchParams.get("search") || undefined,
      page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
      pageSize: searchParams.get("pageSize")
        ? Number(searchParams.get("pageSize"))
        : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching calls:", error);
    return NextResponse.json(
      { error: "Failed to fetch calls" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // If opportunityCode is provided instead of opportunityId, resolve it
    if (body.opportunityId && !body.opportunityId.startsWith("cl")) {
      // Check if it looks like a code (e.g., OPP-0001) rather than a CUID
      const isCode = /^[A-Z]+-\d+$/.test(body.opportunityId);
      if (isCode) {
        const opp = await db.crmOpportunity.findUnique({
          where: { code: body.opportunityId },
          select: { id: true },
        });
        if (opp) {
          body.opportunityId = opp.id;
        } else {
          return NextResponse.json(
            { error: "Opportunity not found" },
            { status: 400 }
          );
        }
      }
    }

    // Validate. Standardised on `{ error: message, fieldErrors: {...} }`
    // (same shape as every other CRM write route) so the client toast +
    // field-binding code can read one consistent contract. Previously
    // this route returned `{ error: "Validation failed", details: <flatten> }`
    // and the call drawer dropped the field-level info, so reps saw a
    // generic "Validation failed" instead of "Duration must be at least…".
    const parsed = createCallSchema.safeParse(body);
    if (!parsed.success) {
      const { message, fieldErrors } = describeZodError(parsed.error);
      return NextResponse.json({ error: message, fieldErrors }, { status: 400 });
    }

    const call = await createCall(session, parsed.data);

    return NextResponse.json(call, { status: 201 });
  } catch (error) {
    console.error("Error creating call:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create call",
      },
      { status: 500 }
    );
  }
}
