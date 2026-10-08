import "next/headers";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { DraftAccessError } from "./principal";
import { assertEpochCapacity } from "./session-epoch";

function derive(secret: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(secret, salt, 32,
    { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
}
export const SESSION_COOKIE = "__Host-trainer2-session";
const DAY = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 30;
const ABSOLUTE_DAYS = 90;
type Db = PrismaClient | Prisma.TransactionClient;

function ownerId(env: Record<string, string | undefined> = process.env) {
  const id = env.TRAINER2_OWNER_USER_ID;
  if (!id || id.trim() !== id || !/^[0-9a-f-]{36}$/i.test(id)) throw new DraftAccessError("OWNER_CONFIGURATION_REQUIRED");
  return id;
}

export async function soleOwner(db: Db) {
  const rows = await db.trainer2Owner.findMany({ take: 2 });
  if (rows.length !== 1 || rows[0].id !== 1 || rows[0].accountId !== ownerId())
    throw new DraftAccessError("OWNER_BINDING_INVALID");
  return rows[0];
}

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export async function makeVerifier(secret: string) {
  if (secret.length < 12 || secret.length > 128) throw new DraftAccessError("INVALID_PASSCODE");
  const salt = randomBytes(16);
  const hash = await derive(secret, salt);
  return `scrypt-v1:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

async function matches(secret: string, encoded: string | null) {
  if (!encoded || secret.length > 128) return false;
  const parts = encoded.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt-v1") return false;
  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = await derive(secret, salt);
  return timingSafeEqual(actual, expected);
}

function credential() {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  return { id, secret, value: `${id}.${secret}`, tokenHash: digest(secret) };
}

async function issue(tx: Prisma.TransactionClient, epoch: number) {
  const token = credential();
  const now = Date.now();
  await tx.trainer2DeviceSession.create({ data: {
    id: token.id, ownerId: 1, tokenHash: token.tokenHash, epoch,
    createdAt: new Date(now), renewedAt: new Date(now),
    expiresAt: new Date(now + SESSION_DAYS * DAY), absoluteExpiresAt: new Date(now + ABSOLUTE_DAYS * DAY),
  } });
  return token.value;
}

/** Admin-provisioned setup verifier is single use. No browser can create the owner binding. */
export async function enterPasscode(db: PrismaClient, input: { setupCode?: string; passcode: string }) {
  if (input.passcode.length < 12 || input.passcode.length > 128 ||
    (input.setupCode !== undefined && (input.setupCode.length < 24 || input.setupCode.length > 128)))
    throw new DraftAccessError("AUTHENTICATION_FAILED");
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Trainer2Owner" WHERE "id" = 1 FOR UPDATE`;
    const owner = await soleOwner(tx);
    const now = new Date();
    if (owner.lockedUntil && owner.lockedUntil > now) return null;
    const setup = input.setupCode !== undefined;
    const valid = setup
      ? owner.passcodeVerifier === null && await matches(input.setupCode!, owner.setupVerifier)
      : owner.passcodeVerifier !== null && await matches(input.passcode, owner.passcodeVerifier);
    if (!valid) {
      const failed = owner.failedAttempts + 1;
      await tx.trainer2Owner.update({ where: { id: 1 }, data: {
        failedAttempts: failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      } });
      return null;
    }
    let epoch = owner.sessionEpoch;
    if (setup) {
      assertEpochCapacity(epoch);
      epoch++;
      await tx.trainer2Owner.update({ where: { id: 1 }, data: {
        passcodeVerifier: await makeVerifier(input.passcode), setupVerifier: null,
        sessionEpoch: epoch, failedAttempts: 0, lockedUntil: null,
      } });
    } else {
      await tx.trainer2Owner.update({ where: { id: 1 }, data: { failedAttempts: 0, lockedUntil: null } });
    }
    return issue(tx, epoch);
  });
  if (!result) throw new DraftAccessError("AUTHENTICATION_FAILED");
  return result;
}

function parseCookie(request: Request) {
  if (request.headers.has("authorization")) throw new DraftAccessError("UNSUPPORTED_CREDENTIAL_TRANSPORT");
  const matches = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim())
    .filter(v => v.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) throw new DraftAccessError("UNAUTHENTICATED");
  const value = matches[0].slice(SESSION_COOKIE.length + 1);
  const parts = value.split(".");
  if (parts.length !== 2 || !/^[0-9a-f-]{36}$/i.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]))
    throw new DraftAccessError("UNAUTHENTICATED");
  return { id: parts[0], secret: parts[1] };
}

export async function sessionForRequest(db: Db, request: Request) {
  const { id, secret } = parseCookie(request);
  const owner = await soleOwner(db);
  if (!owner.passcodeVerifier) throw new DraftAccessError("UNAUTHENTICATED");
  const session = await db.trainer2DeviceSession.findUnique({ where: { id } });
  const supplied = Buffer.from(digest(secret), "hex");
  const stored = Buffer.from(session?.tokenHash ?? "".padStart(64, "0"), "hex");
  if (!session || stored.length !== supplied.length || !timingSafeEqual(supplied, stored) ||
    session.ownerId !== owner.id || session.epoch !== owner.sessionEpoch || session.revokedAt ||
    session.expiresAt <= new Date() || session.absoluteExpiresAt <= new Date())
    throw new DraftAccessError("UNAUTHENTICATED");
  return { accountId: owner.accountId, sessionId: id };
}

export async function renewSession(db: PrismaClient, request: Request) {
  const principal = await sessionForRequest(db, request);
  const session = await db.trainer2DeviceSession.findUniqueOrThrow({ where: { id: principal.sessionId } });
  if (session.expiresAt.getTime() - Date.now() < 7 * DAY) {
    const next = new Date(Math.min(Date.now() + SESSION_DAYS * DAY, session.absoluteExpiresAt.getTime()));
    await db.trainer2DeviceSession.updateMany({ where: { id: session.id, revokedAt: null, epoch: session.epoch },
      data: { expiresAt: next, renewedAt: new Date() } });
  }
  return principal;
}

export async function revokeSession(db: PrismaClient, request: Request, all: boolean) {
  const principal = await sessionForRequest(db, request);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Trainer2Owner" WHERE id = 1 FOR UPDATE`;
    // An ingress-authorized request may have waited across rebinding or revocation.
    const current = await sessionForRequest(tx, request);
    if (current.accountId !== principal.accountId || current.sessionId !== principal.sessionId)
      throw new DraftAccessError("UNAUTHENTICATED");
    if (all) {
      const owner = await soleOwner(tx);
      assertEpochCapacity(owner.sessionEpoch);
      await tx.trainer2Owner.update({ where: { id: 1 }, data: { sessionEpoch: { increment: 1 } } });
    } else await tx.trainer2DeviceSession.updateMany({ where: { id: principal.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}

/** A current device can choose a replacement directly; no setup credential is issued. */
export async function replacePasscode(db: PrismaClient, request: Request, input: {
  accountId: string; epoch: number; passcode: string; confirmation: string;
}) {
  if (input.passcode.length < 12 || input.passcode.length > 128 ||
    input.passcode !== input.confirmation || !Number.isInteger(input.epoch) || input.epoch < 0)
    throw new DraftAccessError("AUTHENTICATION_FAILED");
  const principal = await sessionForRequest(db, request);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Trainer2Owner" WHERE id = 1 FOR UPDATE`;
    const current = await sessionForRequest(tx, request);
    const owner = await soleOwner(tx);
    if (current.accountId !== principal.accountId || current.sessionId !== principal.sessionId ||
      owner.accountId !== input.accountId || owner.sessionEpoch !== input.epoch)
      throw new DraftAccessError("UNAUTHENTICATED");
    assertEpochCapacity(owner.sessionEpoch);
    const verifier = await makeVerifier(input.passcode);
    await tx.trainer2Owner.update({ where: { id: 1 }, data: {
      passcodeVerifier: verifier, setupVerifier: null, sessionEpoch: { increment: 1 },
      failedAttempts: 0, lockedUntil: null,
    } });
    await tx.trainer2DeviceSession.updateMany({ where: { ownerId: 1, revokedAt: null },
      data: { revokedAt: new Date() } });
  });
}

export function sessionCookieOptions() {
  return { path: "/", sameSite: "lax" as const, httpOnly: true, secure: true,
    maxAge: ABSOLUTE_DAYS * 24 * 60 * 60 };
}
