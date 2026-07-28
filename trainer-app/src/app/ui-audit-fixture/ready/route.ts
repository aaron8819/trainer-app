import { isUiAuditFixtureModeEnabled } from "@/lib/ui-audit-fixtures/access";

export function GET() {
  if (
    !isUiAuditFixtureModeEnabled({
      mode: process.env.UI_AUDIT_FIXTURE_MODE,
      nodeEnv: process.env.NODE_ENV,
    })
  ) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json({ status: "ready", database: "unused" });
}
