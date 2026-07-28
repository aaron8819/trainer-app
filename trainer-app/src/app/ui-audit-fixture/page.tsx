import { notFound } from "next/navigation";
import { UiAuditFixturePage } from "@/components/ui-audit/UiAuditFixturePage";
import {
  getUiAuditFixtureByScenario,
  type UiAuditFixtureScenario,
} from "@/lib/ui-audit-fixtures/fixtures";
import {
  isUiAuditFixtureModeEnabled,
  isUiAuditFixtureScenario,
} from "@/lib/ui-audit-fixtures/access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function UiAuditFixtureRoute({
  searchParams,
}: {
  searchParams: Promise<{
    path?: string;
    scenario?: UiAuditFixtureScenario;
  }>;
}) {
  const resolved = await searchParams;
  if (
    !isUiAuditFixtureModeEnabled({
      mode: process.env.UI_AUDIT_FIXTURE_MODE,
      nodeEnv: process.env.NODE_ENV,
    }) ||
    !isUiAuditFixtureScenario(resolved.scenario)
  ) {
    notFound();
  }

  return (
    <UiAuditFixturePage
      pathname={resolved.path ?? "/"}
      fixture={getUiAuditFixtureByScenario(resolved.scenario)}
    />
  );
}
