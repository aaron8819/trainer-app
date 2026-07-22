import { describe, expect, it } from "vitest";
import { getDeploymentVersion } from "./deployment-version";

const COMMIT_SHA = "80b4e4bac0faf57dc15188556583908916aba8c4";

describe("deployment version", () => {
  it("returns the configured Vercel commit SHA as the only public field", () => {
    const version = getDeploymentVersion({
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: COMMIT_SHA.toUpperCase(),
      TRAINER_BUILD_GIT_SHA: "1".repeat(40),
    });

    expect(version).toEqual({ commitSha: COMMIT_SHA });
    expect(Object.keys(version)).toEqual(["commitSha"]);
  });

  it("uses the repository build SHA when Vercel commit metadata is unavailable", () => {
    expect(
      getDeploymentVersion({
        NODE_ENV: "production",
        TRAINER_BUILD_GIT_SHA: COMMIT_SHA,
      }),
    ).toEqual({ commitSha: COMMIT_SHA });
  });

  it("returns an explicit local fallback when deployment metadata is unavailable", () => {
    expect(
      getDeploymentVersion({
        NODE_ENV: "development",
        VERCEL: undefined,
        VERCEL_ENV: undefined,
        VERCEL_GIT_COMMIT_SHA: undefined,
      }),
    ).toEqual({ commitSha: "unknown" });
  });

  it.each([undefined, "not-a-sha"])(
    "fails closed when a Vercel deployment has an unavailable SHA (%s)",
    (commitSha) => {
      expect(() =>
        getDeploymentVersion({
          VERCEL: "1",
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_SHA: commitSha,
          NODE_ENV: "production",
        }),
      ).toThrow("Deployment commit SHA is unavailable.");
    },
  );
});
