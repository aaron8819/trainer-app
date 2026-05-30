import { describe, expect, it, vi } from "vitest";
import {
  buildAuditCommandArgs,
  buildNpmCommandInvocation,
  buildRefreshRouteUrl,
  commandArgsContainAcceptRoute,
  compareSafetyCounts,
  formatFinalAuditSummary,
  formatOriginValidationResult,
  formatRefreshSummary,
  interpretAcceptanceDecision,
  parseFinalAuditSummary,
  parseOpsRefreshNextSeedDraftArgs,
  summarizeRefreshResponse,
  validateTrainerOrigin,
  type SafetyCounts,
} from "../../../scripts/ops-refresh-next-seed-draft";

function counts(overrides: Partial<SafetyCounts> = {}): SafetyCounts {
  return {
    mesocycleCount: 2,
    successorCount: 0,
    workoutCount: 12,
    setLogCount: 96,
    sessionCheckInCount: 5,
    ...overrides,
  };
}

describe("ops refresh-next-seed-draft argument parsing", () => {
  it("requires explicit origin, owner, and source mesocycle id", () => {
    expect(() => parseOpsRefreshNextSeedDraftArgs([])).toThrow(
      "Missing required --origin",
    );
    expect(() =>
      parseOpsRefreshNextSeedDraftArgs(["--origin", "http://localhost:3100"]),
    ).toThrow("Missing required --owner");
    expect(() =>
      parseOpsRefreshNextSeedDraftArgs([
        "--origin",
        "http://localhost:3100",
        "--owner",
        "owner@test.local",
      ]),
    ).toThrow("Missing required --source-mesocycle-id");
  });

  it("normalizes the origin and reads the explicit owner/source", () => {
    expect(
      parseOpsRefreshNextSeedDraftArgs([
        "--origin",
        "http://localhost:3100/path?x=1",
        "--owner",
        "owner@test.local",
        "--source-mesocycle-id",
        "meso-1",
      ]),
    ).toMatchObject({
      origin: "http://localhost:3100",
      owner: "owner@test.local",
      sourceMesocycleId: "meso-1",
      allowNonV2DraftSource: false,
    });
  });
});

describe("ops refresh-next-seed-draft origin validation", () => {
  it("accepts the safest current Trainer app identity signal", async () => {
    const result = await validateTrainerOrigin({
      origin: "http://localhost:3100",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response("<title>Personal AI Trainer</title>", { status: 200 }),
      ),
    });

    expect(result).toMatchObject({
      ok: true,
      signal: "home_page_title",
    });
    expect(formatOriginValidationResult(result).join("\n")).toContain(
      "trainer_app=yes",
    );
  });

  it("fails wrong origins before a refresh route call is allowed", async () => {
    const refreshRoute = vi.fn();
    const result = await validateTrainerOrigin({
      origin: "http://localhost:3000",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response("<title>Recipe Genie</title>", { status: 200 }),
      ),
    });

    if (!result.ok) {
      // This mirrors the live script's gate: no refresh call after a failed app identity check.
      expect(refreshRoute).not.toHaveBeenCalled();
      expect(formatOriginValidationResult(result).join("\n")).toContain(
        "trainer_app=no",
      );
      return;
    }

    refreshRoute();
    expect(refreshRoute).not.toHaveBeenCalled();
  });
});

describe("ops refresh-next-seed-draft compact summaries", () => {
  it("compacts a successful refresh response", () => {
    const summary = summarizeRefreshResponse({
      responseBody: {
        ok: true,
        seedDraft: {
          source: "v2_materialized_seed",
          slotCount: 4,
          exerciseCount: 18,
          minimalExecutableRowsOnly: true,
        },
      },
      beforeDraftSeedHash: "old",
      afterDraftSeedHash: "new",
      afterDraftSource: "v2_materialized_seed",
      afterDraftRefreshedAt: "2026-05-30T12:00:00.000Z",
    });

    expect(summary).toEqual({
      ok: true,
      draftSource: "v2_materialized_seed",
      refreshedAt: "2026-05-30T12:00:00.000Z",
      slotCount: 4,
      exerciseRowCount: 18,
      seedHashChanged: "yes",
      minimalExecutableRows: true,
    });
    expect(formatRefreshSummary(summary)).toEqual(
      expect.arrayContaining([
        "draft_source=v2_materialized_seed",
        "seed_hash_changed=yes",
        "minimal_executable_rows=yes",
      ]),
    );
  });

  it("detects unexpected successor, workout, log, and session count changes", () => {
    const comparison = compareSafetyCounts({
      before: counts(),
      after: counts({
        successorCount: 1,
        workoutCount: 13,
        setLogCount: 97,
        sessionCheckInCount: 6,
      }),
    });

    expect(comparison.ok).toBe(false);
    expect(comparison.violations).toEqual(
      expect.arrayContaining([
        "successorCount: 0 -> 1",
        "workoutCount: 12 -> 13",
        "setLogCount: 96 -> 97",
        "sessionCheckInCount: 5 -> 6",
      ]),
    );
  });
});

describe("ops refresh-next-seed-draft audit interpretation", () => {
  it("treats accepted and accepted_with_watch_items as successful decisions", () => {
    expect(interpretAcceptanceDecision("accepted")).toEqual({
      decision: "accepted",
      exitCode: 0,
    });
    expect(interpretAcceptanceDecision("accepted_with_watch_items")).toEqual({
      decision: "accepted_with_watch_items",
      exitCode: 0,
    });
  });

  it("treats rejected and not_runnable as nonzero decisions", () => {
    expect(interpretAcceptanceDecision("rejected")).toEqual({
      decision: "rejected",
      exitCode: 1,
    });
    expect(interpretAcceptanceDecision("not_runnable")).toEqual({
      decision: "not_runnable",
      exitCode: 1,
    });
  });

  it("extracts final operator summary fields from paired audit stdout", () => {
    const summary = parseFinalAuditSummary({
      handoffStdout: "handoff_ready=yes\n",
      acceptanceStdout: [
        "final decision: accepted_with_watch_items",
        "recommendation: accept only after reviewing watch items",
        "Finding | Severity | Owner seam | Smallest safe fix | Must fix before Week 1 | Evidence",
        "Rear Delts floor | high_risk | materializer | restore direct row | yes | projected below MEV",
        "",
        "Risk | Why it matters | Monitoring plan",
        "Triceps floor margin | thin floor | check Week 1",
        "",
        "Muscle | Projected sets | MEV | Productive/Target | MAV | Status | Severity | Notes",
        "Rear Delts | 4 | 6 | 8 | 12 | below_mev | high_risk | floor miss",
        "Chest | 18 | 10 | 14 | 16 | over_mav | warning | cap caution",
        "",
      ].join("\n"),
    });

    expect(formatFinalAuditSummary(summary)).toEqual(
      expect.arrayContaining([
        "handoff_ready=yes",
        "acceptance_decision=accepted_with_watch_items",
        "hard_floor_status=fail: Rear Delts | 4 | 6 | 8 | 12 | below_mev | high_risk | floor miss",
        "over_mav_status=warning: Chest | 18 | 10 | 14 | 16 | over_mav | warning | cap caution",
      ]),
    );
  });
});

describe("ops refresh-next-seed-draft route and audit command boundaries", () => {
  it("builds only the refresh route for mutation", () => {
    expect(
      buildRefreshRouteUrl({
        origin: "http://localhost:3100",
        sourceMesocycleId: "meso/1",
      }),
    ).toBe(
      "http://localhost:3100/api/mesocycles/meso%2F1/refresh-next-seed-draft",
    );
  });

  it("builds paired no-artifact audit commands and never calls accept-next-cycle", () => {
    const handoff = buildAuditCommandArgs({
      mode: "next-mesocycle-handoff-dry-run",
      owner: "owner@test.local",
      sourceMesocycleId: "meso-1",
    });
    const gate = buildAuditCommandArgs({
      mode: "next-mesocycle-acceptance-gate",
      owner: "owner@test.local",
      sourceMesocycleId: "meso-1",
    });

    expect(handoff.join(" ")).toContain(
      "--mode next-mesocycle-handoff-dry-run",
    );
    expect(gate.join(" ")).toContain(
      "--mode next-mesocycle-acceptance-gate",
    );
    expect(handoff).toEqual(expect.arrayContaining(["--no-artifact"]));
    expect(gate).toEqual(expect.arrayContaining(["--operator-debug"]));
    expect(commandArgsContainAcceptRoute([...handoff, ...gate])).toBe(false);
  });

  it("routes nested npm audit commands through cmd on Windows", () => {
    const invocation = buildNpmCommandInvocation(
      ["run", "audit:workout", "--", "--help"],
      "win32",
    );

    expect(invocation).toEqual({
      command: "cmd.exe",
      args: ["/c", "npm", "run", "audit:workout", "--", "--help"],
    });
  });

  it("uses npm directly on non-Windows platforms", () => {
    expect(
      buildNpmCommandInvocation(["run", "audit:workout"], "linux"),
    ).toEqual({
      command: "npm",
      args: ["run", "audit:workout"],
    });
  });
});
