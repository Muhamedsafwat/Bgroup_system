import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { getBoardData, type Period } from "@/lib/admin/board-aggregator";
// audit v12 MEDIUM (MED-54): use canonical isPlatformAdmin instead of local copy
import { isPlatformAdmin } from "@/lib/crm/admin-gates";

export async function GET(req: Request) {
  const session = (await auth()) as Session | null;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const periodParam = url.searchParams.get("period") ?? "weekly";
  const period: Period =
    periodParam === "daily" || periodParam === "weekly" || periodParam === "monthly"
      ? (periodParam as Period)
      : "weekly";

  const data = await getBoardData(period);
  return NextResponse.json(data);
}
