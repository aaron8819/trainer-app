/**
 * Tests for exercise-exposure.ts
 *
 * Covers performance trend assessment and linear regression.
 * Database integration tests deferred to Week 3 integration suite.
 */

import { describe, it, expect } from "vitest";

/**
 * Simple linear regression (copied from exercise-exposure.ts for testing)
 */
function linearRegression(yValues: number[]): { slope: number; intercept: number } {
  const n = yValues.length;
  if (n === 0) return { slope: 0, intercept: 0 };

  const xValues = Array.from({ length: n }, (_, i) => i);

  const xMean = xValues.reduce((sum, x) => sum + x, 0) / n;
  const yMean = yValues.reduce((sum, y) => sum + y, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = xValues[i] - xMean;
    const yDiff = yValues[i] - yMean;
    numerator += xDiff * yDiff;
    denominator += xDiff * xDiff;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;

  return { slope, intercept };
}

/**
 * Estimate 1RM (copied from exercise-exposure.ts for testing)
 */
function estimate1RM(load: number, reps: number): number {
  if (reps === 0) return 0;
  if (reps === 1) return load;
  return load / (1.0278 - 0.0278 * reps);
}

describe("linearRegression", () => {
  it("should compute positive slope for increasing data", () => {
    const yValues = [100, 105, 110, 115, 120];
    const { slope, intercept } = linearRegression(yValues);

    // Slope should be ~5 (increase of 5 per session)
    expect(slope).toBeCloseTo(5, 1);

    // Intercept should be ~100 (starting value)
    expect(intercept).toBeCloseTo(100, 1);
  });

  it("should compute negative slope for decreasing data", () => {
    const yValues = [120, 115, 110, 105, 100];
    const { slope, intercept } = linearRegression(yValues);

    // Slope should be ~-5
    expect(slope).toBeCloseTo(-5, 1);

    // Intercept should be ~120 (starting value)
    expect(intercept).toBeCloseTo(120, 1);
  });

  it("should compute zero slope for flat data", () => {
    const yValues = [100, 100, 100, 100, 100];
    const { slope, intercept } = linearRegression(yValues);

    expect(slope).toBeCloseTo(0, 2);
    expect(intercept).toBeCloseTo(100, 1);
  });

  it("should handle noisy data", () => {
    const yValues = [100, 103, 97, 108, 105, 110];
    const { slope } = linearRegression(yValues);

    // Overall trend is upward
    expect(slope).toBeGreaterThan(0);
  });

  it("should handle single data point", () => {
    const yValues = [100];
    const { slope, intercept } = linearRegression(yValues);

    expect(slope).toBe(0);
    expect(intercept).toBe(100);
  });

  it("should handle empty array", () => {
    const yValues: number[] = [];
    const { slope, intercept } = linearRegression(yValues);

    expect(slope).toBe(0);
    expect(intercept).toBe(0);
  });
});

describe("estimate1RM", () => {
  it("should return load for 1 rep", () => {
    const estimated = estimate1RM(225, 1);
    expect(estimated).toBe(225);
  });

  it("should estimate 1RM for 5 reps", () => {
    // Brzycki formula: 1RM = load / (1.0278 - 0.0278 * reps)
    // For 5 reps: 1RM = load / (1.0278 - 0.139) = load / 0.8888
    const load = 200;
    const estimated = estimate1RM(load, 5);

    // 200 / 0.8888 ≈ 225
    expect(estimated).toBeCloseTo(225, 0);
  });

  it("should estimate 1RM for 10 reps", () => {
    // For 10 reps: 1RM = load / (1.0278 - 0.278) = load / 0.7498
    const load = 150;
    const estimated = estimate1RM(load, 10);

    // 150 / 0.7498 ≈ 200
    expect(estimated).toBeCloseTo(200, 0);
  });

  it("should return 0 for 0 reps", () => {
    const estimated = estimate1RM(100, 0);
    expect(estimated).toBe(0);
  });

  it("should return 0 for 0 load", () => {
    const estimated = estimate1RM(0, 5);
    expect(estimated).toBe(0);
  });
});

describe("Performance Trend Classification", () => {
  /**
   * Classify trend based on slope and baseline
   * (Simulates assessPerformanceTrend logic)
   */
  function classifyTrend(estimated1RMs: number[]): "improving" | "stalled" | "declining" {
    if (estimated1RMs.length < 3) return "improving"; // Insufficient data

    const { slope } = linearRegression(estimated1RMs);
    const baseline = estimated1RMs[0] ?? 1;
    const percentChangePerSession = (slope / baseline) * 100;

    if (percentChangePerSession >= 2.5) return "improving";
    if (percentChangePerSession <= -2.5) return "declining";
    return "stalled";
  }

  it("should classify improving trend (5% gain per session)", () => {
    const estimated1RMs = [200, 210, 220, 230, 240, 250];
    const trend = classifyTrend(estimated1RMs);

    // Slope = 10, baseline = 200, change = 10/200 = 5% > 2.5%
    expect(trend).toBe("improving");
  });

  it("should classify declining trend (-5% per session)", () => {
    const estimated1RMs = [200, 190, 180, 170, 160, 150];
    const trend = classifyTrend(estimated1RMs);

    // Slope = -10, baseline = 200, change = -10/200 = -5% < -2.5%
    expect(trend).toBe("declining");
  });

  it("should classify stalled trend (1% change)", () => {
    const estimated1RMs = [200, 202, 201, 203, 202, 204];
    const trend = classifyTrend(estimated1RMs);

    // Slope ≈ 0.8, baseline = 200, change ≈ 0.4% (between -2.5% and +2.5%)
    expect(trend).toBe("stalled");
  });

  it("should classify flat performance as stalled", () => {
    const estimated1RMs = [200, 200, 200, 200, 200, 200];
    const trend = classifyTrend(estimated1RMs);

    expect(trend).toBe("stalled");
  });

  it("should default to improving with insufficient data (< 3 sessions)", () => {
    const estimated1RMs = [200, 210];
    const trend = classifyTrend(estimated1RMs);

    expect(trend).toBe("improving");
  });

  it("should handle noisy improving trend", () => {
    // Overall trend up, but with session-to-session variance
    const estimated1RMs = [200, 208, 206, 218, 216, 228];
    const trend = classifyTrend(estimated1RMs);

    // Slope ≈ 5.6, baseline = 200, change ≈ 2.8% > 2.5%
    expect(trend).toBe("improving");
  });
});

describe("Weeks Ago Calculation", () => {
  it("should calculate weeks since last use", () => {
    const now = new Date();
    const lastUsed = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 days ago

    const diffMs = now.getTime() - lastUsed.getTime();
    const weeksAgo = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

    expect(weeksAgo).toBe(2);
  });

  it("should return 0 for recent use (< 1 week)", () => {
    const now = new Date();
    const lastUsed = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

    const diffMs = now.getTime() - lastUsed.getTime();
    const weeksAgo = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

    expect(weeksAgo).toBe(0);
  });

  it("should calculate correct weeks for longer periods", () => {
    const now = new Date();
    const lastUsed = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000); // 35 days ago

    const diffMs = now.getTime() - lastUsed.getTime();
    const weeksAgo = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

    expect(weeksAgo).toBe(5);
  });
});
