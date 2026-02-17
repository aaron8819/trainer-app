import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import { getBonusSuggestions } from "@/lib/api/bonus-suggestions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    return NextResponse.json({ error: "Missing workout id" }, { status: 400 });
  }

  const owner = await resolveOwner();
  const suggestions = await getBonusSuggestions(resolvedParams.id, owner.id);

  return NextResponse.json({ suggestions });
}
