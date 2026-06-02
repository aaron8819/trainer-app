import { NextResponse } from "next/server";
import { preparePreSessionReadinessSnapshot } from "@/lib/api/pre-session-readiness-producer";
import { resolveOwner } from "@/lib/api/workout-context";

export async function POST() {
  const owner = await resolveOwner();
  if (!owner) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const result = await preparePreSessionReadinessSnapshot(owner.id, {
    ownerEmail: owner.email,
  });

  if (result.status === "blocked") {
    return NextResponse.json(
      {
        ok: false,
        status: result.status,
        reason: result.reason,
        message: result.message,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    snapshotId: result.snapshot.id,
    invalidatedSnapshotCount: result.invalidatedSnapshotCount,
    replacementPolicy: result.replacementPolicy,
    preSessionReadinessContract: result.contract,
    preSessionReadinessCard: result.gymCard,
  });
}
