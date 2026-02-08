import { NextResponse } from "next/server";
import { resolveUser } from "@/lib/api/workout-context";
import { loadTemplates, createTemplate } from "@/lib/api/templates";
import { createTemplateSchema } from "@/lib/validation";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? undefined;

  const user = userId ? await resolveUser(userId) : await resolveUser();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const templates = await loadTemplates(user.id);
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = createTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveUser(parsed.data.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const template = await createTemplate(user.id, parsed.data);
  return NextResponse.json({ template }, { status: 201 });
}
