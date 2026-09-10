import { draftHttp } from "@/lib/api/trainer2/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return draftHttp(request, "ReadDraft", (await context.params).id);
}
