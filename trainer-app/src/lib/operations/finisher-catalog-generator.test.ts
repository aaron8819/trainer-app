import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: "",
  expected: "",
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", () => {
  const readFileSync = () => mocks.current;
  return {
    default: { readFileSync, writeFileSync: mocks.writeFileSync },
    readFileSync,
    writeFileSync: mocks.writeFileSync,
  };
});

vi.mock("../../../prisma/finisher-routine-migration-sql", () => ({
  FINISHER_CATALOG_SQL_START: "-- BEGIN GENERATED FINISHER CATALOG",
  FINISHER_CATALOG_SQL_END: "-- END GENERATED FINISHER CATALOG",
  renderFinisherCatalogMigrationSql: () => mocks.expected,
}));

const start = "-- BEGIN GENERATED FINISHER CATALOG";
const end = "-- END GENERATED FINISHER CATALOG";
const canonicalSql = [
  start,
  "",
  'INSERT INTO "FinisherRoutine" ("id") VALUES (\'routine-1\');',
  "",
  end,
].join("\n");

function migrationWith(sql: string): string {
  return [`-- migration prefix`, sql, `-- migration suffix`].join("\n");
}

async function runVerifier(): Promise<void> {
  vi.resetModules();
  await import("../../../scripts/generate-finisher-catalog-sql");
}

beforeEach(() => {
  mocks.current = migrationWith(canonicalSql);
  mocks.expected = `${canonicalSql}\n`;
  mocks.writeFileSync.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Finisher catalog stale verification", () => {
  it("accepts identical LF SQL", async () => {
    await expect(runVerifier()).resolves.toBeUndefined();
  });

  it("accepts equivalent CRLF checkout SQL", async () => {
    mocks.current = migrationWith(canonicalSql).replaceAll("\n", "\r\n");

    expect(mocks.current).not.toContain(canonicalSql);
    await expect(runVerifier()).resolves.toBeUndefined();
  });

  it("accepts equivalent CR-only checkout SQL", async () => {
    mocks.current = migrationWith(canonicalSql).replaceAll("\n", "\r");

    await expect(runVerifier()).resolves.toBeUndefined();
  });

  it("rejects a meaningful SQL token change", async () => {
    mocks.current = migrationWith(canonicalSql.replace("routine-1", "routine-2"));

    await expect(runVerifier()).rejects.toThrow(
      "Finisher catalog migration SQL is stale"
    );
  });

  it("rejects meaningful whitespace changes", async () => {
    mocks.current = migrationWith(canonicalSql.replace("VALUES (", "VALUES  ("));

    await expect(runVerifier()).rejects.toThrow(
      "Finisher catalog migration SQL is stale"
    );
  });

  it.each([
    ["missing", canonicalSql.replace(/INSERT.*\n\n/, "")],
    ["truncated", canonicalSql.replace("routine-1');", "routine-")],
    ["extra", canonicalSql.replace(end, `SELECT 1;\n\n${end}`)],
  ])("rejects %s SQL content", async (_label, actualSql) => {
    mocks.current = migrationWith(actualSql);

    await expect(runVerifier()).rejects.toThrow(
      "Finisher catalog migration SQL is stale"
    );
  });

  it("reproduces the original raw-comparison failure", async () => {
    const crlfSql = canonicalSql.replaceAll("\n", "\r\n");

    expect(crlfSql).not.toBe(canonicalSql);
    mocks.current = migrationWith(crlfSql);
    await expect(runVerifier()).resolves.toBeUndefined();
  });
});

describe("Finisher catalog SQL renderer", () => {
  it("renders deterministic LF output", async () => {
    const { renderFinisherCatalogMigrationSql } = await vi.importActual<
      typeof import("../../../prisma/finisher-routine-migration-sql")
    >("../../../prisma/finisher-routine-migration-sql");

    const first = renderFinisherCatalogMigrationSql();
    const second = renderFinisherCatalogMigrationSql();

    expect(first).toBe(second);
    expect(first).not.toContain("\r");
    expect(first.endsWith("\n")).toBe(true);
  });
});
