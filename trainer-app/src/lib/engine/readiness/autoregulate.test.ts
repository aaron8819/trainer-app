import { describe, it, expect } from 'vitest';
import { autoregulateWorkout } from './autoregulate';
import type { WorkoutPlan, FatigueScore, AutoregulationPolicy } from './types';

describe('autoregulateWorkout', () => {
  // Sample workout for testing
  const createSampleWorkout = (): WorkoutPlan => ({
    exercises: [
      {
        id: 'ex-1',
        name: 'Bench Press',
        isMainLift: true,
        sets: [
          { setIndex: 0, targetReps: 5, targetLoad: 200, targetRpe: 9 }, // RIR 1 = RPE 9
          { setIndex: 1, targetReps: 5, targetLoad: 200, targetRpe: 9 },
          { setIndex: 2, targetReps: 5, targetLoad: 200, targetRpe: 9 },
        ],
      },
      {
        id: 'ex-2',
        name: 'Dumbbell Flyes',
        isMainLift: false,
        sets: [
          { setIndex: 0, targetReps: 12, targetLoad: 30, targetRpe: 8 }, // RIR 2 = RPE 8
          { setIndex: 1, targetReps: 12, targetLoad: 30, targetRpe: 8 },
          { setIndex: 2, targetReps: 12, targetLoad: 30, targetRpe: 8 },
          { setIndex: 3, targetReps: 12, targetLoad: 30, targetRpe: 8 },
        ],
      },
    ],
    estimatedMinutes: 60,
  });

  describe('Fatigue threshold decisions', () => {
    it('should trigger deload when fatigue < 0.3', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.25, // Significantly fatigued
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.15,
          performanceContribution: 0.1,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      expect(result.modifications.length).toBeGreaterThan(0);
      expect(result.modifications[0].type).toBe('deload_trigger');
      expect(result.rationale).toContain('deload triggered');
    });

    it('should scale down when fatigue 0.3-0.5 (moderate policy)', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.35, // Moderately fatigued
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const policy: AutoregulationPolicy = {
        aggressiveness: 'moderate',
        allowUpRegulation: true,
        allowDownRegulation: true,
      };

      const result = autoregulateWorkout(workout, fatigueScore, policy);

      expect(result.modifications.length).toBeGreaterThan(0);
      expect(result.modifications[0].type).toBe('intensity_scale');
      expect(result.modifications[0].direction).toBe('down');
      expect(result.rationale).toContain('scale down');
    });

    it('should reduce volume when fatigue 0.3-0.5 (aggressive policy)', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const policy: AutoregulationPolicy = {
        aggressiveness: 'aggressive',
        allowUpRegulation: true,
        allowDownRegulation: true,
      };

      const result = autoregulateWorkout(workout, fatigueScore, policy);

      expect(result.modifications.some((m) => m.type === 'volume_reduction')).toBe(true);
      expect(result.rationale).toContain('reduce volume');
    });

    it('should scale up when fatigue > 0.85 (if allowed)', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.9, // Very fresh
        perMuscle: {},
        weights: { whoop: 0.5, subjective: 0.3, performance: 0.2 },
        components: {
          whoopContribution: 0.45,
          subjectiveContribution: 0.27,
          performanceContribution: 0.18,
        },
      };

      const policy: AutoregulationPolicy = {
        aggressiveness: 'moderate',
        allowUpRegulation: true,
        allowDownRegulation: true,
      };

      const result = autoregulateWorkout(workout, fatigueScore, policy);

      expect(result.modifications.length).toBeGreaterThan(0);
      expect(result.modifications[0].type).toBe('intensity_scale');
      expect(result.modifications[0].direction).toBe('up');
      expect(result.rationale).toContain('scale up');
    });

    it('should maintain when fatigue in normal range (0.5-0.85)', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.65, // Recovered
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.39,
          performanceContribution: 0.26,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      expect(result.modifications.length).toBe(0);
      expect(result.rationale).toContain('No adjustments needed');
    });
  });

  describe('Policy respect', () => {
    it('should not scale up if allowUpRegulation=false', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.9,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.54,
          performanceContribution: 0.36,
        },
      };

      const policy: AutoregulationPolicy = {
        aggressiveness: 'moderate',
        allowUpRegulation: false, // Don't allow up-regulation
        allowDownRegulation: true,
      };

      const result = autoregulateWorkout(workout, fatigueScore, policy);

      expect(result.modifications.length).toBe(0);
    });

    it('should not scale down if allowDownRegulation=false', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const policy: AutoregulationPolicy = {
        aggressiveness: 'moderate',
        allowUpRegulation: true,
        allowDownRegulation: false, // Don't allow down-regulation
      };

      const result = autoregulateWorkout(workout, fatigueScore, policy);

      expect(result.modifications.length).toBe(0);
    });
  });

  describe('Scale down intensity action', () => {
    it('should reduce load by 10% and increase RIR by 1', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      // Check Bench Press (main lift)
      const benchExercise = result.adjustedWorkout.exercises.find((e) => e.name === 'Bench Press');
      expect(benchExercise).toBeDefined();

      const firstSet = benchExercise!.sets[0];
      expect(firstSet.targetLoad).toBe(180); // 200 * 0.9 = 180
      expect(firstSet.targetRpe).toBe(8); // 9 - 1 = 8 (scale down reduces RPE)

      // Verify modification logged
      const benchMod = result.modifications.find((m) => m.exerciseName === 'Bench Press');
      expect(benchMod).toBeDefined();
      expect(benchMod!.direction).toBe('down');
      expect(benchMod!.scalar).toBe(0.9);
      expect(benchMod!.originalLoad).toBe(200);
      expect(benchMod!.adjustedLoad).toBe(180);
    });

    it('should round adjusted load to nearest 0.5 lbs', () => {
      const workout: WorkoutPlan = {
        exercises: [
          {
            id: 'ex-1',
            name: 'Squat',
            isMainLift: true,
            sets: [{ setIndex: 0, targetReps: 5, targetLoad: 225, targetRpe: 1 }],
          },
        ],
        estimatedMinutes: 30,
      };

      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      // 225 * 0.9 = 202.5 → should round to 202.5
      const squatSet = result.adjustedWorkout.exercises[0].sets[0];
      expect(squatSet.targetLoad).toBe(202.5);
    });
  });

  describe('Scale up intensity action', () => {
    it('should increase load by 5% and decrease RIR by 0.5', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.9,
        perMuscle: {},
        weights: { whoop: 0.5, subjective: 0.3, performance: 0.2 },
        components: {
          whoopContribution: 0.45,
          subjectiveContribution: 0.27,
          performanceContribution: 0.18,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      // Check Bench Press (main lift)
      const benchExercise = result.adjustedWorkout.exercises.find((e) => e.name === 'Bench Press');
      const firstSet = benchExercise!.sets[0];

      expect(firstSet.targetLoad).toBe(210); // 200 * 1.05 = 210
      expect(firstSet.targetRpe).toBe(9.5); // 9 + 0.5 = 9.5 (scale up increases RPE)

      // Verify modification logged
      const benchMod = result.modifications.find((m) => m.exerciseName === 'Bench Press');
      expect(benchMod!.direction).toBe('up');
      expect(benchMod!.scalar).toBe(1.05);
      expect(benchMod!.originalLoad).toBe(200);
      expect(benchMod!.adjustedLoad).toBe(210);
    });

    it('should not reduce RIR below 0', () => {
      const workout: WorkoutPlan = {
        exercises: [
          {
            id: 'ex-1',
            name: 'Deadlift',
            isMainLift: true,
            sets: [{ setIndex: 0, targetReps: 5, targetLoad: 300, targetRpe: 10 }], // Already at RIR 0 (RPE 10)
          },
        ],
        estimatedMinutes: 30,
      };

      const fatigueScore: FatigueScore = {
        overall: 0.9,
        perMuscle: {},
        weights: { whoop: 0.5, subjective: 0.3, performance: 0.2 },
        components: {
          whoopContribution: 0.45,
          subjectiveContribution: 0.27,
          performanceContribution: 0.18,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      const deadliftSet = result.adjustedWorkout.exercises[0].sets[0];
      expect(deadliftSet.targetRpe).toBe(10); // Should not exceed RPE 10 (RIR 0 floor)
    });
  });

  describe('Reduce volume action', () => {
    it('should preserve main lift sets', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const policy: AutoregulationPolicy = {
        aggressiveness: 'aggressive',
        allowUpRegulation: true,
        allowDownRegulation: true,
      };

      const result = autoregulateWorkout(workout, fatigueScore, policy);

      // Bench Press (main lift) should keep all 3 sets
      const benchExercise = result.adjustedWorkout.exercises.find((e) => e.name === 'Bench Press');
      expect(benchExercise!.sets.length).toBe(3);
    });

    it('should drop accessory sets (up to MAX_SETS_TO_DROP)', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const policy: AutoregulationPolicy = {
        aggressiveness: 'aggressive',
        allowUpRegulation: true,
        allowDownRegulation: true,
      };

      const result = autoregulateWorkout(workout, fatigueScore, policy);

      // Dumbbell Flyes (accessory) should drop 2 sets (4 → 2)
      const flyesExercise = result.adjustedWorkout.exercises.find(
        (e) => e.name === 'Dumbbell Flyes'
      );
      expect(flyesExercise!.sets.length).toBe(2); // MIN_SETS_PRESERVED = 2

      // Verify modification logged
      const flyesMod = result.modifications.find((m) => m.exerciseName === 'Dumbbell Flyes');
      expect(flyesMod!.type).toBe('volume_reduction');
      expect(flyesMod!.setsCut).toBe(2);
      expect(flyesMod!.originalSetCount).toBe(4);
      expect(flyesMod!.adjustedSetCount).toBe(2);
    });

    it('should preserve minimum sets (MIN_SETS_PRESERVED = 2)', () => {
      const workout: WorkoutPlan = {
        exercises: [
          {
            id: 'ex-1',
            name: 'Lateral Raises',
            isMainLift: false,
            sets: [
              { setIndex: 0, targetReps: 15, targetLoad: 15, targetRpe: 2 },
              { setIndex: 1, targetReps: 15, targetLoad: 15, targetRpe: 2 },
            ], // Already at minimum
          },
        ],
        estimatedMinutes: 20,
      };

      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const policy: AutoregulationPolicy = {
        aggressiveness: 'aggressive',
        allowUpRegulation: true,
        allowDownRegulation: true,
      };

      const result = autoregulateWorkout(workout, fatigueScore, policy);

      // Should not drop below MIN_SETS_PRESERVED
      const lateralExercise = result.adjustedWorkout.exercises[0];
      expect(lateralExercise.sets.length).toBe(2); // No change

      // No modification should be logged
      expect(result.modifications.length).toBe(0);
    });
  });

  describe('Trigger deload action', () => {
    it('should reduce volume to 50%', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.25,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.15,
          performanceContribution: 0.1,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      // Bench Press: 3 sets → 2 sets (rounded)
      const benchExercise = result.adjustedWorkout.exercises.find((e) => e.name === 'Bench Press');
      expect(benchExercise!.sets.length).toBe(2); // Math.max(1, Math.round(3 * 0.5)) = 2

      // Dumbbell Flyes: 4 sets → 2 sets
      const flyesExercise = result.adjustedWorkout.exercises.find(
        (e) => e.name === 'Dumbbell Flyes'
      );
      expect(flyesExercise!.sets.length).toBe(2);
    });

    it('should reduce intensity to 60%', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.25,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.15,
          performanceContribution: 0.1,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      // Bench Press: 200 lbs → 120 lbs
      const benchSet = result.adjustedWorkout.exercises.find(
        (e) => e.name === 'Bench Press'
      )!.sets[0];
      expect(benchSet.targetLoad).toBe(120); // 200 * 0.6 = 120
      expect(benchSet.targetRpe).toBe(6); // 10 - DELOAD_RIR(4) = 6
    });

    it('should add AUTO-DELOAD note to workout', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.25,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.15,
          performanceContribution: 0.1,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      expect(result.adjustedWorkout.notes).toContain('[AUTO-DELOAD TRIGGERED]');
    });
  });

  describe('Rationale generation', () => {
    it('should include fatigue percentage and action description', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      expect(result.rationale).toContain('35%');
      expect(result.rationale).toContain('moderately fatigued');
      expect(result.rationale).toContain('scale down');
    });

    it('should include modification count', () => {
      const workout = createSampleWorkout();
      const fatigueScore: FatigueScore = {
        overall: 0.35,
        perMuscle: {},
        weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
        components: {
          whoopContribution: 0,
          subjectiveContribution: 0.21,
          performanceContribution: 0.14,
        },
      };

      const result = autoregulateWorkout(workout, fatigueScore);

      // Should mention number of exercises adjusted
      expect(result.rationale).toMatch(/\d+ exercises/);
    });
  });
});
