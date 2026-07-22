import { NextResponse } from "next/server";
import { getDeploymentVersion } from "@/lib/operations/deployment-version";

export const dynamic = "force-static";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getDeploymentVersion(), {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
