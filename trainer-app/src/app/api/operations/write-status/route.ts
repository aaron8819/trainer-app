import { NextResponse } from "next/server";
import { getDeploymentVersion } from "@/lib/operations/deployment-version";
import { productionWriteRuntimeEvidence } from "@/lib/operations/production-write-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const { commitSha } = getDeploymentVersion();
  return NextResponse.json(productionWriteRuntimeEvidence(commitSha), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
