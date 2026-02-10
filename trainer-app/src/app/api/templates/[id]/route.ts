import { NextResponse } from "next/server";
import {
  loadTemplateDetail,
  updateTemplate,
  deleteTemplate,
} from "@/lib/api/templates";
import { updateTemplateSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owner = await resolveOwner();

  const template = await loadTemplateDetail(id, owner.id);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ template });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owner = await resolveOwner();
  const body = await request.json().catch(() => ({}));
  const parsed = updateTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const template = await updateTemplate(id, parsed.data, owner.id);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ template });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owner = await resolveOwner();

  const deleted = await deleteTemplate(id, owner.id);
  if (!deleted) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ status: "deleted" });
}
