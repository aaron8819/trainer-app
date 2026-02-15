// Phase 3: Autoregulation & Readiness Integration Types

/**
 * Whoop recovery data
 * Phase 3: Stubbed (always null)
 * Phase 3.5: Will be populated via Whoop OAuth integration
 */
export type WhoopData = {
  recovery: number;      // 0-100 (recovery score percentage)
  strain: number;        // 0-21 (daily strain)
  hrv: number;           // ms (RMSSD - root mean square of successive differences)
  sleepQuality: number;  // 0-100 (sleep performance percentage)
  sleepDuration: number; // hours (total sleep time)
};

/**
 * Subjective readiness input from user
 * Always collected before workout generation
 */
export type SubjectiveReadiness = {
  readiness: 1 | 2 | 3 | 4 | 5;          // 1=exhausted, 5=great
  motivation: 1 | 2 | 3 | 4 | 5;         // 1=no motivation, 5=eager
  soreness: Record<string, 1 | 2 | 3>;  // muscle group → soreness level (1=none, 2=moderate, 3=very sore)
  stress?: 1 | 2 | 3 | 4 | 5;           // Life stress (1=low, 5=high), optional
};

/**
 * Performance-derived readiness signals
 * Computed from recent workout history
 */
export type PerformanceSignals = {
  rpeDeviation: number;       // Avg(actual RPE - expected RPE) last 3 sessions
  stallCount: number;         // Count of currently stalled exercises
  volumeComplianceRate: number; // 0-1 (% of prescribed sets completed)
};

/**
 * Complete readiness signal combining all sources
 * Stored in ReadinessSignal table for analytics
 */
export type ReadinessSignal = {
  timestamp: Date;
  userId: string;

  whoop?: WhoopData;
  subjective: SubjectiveReadiness;
  performance: PerformanceSignals;
};

/**
 * Computed fatigue score (0-1 continuous)
 * 0 = completely exhausted, 1 = completely fresh
 */
export type FatigueScore = {
  overall: number;  // 0-1 (weighted combination of all signals)
  perMuscle: Record<string, number>;  // muscle group → fatigue (0-1)

  // Signal weights (transparency for explainability)
  weights: {
    whoop: number;       // 0-0.5 (0.5 if Whoop available, 0 otherwise)
    subjective: number;  // 0.3-0.6 (0.3 with Whoop, 0.6 without)
    performance: number; // 0.2-0.4 (0.2 with Whoop, 0.4 without)
  };

  // Component contributions (for "why this score?" explanation)
  components: {
    whoopContribution: number;       // Whoop score × weight
    subjectiveContribution: number;  // Subjective score × weight
    performanceContribution: number; // Performance score × weight
  };
};

/**
 * Fatigue scoring configuration
 * Thresholds and weights for multi-signal integration
 */
export type FatigueConfig = {
  // Whoop scoring thresholds
  HRV_BASELINE: number;              // ms, red flag if <30
  STRAIN_OVERREACH_THRESHOLD: number; // trigger penalty if strain > this

  // Fatigue score thresholds (for autoregulation decisions)
  DELOAD_THRESHOLD: number;      // < this → trigger deload
  SCALE_DOWN_THRESHOLD: number;  // < this → scale down intensity
  SCALE_UP_THRESHOLD: number;    // > this → scale up intensity (if allowed)

  // Intensity scaling factors
  SCALE_DOWN_FACTOR: number;     // 0.9 (10% reduction)
  SCALE_UP_FACTOR: number;       // 1.05 (5% increase)

  // Deload parameters
  DELOAD_INTENSITY_FACTOR: number; // 0.6 (60% intensity)
  DELOAD_VOLUME_FACTOR: number;    // 0.5 (50% volume)
  DELOAD_RIR: number;              // 4 (very easy)

  // Volume reduction parameters
  MAX_SETS_TO_DROP: number;      // Max sets to cut in volume reduction
  MIN_SETS_PRESERVED: number;    // Min sets to keep per exercise

  // Stall detection thresholds (weeks without progress)
  WEEKS_UNTIL_MICROLOAD: number;     // 2 weeks
  WEEKS_UNTIL_DELOAD: number;        // 3 weeks
  WEEKS_UNTIL_VARIATION: number;     // 5 weeks
  WEEKS_UNTIL_VOLUME_RESET: number;  // 8 weeks
};

/**
 * Default fatigue configuration
 * Evidence-based thresholds from autoregulation literature
 */
export const DEFAULT_FATIGUE_CONFIG: FatigueConfig = {
  // Whoop thresholds
  HRV_BASELINE: 50,                // ms
  STRAIN_OVERREACH_THRESHOLD: 18,  // High strain warning

  // Fatigue score decision thresholds
  DELOAD_THRESHOLD: 0.3,           // Significantly fatigued
  SCALE_DOWN_THRESHOLD: 0.5,       // Moderately fatigued
  SCALE_UP_THRESHOLD: 0.85,        // Very fresh

  // Intensity scaling
  SCALE_DOWN_FACTOR: 0.9,          // 10% reduction
  SCALE_UP_FACTOR: 1.05,           // 5% increase (conservative)

  // Deload parameters
  DELOAD_INTENSITY_FACTOR: 0.6,    // 60% intensity
  DELOAD_VOLUME_FACTOR: 0.5,       // 50% volume
  DELOAD_RIR: 4,                   // Very easy

  // Volume reduction
  MAX_SETS_TO_DROP: 2,
  MIN_SETS_PRESERVED: 2,

  // Stall intervention ladder
  WEEKS_UNTIL_MICROLOAD: 2,
  WEEKS_UNTIL_DELOAD: 3,
  WEEKS_UNTIL_VARIATION: 5,
  WEEKS_UNTIL_VOLUME_RESET: 8,
};

/**
 * Autoregulation actions
 * What to do based on fatigue score
 */
export type AutoregulationAction =
  | 'maintain'          // No adjustment needed
  | 'scale_down'        // -10% load, +1 RIR
  | 'scale_up'          // +5% load, -0.5 RIR
  | 'reduce_volume'     // Drop accessory sets
  | 'trigger_deload';   // 50% volume, 60% intensity

/**
 * Autoregulation policy
 * User preferences for how aggressive to be with scaling
 */
export type AutoregulationPolicy = {
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
  allowUpRegulation: boolean;    // Can increase intensity if feeling great?
  allowDownRegulation: boolean;  // Can decrease if fatigued?
};

/**
 * Default autoregulation policy
 * Moderate aggressiveness, allows both up and down regulation
 */
export const DEFAULT_AUTOREGULATION_POLICY: AutoregulationPolicy = {
  aggressiveness: 'moderate',
  allowUpRegulation: true,
  allowDownRegulation: true,
};

/**
 * Autoregulation modification record
 * Tracks what was changed and why
 */
export type AutoregulationModification = {
  type: 'intensity_scale' | 'volume_reduction' | 'deload_trigger';
  exerciseId?: string;
  exerciseName?: string;

  // For intensity scaling
  direction?: 'up' | 'down';
  scalar?: number;  // e.g., 0.9 for 10% reduction
  originalLoad?: number;
  adjustedLoad?: number;
  originalRir?: number;
  adjustedRir?: number;

  // For volume reduction
  setsCut?: number;
  originalSetCount?: number;
  adjustedSetCount?: number;

  reason: string;  // Human-readable explanation
};

/**
 * Intervention level for stalled exercises
 * Progressive escalation based on weeks without progress
 */
export type InterventionLevel =
  | 'none'            // 0-1 weeks no progress (normal variation)
  | 'microload'       // 2 weeks - use +1-2 lbs increments instead of +5 lbs
  | 'deload'          // 3 weeks - drop 10%, rebuild over 2-3 weeks
  | 'variation'       // 5 weeks - swap exercise variation
  | 'volume_reset'    // 8 weeks - drop to MEV, rebuild over 4 weeks
  | 'goal_reassess';  // 8+ weeks - suggest coaching/goal pivot

/**
 * Stall state for a specific exercise
 * Tracks how long since last PR and what intervention is recommended
 */
export type StallState = {
  exerciseId: string;
  exerciseName: string;
  weeksWithoutProgress: number;
  lastPr?: Date;
  currentLevel: InterventionLevel;
};

/**
 * Intervention suggestion
 * What to do about a stalled exercise
 */
export type InterventionSuggestion = {
  exerciseId: string;
  exerciseName: string;
  level: InterventionLevel;
  action: string;      // User-facing instruction
  rationale: string;   // Why this intervention
};
