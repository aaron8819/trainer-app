// Phase 3: Multi-Signal Fatigue Score Computation

import type {
  ReadinessSignal,
  FatigueScore,
  FatigueConfig,
  WhoopData,
  SubjectiveReadiness,
  PerformanceSignals,
} from './types';
import { DEFAULT_FATIGUE_CONFIG } from './types';

/**
 * Compute fatigue score from multi-modal readiness signal
 * Returns 0-1 continuous score (0=exhausted, 1=fresh)
 *
 * @param signal - Complete readiness signal (whoop + subjective + performance)
 * @param config - Fatigue scoring configuration (optional, uses defaults)
 * @returns FatigueScore with overall score, per-muscle breakdown, and component contributions
 */
export function computeFatigueScore(
  signal: ReadinessSignal,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG
): FatigueScore {
  const hasWhoop = signal.whoop !== undefined;

  // Component scores (0-1)
  const whoopScore = hasWhoop ? computeWhoopScore(signal.whoop!, config) : 0;
  const subjectiveScore = computeSubjectiveScore(signal.subjective);
  const performanceScore = computePerformanceScore(signal.performance);

  // Adaptive weights based on signal availability
  const weights = determineWeights(hasWhoop);

  // Weighted integration
  const components = {
    whoopContribution: whoopScore * weights.whoop,
    subjectiveContribution: subjectiveScore * weights.subjective,
    performanceContribution: performanceScore * weights.performance,
  };

  const overall =
    components.whoopContribution +
    components.subjectiveContribution +
    components.performanceContribution;

  // Per-muscle fatigue from soreness data
  const perMuscle = computePerMuscleFatigue(signal.subjective.soreness);

  return {
    overall,
    perMuscle,
    weights,
    components,
  };
}

/**
 * Compute Whoop-based fatigue score
 * Algorithm: recovery×0.4 + (1-strainPenalty)×0.2 + hrv×0.2 + sleep×0.2
 *
 * @param whoop - Whoop recovery data
 * @param config - Configuration for thresholds
 * @returns 0-1 score (0=very fatigued from Whoop metrics, 1=fully recovered)
 */
function computeWhoopScore(whoop: WhoopData, config: FatigueConfig): number {
  // Recovery score (0-100 → 0-1)
  const recoveryScore = whoop.recovery / 100;

  // Strain penalty: penalize overreaching (strain > 18)
  const strainPenalty = whoop.strain > config.STRAIN_OVERREACH_THRESHOLD ? 0.2 : 0;

  // HRV score (baseline ~50ms, red flag <30ms)
  // Normalize to 0-1, capped at 1.0
  const hrvScore = Math.min(1, whoop.hrv / config.HRV_BASELINE);

  // Sleep quality score (0-100 → 0-1)
  const sleepScore = whoop.sleepQuality / 100;

  // Weighted combination
  const whoopScore =
    recoveryScore * 0.4 +
    (1 - strainPenalty) * 0.2 +
    hrvScore * 0.2 +
    sleepScore * 0.2;

  return Math.max(0, Math.min(1, whoopScore)); // Clamp to [0,1]
}

/**
 * Compute subjective fatigue score from user input
 * Algorithm: readiness×0.6 + motivation×0.4
 *
 * Note: Stress was removed (2026-02-15) to simplify scoring and avoid
 * artificial score reduction from default values. Readiness and motivation
 * are more direct indicators of workout readiness.
 *
 * @param subjective - User's subjective readiness input
 * @returns 0-1 score (0=very fatigued subjectively, 1=very fresh)
 */
function computeSubjectiveScore(subjective: SubjectiveReadiness): number {
  // Normalize 1-5 scales to 0-1
  const readiness = (subjective.readiness - 1) / 4; // 1→0, 5→1
  const motivation = (subjective.motivation - 1) / 4; // 1→0, 5→1

  // Weighted combination (stress removed, weights redistributed)
  // Readiness weighted more heavily as primary physical recovery indicator
  const subjectiveScore = readiness * 0.6 + motivation * 0.4;

  return Math.max(0, Math.min(1, subjectiveScore)); // Clamp to [0,1]
}

/**
 * Compute performance-derived fatigue score
 * Algorithm: rpeScore×0.5 + (1-stallPenalty)×0.3 + compliance×0.2
 *
 * @param performance - Performance signals from recent history
 * @returns 0-1 score (0=performance declining, 1=performing well)
 */
function computePerformanceScore(performance: PerformanceSignals): number {
  // RPE deviation score
  // rpeDeviation is avg(actual - expected):
  //   - Positive = sessions felt harder than expected (fatigued)
  //   - Negative = sessions felt easier than expected (fresh)
  // Map to 0-1: deviation of -4 → 1.0, deviation of +4 → 0.0
  const rpeScore = Math.max(0, Math.min(1, 0.5 - performance.rpeDeviation / 4));

  // Stall penalty (multiple stalls indicate accumulated fatigue)
  // Cap penalty at 0.3 (3+ stalled exercises)
  const stallPenalty = Math.min(0.3, performance.stallCount * 0.1);

  // Compliance score (% of prescribed sets completed)
  // Already 0-1
  const complianceScore = performance.volumeComplianceRate;

  // Weighted combination
  const performanceScore =
    rpeScore * 0.5 + (1 - stallPenalty) * 0.3 + complianceScore * 0.2;

  return Math.max(0, Math.min(1, performanceScore)); // Clamp to [0,1]
}

/**
 * Determine signal weights based on availability
 * If Whoop available: Trust it most (0.5), subjective 0.3, performance 0.2
 * If no Whoop: Rely more on subjective (0.6) and performance (0.4)
 *
 * @param hasWhoop - Whether Whoop data is available
 * @returns Signal weights object
 */
function determineWeights(hasWhoop: boolean): FatigueScore['weights'] {
  if (hasWhoop) {
    return {
      whoop: 0.5,
      subjective: 0.3,
      performance: 0.2,
    };
  }

  return {
    whoop: 0,
    subjective: 0.6,
    performance: 0.4,
  };
}

/**
 * Compute per-muscle fatigue from soreness data
 * Soreness scale: 1=none, 2=moderate, 3=very sore
 * Maps to fatigue: 1→1.0 (fresh), 2→0.5 (moderate), 3→0.0 (exhausted)
 *
 * @param soreness - Map of muscle group → soreness level
 * @returns Map of muscle group → fatigue score (0-1)
 */
function computePerMuscleFatigue(
  soreness: Record<string, 1 | 2 | 3>
): Record<string, number> {
  const perMuscle: Record<string, number> = {};

  for (const [muscleGroup, sorenessLevel] of Object.entries(soreness)) {
    // Linear mapping: soreness 1→fatigue 1.0, soreness 3→fatigue 0.0
    const fatigue = 1 - (sorenessLevel - 1) / 2;
    perMuscle[muscleGroup] = Math.max(0, Math.min(1, fatigue));
  }

  return perMuscle;
}

/**
 * Generate human-readable fatigue level label
 * @param overallScore - Overall fatigue score (0-1)
 * @returns Fatigue level label
 */
export function getFatigueLevelLabel(overallScore: number): string {
  if (overallScore > 0.8) return 'very fresh';
  if (overallScore > 0.6) return 'recovered';
  if (overallScore > 0.4) return 'moderately fatigued';
  return 'significantly fatigued';
}

/**
 * Generate rationale text explaining fatigue score
 * @param fatigueScore - Complete fatigue score
 * @returns Human-readable explanation
 */
export function generateFatigueRationale(fatigueScore: FatigueScore): string {
  const level = getFatigueLevelLabel(fatigueScore.overall);
  const percentage = Math.round(fatigueScore.overall * 100);

  // Component percentages
  const whoopPct = Math.round(fatigueScore.components.whoopContribution * 100);
  const subjectivePct = Math.round(fatigueScore.components.subjectiveContribution * 100);
  const performancePct = Math.round(fatigueScore.components.performanceContribution * 100);

  let breakdown = 'Based on: ';
  const parts: string[] = [];

  if (fatigueScore.weights.whoop > 0) {
    parts.push(`Whoop ${whoopPct}%`);
  }
  parts.push(`Subjective ${subjectivePct}%`);
  parts.push(`Performance ${performancePct}%`);

  breakdown += parts.join(', ');

  return `Fatigue score: ${percentage}% (${level}). ${breakdown}.`;
}
