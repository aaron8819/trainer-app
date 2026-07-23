import { describe, expect, it } from "vitest";
import {
  buildTestEnvironmentPreflight,
  classifyDatabaseTarget,
} from "./test-environment-preflight";

const READY_INPUT = {
  dependencyInstallation: "available" as const,
  dependencyArrangement: "standalone" as const,
  prismaClient: "available" as const,
  prismaVersionMatches: true,
  docker: "available" as const,
};

describe("classifyDatabaseTarget", () => {
  it("distinguishes missing, invalid, local, and remote targets without exposing values", () => {
    expect(classifyDatabaseTarget()).toBe("missing");
    expect(classifyDatabaseTarget("not-a-url")).toBe("invalid");
    expect(classifyDatabaseTarget("postgresql://user:secret@127.0.0.1:5432/test")).toBe("local");
    expect(classifyDatabaseTarget("postgresql://user:secret@db.example.test/test")).toBe("remote");
  });
});

describe("buildTestEnvironmentPreflight", () => {
  it("keeps credential-free verification runnable while blocking the full inventory without a DB target", () => {
    const report = buildTestEnvironmentPreflight(READY_INPUT);

    expect(report.success).toBe(true);
    expect(report.groups.pureVerification.status).toBe("runnable");
    expect(report.groups.fullVitest.status).toBe("blocked");
    expect(report.groups.disposableDatabase.status).toBe("separate");
    expect(report.warnings).toContain(
      "DATABASE_URL is missing; the full Vitest inventory is blocked before collection."
    );
  });

  it("allows full collection only for an explicit local database target", () => {
    const report = buildTestEnvironmentPreflight({
      ...READY_INPUT,
      databaseUrl: "postgresql://trainer:secret@localhost:5432/trainer_test",
    });

    expect(report.success).toBe(true);
    expect(report.databaseTarget).toBe("local");
    expect(report.groups.fullVitest.status).toBe("runnable");
  });

  it("refuses remote database targets", () => {
    const report = buildTestEnvironmentPreflight({
      ...READY_INPUT,
      databaseUrl: "postgresql://trainer:secret@db.example.test/trainer",
    });

    expect(report.success).toBe(false);
    expect(report.groups.fullVitest.status).toBe("blocked");
    expect(report.blockers).toContain(
      "DATABASE_URL is not local; the full test inventory refuses remote database targets."
    );
  });

  it("rejects junction-backed dependencies and mismatched Prisma versions", () => {
    const report = buildTestEnvironmentPreflight({
      ...READY_INPUT,
      dependencyArrangement: "junction",
      prismaVersionMatches: false,
    });

    expect(report.success).toBe(false);
    expect(report.groups.pureVerification.status).toBe("blocked");
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "node_modules is a junction; comprehensive verification requires a standalone installation.",
        "Prisma CLI and @prisma/client versions do not match.",
      ])
    );
  });
});
