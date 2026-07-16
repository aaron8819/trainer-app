import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOperationalProductionWriteAllowed,
  loadRolloutEnvironment,
  runWithRolloutEnvironment,
  sanitizedRolloutEnvironment,
} from "./rollout-environment";

const roots: string[] = [];

function fixture(name: string, contents: string): { cwd: string; path: string } {
  const cwd = join(tmpdir(), `trainer-rollout-${name}-${crypto.randomUUID()}`);
  mkdirSync(cwd, { recursive: true });
  roots.push(cwd);
  const path = join(cwd, `${name}.env`);
  writeFileSync(path, contents);
  return { cwd, path };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("rollout environment ownership", () => {
  it("fails when --env-file is missing and never loads .env implicitly", () => {
    const { cwd } = fixture("ignored", "DATABASE_URL=postgresql://localhost/ignored\n");
    writeFileSync(join(cwd, ".env"), "DATABASE_URL=postgresql://localhost/implicit\n");
    expect(() =>
      loadRolloutEnvironment({ argv: [], allowWrite: true, cwd, environment: {} }),
    ).toThrow("Missing required --env-file");
  });

  it("loads an explicit local environment", () => {
    const { cwd, path } = fixture(
      "local",
      "DATABASE_URL=postgresql://trainer:secret@127.0.0.1:5432/trainer\n",
    );
    const result = loadRolloutEnvironment({
      argv: ["--env-file", path],
      allowWrite: true,
      cwd,
      environment: {},
    });
    expect(result.targetClass).toBe("local");
    expect(result.writeEnabled).toBe(false);
  });

  it("does not inherit a target variable missing from the explicit file", () => {
    const { cwd, path } = fixture("missing-database", "OWNER_EMAIL=owner@test.invalid\n");
    expect(() =>
      loadRolloutEnvironment({
        argv: ["--env-file", path],
        allowWrite: false,
        cwd,
        environment: { DATABASE_URL: "postgresql://configured-remote.invalid/trainer" },
      }),
    ).toThrow("explicitly named environment file must define DATABASE_URL");
  });

  it("allows an explicit remote dry run", () => {
    const { cwd, path } = fixture(
      "remote",
      "DATABASE_URL=postgresql://trainer:secret@db.example.test:5432/trainer\n",
    );
    expect(
      loadRolloutEnvironment({
        argv: ["--env-file", path],
        allowWrite: true,
        cwd,
        environment: {},
      }).targetClass,
    ).toBe("remote");
  });

  it("blocks remote writes without acknowledgment", () => {
    const { cwd, path } = fixture(
      "blocked",
      "DATABASE_URL=postgresql://trainer:secret@db.example.test:5432/trainer\n",
    );
    expect(() =>
      loadRolloutEnvironment({
        argv: ["--env-file", path, "--write"],
        allowWrite: true,
        cwd,
        environment: {},
      }),
    ).toThrow("Remote --write requires --confirm-remote-write");
  });

  it("reaches the operation gate for an acknowledged remote write", async () => {
    const { cwd, path } = fixture(
      "acknowledged",
      "DATABASE_URL=postgresql://trainer:secret@db.example.test:5432/trainer\n",
    );
    const operation = vi.fn(async () => "reached");
    await expect(
      runWithRolloutEnvironment(
        {
          argv: ["--env-file", path, "--write", "--confirm-remote-write"],
          allowWrite: true,
          cwd,
          environment: {},
        },
        operation,
      ),
    ).resolves.toBe("reached");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("blocks an acknowledged remote write before invoking the operation when paused", async () => {
    const { cwd, path } = fixture(
      "paused-remote",
      [
        "DATABASE_URL=postgresql://trainer:secret@db.example.test:5432/trainer",
        "TRAINER_WRITE_PAUSE=enabled",
        "",
      ].join("\n"),
    );
    const operation = vi.fn(async () => "unreachable");

    await expect(
      runWithRolloutEnvironment(
        {
          argv: ["--env-file", path, "--write", "--confirm-remote-write"],
          allowWrite: true,
          cwd,
          environment: {},
        },
        operation,
      ),
    ).rejects.toMatchObject({
      code: "PRODUCTION_WRITE_PAUSED",
      operation: "operational_backfill",
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it("treats a missing pause value in the explicit remote file as enabled", async () => {
    const { cwd, path } = fixture(
      "remote-missing-pause",
      "DATABASE_URL=postgresql://trainer:secret@db.example.test:5432/trainer\n",
    );
    const operation = vi.fn(async () => "reached");

    await expect(
      runWithRolloutEnvironment(
        {
          argv: ["--env-file", path, "--write", "--confirm-remote-write"],
          allowWrite: true,
          cwd,
          environment: { TRAINER_WRITE_PAUSE: "enabled" },
        },
        operation,
      ),
    ).resolves.toBe("reached");
    expect(operation).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "remote dry run", url: "postgresql://trainer:secret@db.example.test/trainer", argv: [] },
    { name: "local write", url: "postgresql://trainer:secret@127.0.0.1/trainer", argv: ["--write"] },
    {
      name: "disposable write",
      url: "postgresql://trainer:secret@127.0.0.1/trainer",
      argv: ["--write", "--confirm-disposable"],
    },
  ])("allows a paused $name target", async ({ url, argv }) => {
    const { cwd, path } = fixture(
      "paused-allowed",
      `DATABASE_URL=${url}\nTRAINER_WRITE_PAUSE=enabled\n`,
    );
    const operation = vi.fn(async () => "reached");

    await expect(
      runWithRolloutEnvironment(
        {
          argv: ["--env-file", path, ...argv],
          allowWrite: true,
          cwd,
          environment: {},
        },
        operation,
      ),
    ).resolves.toBe("reached");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("never includes credentials or connection strings in sanitized output", () => {
    const { cwd, path } = fixture(
      "sanitized",
      "DATABASE_URL=postgresql://trainer:super-secret@db.example.test:5432/trainer\n",
    );
    const result = loadRolloutEnvironment({
      argv: ["--env-file", path],
      allowWrite: true,
      cwd,
      environment: {},
    });
    const output = JSON.stringify(sanitizedRolloutEnvironment(result));
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("postgresql://");
    expect(output).not.toContain("db.example.test");
  });

  it("applies the pause to legacy explicit remote write modes without connecting", () => {
    expect(() =>
      assertOperationalProductionWriteAllowed({
        argv: ["--apply", "--confirm-remote-write"],
        writeRequested: true,
        environment: {
          DATABASE_URL: "postgresql://trainer:secret@db.example.test/trainer",
          TRAINER_WRITE_PAUSE: "enabled",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "PRODUCTION_WRITE_PAUSED" }));
  });

  it("leaves legacy dry runs and local/disposable writes available while paused", () => {
    const remote = {
      DATABASE_URL: "postgresql://trainer:secret@db.example.test/trainer",
      TRAINER_WRITE_PAUSE: "enabled",
    };
    const local = {
      DATABASE_URL: "postgresql://trainer:secret@127.0.0.1/trainer",
      TRAINER_WRITE_PAUSE: "enabled",
    };
    expect(() =>
      assertOperationalProductionWriteAllowed({ argv: [], writeRequested: false, environment: remote }),
    ).not.toThrow();
    expect(() =>
      assertOperationalProductionWriteAllowed({ argv: ["--apply"], writeRequested: true, environment: local }),
    ).not.toThrow();
  });

  it("loads the environment before invoking the database importer", async () => {
    const { cwd, path } = fixture(
      "ordering",
      "DATABASE_URL=postgresql://trainer:secret@127.0.0.1:5432/trainer\n",
    );
    const environment: Record<string, string | undefined> = {};
    await runWithRolloutEnvironment(
      { argv: ["--env-file", path], allowWrite: true, cwd, environment },
      async () => {
        expect(environment.DATABASE_URL).toContain("127.0.0.1");
      },
    );
  });
});
