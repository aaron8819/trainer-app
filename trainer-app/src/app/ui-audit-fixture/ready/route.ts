import { getUiAuditFixtureFromHeaders } from "@/lib/ui-audit-fixtures/server";

export function GET(request: Request) {
  if (!getUiAuditFixtureFromHeaders(request.headers)) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json({ status: "ready", database: "unused" });
}
