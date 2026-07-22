import { describe, expect, it, vi } from "vitest";
import {
  formatProductionVersionVerification,
  parseProductionVersionVerificationArgs,
  productionVersionVerificationExitCode,
  verifyProductionVersion,
} from "./production-version-verification";

const COMMIT_SHA = "80b4e4bac0faf57dc15188556583908916aba8c4";
const BASE_URL = "https://trainer-app-indol.vercel.app";

describe("production version verification", () => {
  it("requires an HTTPS origin and a full expected Git SHA", () => {
    expect(() => parseProductionVersionVerificationArgs([])).toThrow("--base-url");
    expect(() =>
      parseProductionVersionVerificationArgs([
        "--base-url",
        "http://trainer-app-indol.vercel.app",
        "--expected-sha",
        COMMIT_SHA,
      ]),
    ).toThrow("valid HTTPS production origin");
    expect(() =>
      parseProductionVersionVerificationArgs([
        "--base-url",
        BASE_URL,
        "--expected-sha",
        "short",
      ]),
    ).toThrow("full 40-character Git SHA");
  });

  it("normalizes safe command arguments", () => {
    expect(
      parseProductionVersionVerificationArgs([
        `--base-url=${BASE_URL}/`,
        `--expected-sha=${COMMIT_SHA.toUpperCase()}`,
      ]),
    ).toEqual({ baseUrl: BASE_URL, expectedSha: COMMIT_SHA });
  });

  it("reports commit identity and alias HTTP 200 as separate passing evidence", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ commitSha: COMMIT_SHA }, { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await verifyProductionVersion(
      { baseUrl: BASE_URL, expectedSha: COMMIT_SHA },
      fetchImplementation,
    );

    expect(result.commitIdentity).toMatchObject({ ok: true, status: 200 });
    expect(result.aliasAvailability).toMatchObject({ ok: true, status: 200 });
    expect(productionVersionVerificationExitCode(result)).toBe(0);
    expect(formatProductionVersionVerification(result)).toEqual([
      `PASS commit identity: Commit SHA matches ${COMMIT_SHA}.`,
      "PASS alias availability: Production alias returned HTTP 200.",
    ]);
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      `${BASE_URL}/api/version`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      `${BASE_URL}/`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("fails clearly on a SHA mismatch while still checking alias availability", async () => {
    const otherSha = "1".repeat(40);
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ commitSha: otherSha }, { status: 200 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await verifyProductionVersion(
      { baseUrl: BASE_URL, expectedSha: COMMIT_SHA },
      fetchImplementation,
    );

    expect(result.commitIdentity).toMatchObject({
      ok: false,
      message: `Commit SHA mismatch: expected ${COMMIT_SHA}, received ${otherSha}.`,
    });
    expect(result.aliasAvailability.ok).toBe(true);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(productionVersionVerificationExitCode(result)).toBe(1);
  });

  it("rejects missing or expanded version contracts and reports alias failures independently", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ commitSha: COMMIT_SHA, environment: "production" }, { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    const result = await verifyProductionVersion(
      { baseUrl: BASE_URL, expectedSha: COMMIT_SHA },
      fetchImplementation,
    );

    expect(result.commitIdentity).toMatchObject({
      ok: false,
      message: "Version endpoint is missing the exact commitSha contract.",
    });
    expect(result.aliasAvailability).toMatchObject({
      ok: false,
      status: 503,
      message: "Production alias returned HTTP 503.",
    });
    expect(productionVersionVerificationExitCode(result)).toBe(1);
  });
});
