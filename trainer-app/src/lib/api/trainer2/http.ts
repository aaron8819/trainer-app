import { ZodError } from "zod";
import { ActionCollision, DraftAccessError, createDraft, editDraft, readDraft } from "./planning";
import { assertLocalRequest, developmentContext } from "./development";
import { id } from "../../trainer2-contracts/draft";

export async function draftHttp(request: Request, command: "CreateDraft" | "EditDraft" | "ReadDraft", planId?: string) {
  try {
    assertLocalRequest(request);
    const { db, principal } = await developmentContext();
    if (command === "ReadDraft") {
      const result = await db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return readDraft(tx, principal, id.parse(planId));
      });
      return Response.json(result ?? { error: "NOT_FOUND" }, { status: result ? 200 : 404, headers: { "Cache-Control": "no-store" } });
    }
    const text = await request.text();
    if (text.length > 1_000_000) return Response.json({ error: "COMMAND_TOO_LARGE" }, { status: 413 });
    const input = JSON.parse(text);
    const response = await (command === "CreateDraft" ? createDraft : editDraft)(db, principal, input);
    return Response.json(response, { status: response.outcome.status === "Accepted" ? 200 : response.outcome.status === "Conflict" ? 409 : 422 });
  } catch (error) {
    if (error instanceof DraftAccessError) return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof ActionCollision) return Response.json({ error: "ACTION_ID_COLLISION" }, { status: 409 });
    if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "INVALID_COMMAND" }, { status: 400 });
    return Response.json({ error: "DRAFT_TRANSACTION_FAILED", retry: "Retry the same action envelope" }, { status: 503 });
  }
}
