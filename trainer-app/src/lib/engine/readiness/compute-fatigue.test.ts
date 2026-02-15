import { describe, it, expect } from 'vitest';
import {
  computeFatigueScore,
  getFatigueLevelLabel,
  generateFatigueRationale,
} from './compute-fatigue';
import type { ReadinessSignal } from './types';

describe('computeFatigueScore', () => {
  describe('Whoop available scenarios', () => {
    it('should return high fatigue score (>0.8) for excellent Whoop recovery', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        whoop: {
          recovery: 95, // Excellent recovery
          strain: 12, // Moderate strain
          hrv: 65, // Good HRV
          sleepQuality: 90, // Great sleep
          sleepDuration: 8,
        },
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      expect(result.overall).toBeGreaterThan(0.8);
      expect(result.weights.whoop).toBe(0.5);
      expect(result.weights.subjective).toBe(0.3);
      expect(result.weights.performance).toBe(0.2);
    });

    it('should return low fatigue score (<0.5) for poor Whoop recovery', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        whoop: {
          recovery: 20, // Very low recovery
          strain: 19, // High strain (overreach)
          hrv: 25, // Poor HRV
          sleepQuality: 30, // Bad sleep
          sleepDuration: 5,
        },
        subjective: {
          readiness: 2,
          motivation: 2,
          soreness: {}, // Empty soreness → worst muscle = 1.0 (fresh)
        },
        performance: {
          rpeDeviation: 2, // Sessions felt harder
          stallCount: 2,
          volumeComplianceRate: 0.7,
        },
      };

      const result = computeFatigueScore(signal);

      // With per-muscle penalty: baseScore * 0.8 + 1.0 * 0.2
      // Empty soreness defaults to fresh (1.0), so adds 20% boost
      expect(result.overall).toBeLessThan(0.5);
    });

    it('should penalize high strain (>18)', () => {
      const signalLowStrain: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        whoop: {
          recovery: 80,
          strain: 15, // Normal strain
          hrv: 50,
          sleepQuality: 80,
          sleepDuration: 7,
        },
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const signalHighStrain: ReadinessSignal = {
        ...signalLowStrain,
        whoop: {
          ...signalLowStrain.whoop!,
          strain: 19, // Overreach strain
        },
      };

      const resultLow = computeFatigueScore(signalLowStrain);
      const resultHigh = computeFatigueScore(signalHighStrain);

      // High strain should lower overall score
      expect(resultHigh.overall).toBeLessThan(resultLow.overall);
    });
  });

  describe('No Whoop scenarios', () => {
    it('should adjust weights when Whoop unavailable (subjective 0.6, performance 0.4)', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      expect(result.weights.whoop).toBe(0);
      expect(result.weights.subjective).toBe(0.6);
      expect(result.weights.performance).toBe(0.4);
    });

    it('should compute reasonable score with only subjective data', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 5,
          motivation: 5,
          soreness: {},
          stress: 1, // Low stress
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      expect(result.overall).toBeGreaterThan(0.8); // High readiness + motivation + low stress
    });
  });

  describe('Subjective scoring', () => {
    it('should compute score from readiness and motivation only (stress removed)', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 5, // Max readiness
          motivation: 5, // Max motivation
          soreness: {}, // Empty → worst muscle = 1.0 (fresh)
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      // With max readiness (5) and max motivation (5), subjective score should be 1.0
      // Subjective: (5-1)/4 * 0.6 + (5-1)/4 * 0.4 = 1.0 * 0.6 + 1.0 * 0.4 = 1.0
      // Performance: 0.75 (neutral)
      // Base score: 1.0 * 0.6 + 0.75 * 0.4 = 0.9
      // With per-muscle penalty: 0.9 * 0.8 + 1.0 * 0.2 = 0.72 + 0.2 = 0.92
      expect(result.overall).toBeCloseTo(0.92, 2);
    });
  });

  describe('Performance scoring', () => {
    it('should penalize positive RPE deviation (sessions felt harder)', () => {
      const easySignal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: -1, // Sessions felt easier
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const hardSignal: ReadinessSignal = {
        ...easySignal,
        performance: {
          rpeDeviation: 2, // Sessions felt harder
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const resultEasy = computeFatigueScore(easySignal);
      const resultHard = computeFatigueScore(hardSignal);

      // Positive RPE deviation should lower score
      expect(resultHard.overall).toBeLessThan(resultEasy.overall);
    });

    it('should penalize stalls (multiple stalled exercises)', () => {
      const noStallSignal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const manyStallsSignal: ReadinessSignal = {
        ...noStallSignal,
        performance: {
          ...noStallSignal.performance,
          stallCount: 3,
        },
      };

      const resultNoStall = computeFatigueScore(noStallSignal);
      const resultManyStalls = computeFatigueScore(manyStallsSignal);

      // Stalls should lower score
      expect(resultManyStalls.overall).toBeLessThan(resultNoStall.overall);
    });

    it('should cap stall penalty at 0.3 (3+ stalled exercises)', () => {
      const signal3Stalls: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 3,
          volumeComplianceRate: 1.0,
        },
      };

      const signal10Stalls: ReadinessSignal = {
        ...signal3Stalls,
        performance: {
          ...signal3Stalls.performance,
          stallCount: 10,
        },
      };

      const result3 = computeFatigueScore(signal3Stalls);
      const result10 = computeFatigueScore(signal10Stalls);

      // Should be equal (penalty capped)
      expect(Math.abs(result3.overall - result10.overall)).toBeLessThan(0.01);
    });

    it('should reward high volume compliance', () => {
      const highComplianceSignal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0, // 100% compliance
        },
      };

      const lowComplianceSignal: ReadinessSignal = {
        ...highComplianceSignal,
        performance: {
          ...highComplianceSignal.performance,
          volumeComplianceRate: 0.5, // 50% compliance
        },
      };

      const resultHigh = computeFatigueScore(highComplianceSignal);
      const resultLow = computeFatigueScore(lowComplianceSignal);

      // High compliance should increase score
      expect(resultHigh.overall).toBeGreaterThan(resultLow.overall);
    });
  });

  describe('Per-muscle fatigue', () => {
    it('should map soreness to per-muscle fatigue correctly', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {
            chest: 1, // No soreness → fatigue = 1.0
            legs: 2, // Moderate → fatigue = 0.5
            back: 3, // Very sore → fatigue = 0.0
          },
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      expect(result.perMuscle.chest).toBe(1.0); // Fresh
      expect(result.perMuscle.legs).toBe(0.5); // Moderate fatigue
      expect(result.perMuscle.back).toBe(0.0); // Exhausted
    });

    it('should handle empty soreness map', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      expect(Object.keys(result.perMuscle).length).toBe(0);
    });

    it('should apply per-muscle penalty when one muscle is very sore', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'test-user',
        subjective: {
          readiness: 5, // Max readiness
          motivation: 5, // Max motivation
          soreness: { quads: 3, hamstrings: 1 }, // Quads very sore, hamstrings fresh
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      // Without penalty: subjective score = 1.0 (readiness 5, motivation 5)
      // Subjective: (5-1)/4 * 0.6 + (5-1)/4 * 0.4 = 1.0
      // Performance: 0.75 (neutral)
      // Base score: 1.0 * 0.6 + 0.75 * 0.4 = 0.9
      // With penalty: 0.9 * 0.8 + 0.0 (quads fatigue) * 0.2 = 0.72
      expect(result.overall).toBeCloseTo(0.72, 2);
      expect(result.perMuscle.quads).toBe(0.0); // Very sore
      expect(result.perMuscle.hamstrings).toBe(1.0); // Fresh
    });

    it('should not apply significant penalty when all muscles are fresh', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'test-user',
        subjective: {
          readiness: 5, // Max readiness
          motivation: 5, // Max motivation
          soreness: { quads: 1, hamstrings: 1 }, // All fresh
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      // Base score: 0.9 (same as above)
      // Worst muscle fatigue: 1.0 (all fresh)
      // With penalty: 0.9 * 0.8 + 1.0 * 0.2 = 0.72 + 0.2 = 0.92
      expect(result.overall).toBeCloseTo(0.92, 2);
      expect(result.perMuscle.quads).toBe(1.0); // Fresh
      expect(result.perMuscle.hamstrings).toBe(1.0); // Fresh
    });
  });

  describe('Component breakdown', () => {
    it('should apply per-muscle penalty after component integration', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        whoop: {
          recovery: 70,
          strain: 14,
          hrv: 45,
          sleepQuality: 75,
          sleepDuration: 7,
        },
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {}, // Empty → worst muscle = 1.0 (fresh)
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      const componentSum =
        result.components.whoopContribution +
        result.components.subjectiveContribution +
        result.components.performanceContribution;

      // Component sum is the base score (before per-muscle penalty)
      // Overall = baseScore * 0.8 + worstMuscleFatigue * 0.2
      // With empty soreness: overall = baseScore * 0.8 + 1.0 * 0.2
      const expectedOverall = componentSum * 0.8 + 1.0 * 0.2;
      expect(result.overall).toBeCloseTo(expectedOverall, 3);
    });

    it('should return zero whoop contribution when Whoop unavailable', () => {
      const signal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        subjective: {
          readiness: 4,
          motivation: 4,
          soreness: {},
        },
        performance: {
          rpeDeviation: 0,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const result = computeFatigueScore(signal);

      expect(result.components.whoopContribution).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should clamp overall score to [0, 1]', () => {
      // Extreme low scenario
      const lowSignal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        whoop: {
          recovery: 0,
          strain: 21,
          hrv: 0,
          sleepQuality: 0,
          sleepDuration: 3,
        },
        subjective: {
          readiness: 1,
          motivation: 1,
          soreness: {},
          stress: 5,
        },
        performance: {
          rpeDeviation: 4,
          stallCount: 10,
          volumeComplianceRate: 0,
        },
      };

      const resultLow = computeFatigueScore(lowSignal);
      expect(resultLow.overall).toBeGreaterThanOrEqual(0);
      expect(resultLow.overall).toBeLessThanOrEqual(1);

      // Extreme high scenario
      const highSignal: ReadinessSignal = {
        timestamp: new Date(),
        userId: 'user-1',
        whoop: {
          recovery: 100,
          strain: 5,
          hrv: 100,
          sleepQuality: 100,
          sleepDuration: 10,
        },
        subjective: {
          readiness: 5,
          motivation: 5,
          soreness: {},
          stress: 1,
        },
        performance: {
          rpeDeviation: -2,
          stallCount: 0,
          volumeComplianceRate: 1.0,
        },
      };

      const resultHigh = computeFatigueScore(highSignal);
      expect(resultHigh.overall).toBeGreaterThanOrEqual(0);
      expect(resultHigh.overall).toBeLessThanOrEqual(1);
    });
  });
});

describe('getFatigueLevelLabel', () => {
  it('should return correct labels for different score ranges', () => {
    expect(getFatigueLevelLabel(0.9)).toBe('very fresh');
    expect(getFatigueLevelLabel(0.7)).toBe('recovered');
    expect(getFatigueLevelLabel(0.5)).toBe('moderately fatigued');
    expect(getFatigueLevelLabel(0.3)).toBe('significantly fatigued');
    expect(getFatigueLevelLabel(0.1)).toBe('significantly fatigued');
  });
});

describe('generateFatigueRationale', () => {
  it('should include overall percentage and level', () => {
    const fatigueScore = {
      overall: 0.65,
      perMuscle: {},
      weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
      components: {
        whoopContribution: 0,
        subjectiveContribution: 0.4,
        performanceContribution: 0.25,
      },
    };

    const rationale = generateFatigueRationale(fatigueScore);

    expect(rationale).toContain('65%');
    expect(rationale).toContain('recovered');
  });

  it('should include Whoop breakdown when available', () => {
    const fatigueScore = {
      overall: 0.75,
      perMuscle: {},
      weights: { whoop: 0.5, subjective: 0.3, performance: 0.2 },
      components: {
        whoopContribution: 0.4,
        subjectiveContribution: 0.25,
        performanceContribution: 0.1,
      },
    };

    const rationale = generateFatigueRationale(fatigueScore);

    expect(rationale).toContain('Whoop');
    expect(rationale).toContain('40%'); // whoopContribution
  });

  it('should exclude Whoop when not available', () => {
    const fatigueScore = {
      overall: 0.65,
      perMuscle: {},
      weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
      components: {
        whoopContribution: 0,
        subjectiveContribution: 0.4,
        performanceContribution: 0.25,
      },
    };

    const rationale = generateFatigueRationale(fatigueScore);

    expect(rationale).not.toContain('Whoop');
    expect(rationale).toContain('Subjective');
    expect(rationale).toContain('Performance');
  });
});
