import { draftHttp } from "@/lib/api/trainer2/http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const paused = productionWritePauseResponse("trainer2_draft", "/api/trainer2/drafts/create");
  if (paused) return paused;
  return draftHttp(request, "CreateDraft");
}
