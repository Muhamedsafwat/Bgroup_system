import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getOpportunity,
  updateOpportunity,
  deleteOpportunity,
} from "@/app/(dashboard)/crm/opportunities/actions";
import { updateOpportunitySchema } from "@/lib/crm/validations/opportunity";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const opp = await getOpportunity(id);
  if (!opp) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(opp);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateOpportunitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }
    const updated = await updateOpportunity(id, parsed.data);
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update opportunity";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.modules?.includes("crm")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const result = await deleteOpportunity(id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete opportunity";
    const status = message.includes("not found")
      ? 404
      : message.includes("admin")
        ? 403
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
