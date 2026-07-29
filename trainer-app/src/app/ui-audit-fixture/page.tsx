import { notFound } from "next/navigation";
import { UiAuditFixturePage } from "@/components/ui-audit/UiAuditFixturePage";
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function UiAuditFixtureRoute({
  searchParams,
}: {
  searchParams: Promise<{
    path?: string;
  }>;
}) {
  const resolved = await searchParams;
  const fixture = await getUiAuditFixtureForServer();
  if (!fixture) notFound();

  return (
    <UiAuditFixturePage
      pathname={resolved.path ?? "/"}
      fixture={fixture}
    />
  );
}
