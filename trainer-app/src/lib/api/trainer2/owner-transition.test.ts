import { describe, expect, it, vi } from "vitest";
import { transitionSyntheticOwner } from "./owner-transition";

vi.mock("./sessions", () => ({ makeVerifier: vi.fn(async () => "private-verifier") }));
const syntheticId = "11111111-1111-4111-8111-111111111111";
const realId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const owner = { id: 1, accountId: syntheticId, sessionEpoch: 8, passcodeVerifier: "old-private-verifier" };
  const sessions = [{ id: "old-session", epoch: 8, ownerId: 1 }];
  const tx = {
    $queryRaw: vi.fn(async (query: unknown) => {
      const text = Array.isArray(query) ? query.join("") : "count";
      if (text.includes("information_schema")) return [
        { table_name: "Trainer2Owner" }, { table_name: "Trainer2Plan" },
        { table_name: "Trainer2Execution" }, { table_name: "Trainer2SetResultRevision" },
      ];
      return [{ count: BigInt(0) }];
    }),
    trainer2Owner: { findMany: vi.fn(async () => [owner]), update: vi.fn() },
    trainer2AccountPrincipal: { count: vi.fn(async () => 0) },
    user: { findMany: vi.fn(async () => [
      { id: syntheticId, email: `trainer2-hosted-synthetic-${syntheticId}@example.invalid` },
      { id: realId, email: "real-owner@example.com" },
    ]) },
    trainer2DeviceSession: { findMany: vi.fn(async () => sessions), updateMany: vi.fn() },
  };
  const db = { $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run(tx)) };
  const input = { expectedSyntheticAccountId: syntheticId, verifiedRealAccountId: realId,
    setupCode: "one-time-code-only-in-memory", preserveArchive: vi.fn(async () => {}) };
  return { db, tx, input, owner, sessions };
}

describe("operator-only owner transition proposal", () => {
  it("archives first, retains session rows, revokes old access and advances the epoch", async () => {
    const { db, tx, input, owner, sessions } = fixture();
    expect(await transitionSyntheticOwner(db as never, input)).toEqual({ archivedSessionCount: 1, setupRequired: true });
    expect(input.preserveArchive).toHaveBeenCalledWith({ version: 2, owner: {
      id: 1, accountId: syntheticId, sessionEpoch: owner.sessionEpoch,
    }, sessions });
    expect(JSON.stringify(input.preserveArchive.mock.calls)).not.toContain("private-verifier");
    expect(input.preserveArchive.mock.invocationCallOrder[0]).toBeLessThan(tx.trainer2DeviceSession.updateMany.mock.invocationCallOrder[0]);
    expect(tx.trainer2Owner.update).toHaveBeenCalledWith({ where: { id: 1 }, data: {
      accountId: realId, passcodeVerifier: null, setupVerifier: "private-verifier",
      failedAttempts: 0, lockedUntil: null, sessionEpoch: 9,
    } });
    expect(tx.trainer2DeviceSession.updateMany).toHaveBeenCalledWith({ where: { ownerId: 1, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 30000 });
  });
  it("performs no writes if private archive storage fails", async () => {
    const { db, tx, input } = fixture();
    input.preserveArchive.mockRejectedValueOnce(new Error("archive failed"));
    await expect(transitionSyntheticOwner(db as never, input)).rejects.toThrow("archive failed");
    expect(tx.trainer2Owner.update).not.toHaveBeenCalled();
    expect(tx.trainer2DeviceSession.updateMany).not.toHaveBeenCalled();
  });
  it.each(["binding", "principal", "missing-user", "real-data", "incomplete-inventory"])("denies %s before archiving or writing", async reason => {
    const { db, tx, input, owner } = fixture();
    if (reason === "binding") owner.accountId = realId;
    if (reason === "principal") tx.trainer2AccountPrincipal.count.mockResolvedValueOnce(1);
    if (reason === "missing-user") tx.user.findMany.mockResolvedValueOnce([]);
    if (reason === "real-data") tx.$queryRaw.mockImplementation(async query =>
      Array.isArray(query) && query.join("").includes("information_schema")
        ? [{ table_name: "Trainer2Plan" }, { table_name: "Trainer2SetResultRevision" }] as never
        : [{ count: BigInt(1) }] as never);
    if (reason === "incomplete-inventory") tx.$queryRaw.mockResolvedValue([]);
    await expect(transitionSyntheticOwner(db as never, input)).rejects.toThrow();
    expect(input.preserveArchive).not.toHaveBeenCalled();
    expect(tx.trainer2Owner.update).not.toHaveBeenCalled();
    expect(tx.trainer2DeviceSession.updateMany).not.toHaveBeenCalled();
  });
  it("rejects same-account and short setup inputs without opening a transaction", async () => {
    const { db, input } = fixture();
    await expect(transitionSyntheticOwner(db as never, { ...input, verifiedRealAccountId: syntheticId })).rejects.toThrow("INVALID_OWNER_TRANSITION_INPUT");
    await expect(transitionSyntheticOwner(db as never, { ...input, setupCode: "short" })).rejects.toThrow("INVALID_OWNER_TRANSITION_INPUT");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each([2147483645, 2147483646, 2147483647])("rejects exhausted epoch %s before attribution or writes", async epoch => {
    const { db, input, owner, tx } = fixture(); owner.sessionEpoch = epoch;
    await expect(transitionSyntheticOwner(db as never, input)).rejects.toThrow("SESSION_EPOCH_EXHAUSTED");
    expect(input.preserveArchive).not.toHaveBeenCalled();
    expect(tx.trainer2Owner.update).not.toHaveBeenCalled();
    expect(tx.trainer2DeviceSession.updateMany).not.toHaveBeenCalled();
  });
  it.each([0, 2147483644])("reserves setup and subsequent revocation at epoch %s", async epoch => {
    const { db, input, owner, tx } = fixture(); owner.sessionEpoch = epoch;
    await transitionSyntheticOwner(db as never, input);
    expect(tx.trainer2Owner.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sessionEpoch: epoch + 1 }) }));
  });
  it.each(['email', 'epoch', 'session-count'])("rejects changed operator preflight %s before writes", async reason => {
    const { db, input, tx } = fixture();
    const pinned = { ...input, verifiedRealEmail: reason === 'email' ? 'wrong@example.com' : 'real-owner@example.com',
      expectedSessionEpoch: reason === 'epoch' ? 7 : 8, expectedSessionCount: reason === 'session-count' ? 24 : 1 };
    await expect(transitionSyntheticOwner(db as never, pinned)).rejects.toThrow();
    expect(input.preserveArchive).not.toHaveBeenCalled();
    expect(tx.trainer2Owner.update).not.toHaveBeenCalled();
    expect(tx.trainer2DeviceSession.updateMany).not.toHaveBeenCalled();
  });
});
