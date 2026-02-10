import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadWeeklyProgramInputs } from "@/lib/api/weekly-program";
import { analyzeWeeklyProgram } from "@/lib/engine/weekly-program-analysis";

function parseTemplateIds(searchParams: URLSearchParams): string[] | undefined {
  const raw = searchParams.get("templateIds");
  if (!raw) {
    return undefined;
  }
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return ids.length > 0 ? ids : undefined;
}

export async function GET(request: Request) {
  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const templateIds = parseTemplateIds(searchParams);
  const program = await loadWeeklyProgramInputs(user.id, { templateIds });
  const analysis = analyzeWeeklyProgram(program.sessions);

  return NextResponse.json({
    selection: {
      daysPerWeek: program.daysPerWeek,
      trainingAge: program.trainingAge,
      templateCount: program.templates.length,
      templateIds: program.templates.map((template) => template.id),
      templates: program.templates,
    },
    analysis,
  });
}
