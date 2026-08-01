import { describe, expect, it } from "vitest";
import {
  assertProductionWriteAllowed,
  ProductionWritePausedError,
  productionWritePauseOperationId,
  productionWriteRuntimeEvidence,
  productionWriteStatus,
} from "./production-write-gate";

describe("production write gate", () => {
  it.each([undefined, "", "disabled", "false", "1"])(
    "allows writes when TRAINER_WRITE_PAUSE is %s",
    (value) => {
      const environment = { TRAINER_WRITE_PAUSE: value };
      expect(productionWriteStatus(environment)).toBe("ENABLED");
      expect(() => assertProductionWriteAllowed("set_logging", environment)).not.toThrow();
    },
  );

  it("blocks only the exact enabled value and carries the operation", () => {
    const environment = { TRAINER_WRITE_PAUSE: "enabled" };
    expect(productionWriteStatus(environment)).toBe("PAUSED");

    try {
      assertProductionWriteAllowed("workout_save", environment);
      throw new Error("expected write pause");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionWritePausedError);
      expect(error).toMatchObject({
        code: "PRODUCTION_WRITE_PAUSED",
        operation: "workout_save",
        message: "PRODUCTION_WRITE_PAUSED",
      });
      expect(JSON.stringify(error)).not.toContain("enabled");
    }
  });

  it("binds paused evidence to commit, deployment, environment, operation, and enforcement", () => {
    expect(
      productionWriteRuntimeEvidence("a".repeat(40), {
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
        VERCEL_DEPLOYMENT_ID: "dpl_paused",
        VERCEL_PROJECT_ID: "prj_trainer",
        TRAINER_WRITE_PAUSE: "enabled",
      }),
    ).toEqual({
      schema: "trainer-production-write-status",
      version: 2,
      environment: "production",
      commitSha: "a".repeat(40),
      deploymentId: "dpl_paused",
      pauseOperationId: `trainer-write-pause:prj_trainer:production:${"a".repeat(40)}:dpl_paused`,
      status: "PAUSED",
      enforcement: "application_all_classified_write_paths",
      enforcementContractVersion: 2,
    });
  });

  it("gives each project, commit, and deployment a distinct pause identity", () => {
    const base = {
      projectId: "prj_trainer",
      environment: "production" as const,
      commitSha: "a".repeat(40),
      deploymentId: "dpl_one",
    };
    const identities = [
      productionWritePauseOperationId(base),
      productionWritePauseOperationId({ ...base, projectId: "prj_other" }),
      productionWritePauseOperationId({ ...base, commitSha: "b".repeat(40) }),
      productionWritePauseOperationId({ ...base, deploymentId: "dpl_two" }),
    ];
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("rejects a commit that does not match the deployment", () => {
    expect(() =>
      productionWriteRuntimeEvidence("b".repeat(40), {
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
        VERCEL_DEPLOYMENT_ID: "dpl_paused",
        VERCEL_PROJECT_ID: "prj_trainer",
        TRAINER_WRITE_PAUSE: "enabled",
      }),
    ).toThrow("commit binding");
  });
});
