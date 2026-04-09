import { NextResponse } from "next/server";
import { searchExerciseLibrary } from "@/lib/api/exercise-library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseLimit(rawLimit: string | null): number {
  const parsedLimit = Number(rawLimit);
  if (!Number.isFinite(parsedLimit)) {
    return 8;
  }

  return Math.min(12, Math.max(1, Math.floor(parsedLimit)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const limit = parseLimit(searchParams.get("limit"));

  const results = await searchExerciseLibrary(query, limit);
  return NextResponse.json({ results });
}
