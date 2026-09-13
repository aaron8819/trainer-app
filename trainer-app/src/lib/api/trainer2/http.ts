import { activatePlan } from "./activation";
import { changeInstructions } from "./instructions";
import { ZodError } from "zod";
import { ActionCollision, DraftAccessError, createDraft, editDraft, readDraft } from "./planning";
import { requestContext } from "./access";
import { id } from "../../trainer2-contracts/draft";

export async function draftHttp(request: Request, command: "CreateDraft" | "EditDraft" | "ReadDraft" | "ActivatePlan" | "ChangeInstructions", planId?: string) {
  try {
    const { db, principal } = await requestContext(request, command === "ReadDraft" ? "read" : "write");
    if (command === "ReadDraft") {
      const result = await db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
        return readDraft(tx, principal, id.parse(planId));
      });
      return json(result ?? { error: "NOT_FOUND" }, result ? 200 : 404);
    }
    const text = await request.text();
    if (text.length > 1_000_000) return json({ error: "COMMAND_TOO_LARGE" }, 413);
    const input = JSON.parse(text);
    const response = await (command === "CreateDraft" ? createDraft : command === "EditDraft" ? editDraft : command === "ActivatePlan" ? activatePlan : changeInstructions)(db, principal, input);
    return json(response, response.outcome.status === "Accepted" ? 200 : response.outcome.status === "Conflict" ? 409 : 422);
  } catch (error) {
    if (error instanceof DraftAccessError) return json({ error: error.message }, 403);
    if (error instanceof ActionCollision) return json({ error: "ACTION_ID_COLLISION" }, 409);
    if (error instanceof ZodError || error instanceof SyntaxError) return json({ error: "INVALID_COMMAND" }, 400);
    return json({ error: "DRAFT_TRANSACTION_FAILED", retry: "Retry the same action envelope" }, 503);
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
}
