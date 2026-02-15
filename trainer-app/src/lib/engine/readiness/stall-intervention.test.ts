import { describe, it, expect } from 'vitest';
import { detectStalls, suggestIntervention } from './stall-intervention';
import type {
  StallDetectionWorkoutHistory,
  StallDetectionExerciseHistory,
  StallDetectionExercise,
  StallState,
} from './stall-intervention';

describe('detectStalls', () => {
  const exercises: StallDetectionExercise[] = [
    { id: 'ex-1', name: 'Bench Press' },
    { id: 'ex-2', name: 'Squat' },
    { id: 'ex-3', name: 'Deadlift' },
  ];

  describe('Insufficient data scenarios', () => {
    it('should skip exercises with less than 3 sessions', () => {
      const history: StallDetectionWorkoutHistory[] = [
        {
          id: 'w-1',
          completedAt: new Date('2024-02-10'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        },
        {
          id: 'w-2',
          completedAt: new Date('2024-02-12'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        },
      ];

      const stalls = detectStalls(history, exercises);

      expect(stalls.length).toBe(0); // Need at least 3 sessions
    });
  });

  describe('Progress detection', () => {
    it('should not flag stall if recent PR exists', () => {
      const history: StallDetectionWorkoutHistory[] = [
        {
          id: 'w-1',
          completedAt: new Date('2024-02-01'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        },
        {
          id: 'w-2',
          completedAt: new Date('2024-02-03'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 205, actualRir: 1 }], // PR: +5 lbs
            },
          ],
        },
        {
          id: 'w-3',
          completedAt: new Date('2024-02-05'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 205, actualRir: 1 }], // Maintained
            },
          ],
        },
      ];

      const stalls = detectStalls(history, exercises);

      // Only 1 session since PR, < 2 weeks
      expect(stalls.length).toBe(0);
    });

    it('should detect stall after 2+ weeks (6+ sessions) without progress', () => {
      // Generate 9 sessions (3 weeks) with no progress
      const history: StallDetectionWorkoutHistory[] = [];
      for (let i = 0; i < 9; i++) {
        history.push({
          id: `w-${i}`,
          completedAt: new Date(`2024-02-${i + 1}`),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }], // No progress
            },
          ],
        });
      }

      const stalls = detectStalls(history, exercises);

      expect(stalls.length).toBe(1);
      expect(stalls[0].exerciseId).toBe('ex-1');
      expect(stalls[0].weeksWithoutProgress).toBeGreaterThanOrEqual(2);
      expect(stalls[0].currentLevel).toBe('deload'); // 9 sessions = 3 weeks → deload
    });
  });

  describe('Intervention ladder thresholds', () => {
    it('should recommend microload at 2 weeks (6 sessions)', () => {
      const history: StallDetectionWorkoutHistory[] = [];
      for (let i = 0; i < 6; i++) {
        history.push({
          id: `w-${i}`,
          completedAt: new Date(`2024-02-${i + 1}`),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        });
      }

      const stalls = detectStalls(history, exercises);

      expect(stalls.length).toBe(1);
      expect(stalls[0].currentLevel).toBe('microload');
    });

    it('should recommend deload at 3 weeks (9 sessions)', () => {
      const history: StallDetectionWorkoutHistory[] = [];
      for (let i = 0; i < 9; i++) {
        history.push({
          id: `w-${i}`,
          completedAt: new Date(`2024-02-${i + 1}`),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        });
      }

      const stalls = detectStalls(history, exercises);

      expect(stalls.length).toBe(1);
      expect(stalls[0].currentLevel).toBe('deload');
    });

    it('should recommend variation swap at 5 weeks (15 sessions)', () => {
      const history: StallDetectionWorkoutHistory[] = [];
      for (let i = 0; i < 15; i++) {
        history.push({
          id: `w-${i}`,
          completedAt: new Date(`2024-02-${i + 1}`),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        });
      }

      const stalls = detectStalls(history, exercises);

      expect(stalls.length).toBe(1);
      expect(stalls[0].currentLevel).toBe('variation');
    });

    it('should recommend volume reset at 8 weeks (24 sessions)', () => {
      const history: StallDetectionWorkoutHistory[] = [];
      for (let i = 0; i < 24; i++) {
        history.push({
          id: `w-${i}`,
          completedAt: new Date(`2024-02-${i + 1}`),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        });
      }

      const stalls = detectStalls(history, exercises);

      expect(stalls.length).toBe(1);
      expect(stalls[0].currentLevel).toBe('volume_reset');
    });
  });

  describe('PR detection edge cases', () => {
    it('should detect rep PR (same load, more reps)', () => {
      const history: StallDetectionWorkoutHistory[] = [
        {
          id: 'w-1',
          completedAt: new Date('2024-02-01'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        },
        {
          id: 'w-2',
          completedAt: new Date('2024-02-03'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 6, actualLoad: 200, actualRir: 1 }], // Rep PR
            },
          ],
        },
        {
          id: 'w-3',
          completedAt: new Date('2024-02-05'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 6, actualLoad: 200, actualRir: 1 }],
            },
          ],
        },
      ];

      const stalls = detectStalls(history, exercises);

      // Only 1 session since rep PR
      expect(stalls.length).toBe(0);
    });

    it('should detect load PR (same reps, higher load)', () => {
      const history: StallDetectionWorkoutHistory[] = [
        {
          id: 'w-1',
          completedAt: new Date('2024-02-01'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }],
            },
          ],
        },
        {
          id: 'w-2',
          completedAt: new Date('2024-02-03'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 205, actualRir: 1 }], // Load PR
            },
          ],
        },
        {
          id: 'w-3',
          completedAt: new Date('2024-02-05'),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [{ actualReps: 5, actualLoad: 205, actualRir: 1 }],
            },
          ],
        },
      ];

      const stalls = detectStalls(history, exercises);

      expect(stalls.length).toBe(0);
    });

    it('should use best set from each session (highest e1RM)', () => {
      const history: StallDetectionWorkoutHistory[] = [];
      for (let i = 0; i < 10; i++) {
        history.push({
          id: `w-${i}`,
          completedAt: new Date(`2024-02-${i + 1}`),
          exercises: [
            {
              exerciseId: 'ex-1',
              exerciseName: 'Bench Press',
              sets: [
                { actualReps: 5, actualLoad: 200, actualRir: 1 }, // e1RM = 200 * (1 + 5/30) = 233.3
                { actualReps: 4, actualLoad: 210, actualRir: 1 }, // e1RM = 210 * (1 + 4/30) = 238 (best)
                { actualReps: 3, actualLoad: 205, actualRir: 1 }, // e1RM = 210 * (1 + 3/30) = 225.5
              ],
            },
          ],
        });
      }

      const stalls = detectStalls(history, exercises);

      // No stall because we're using best set (which hasn't changed)
      // But since all 10 sessions have same best e1RM, should detect stall
      expect(stalls.length).toBe(1);
      expect(stalls[0].currentLevel).toBe('deload'); // 10 sessions ≈ 3.3 weeks
    });
  });

  describe('Multiple exercises', () => {
    it('should detect stalls independently for multiple exercises', () => {
      const history: StallDetectionWorkoutHistory[] = [];

      // Bench: Stalled (9 sessions no progress)
      // Squat: Progressing (recent PR)
      for (let i = 0; i < 9; i++) {
        const exercises: StallDetectionExerciseHistory[] = [
          {
            exerciseId: 'ex-1',
            exerciseName: 'Bench Press',
            sets: [{ actualReps: 5, actualLoad: 200, actualRir: 1 }], // No progress
          },
          {
            exerciseId: 'ex-2',
            exerciseName: 'Squat',
            sets: [
              {
                actualReps: 5,
                actualLoad: i < 5 ? 300 : 305, // PR at session 5
                actualRir: 1,
              },
            ],
          },
        ];

        history.push({
          id: `w-${i}`,
          completedAt: new Date(`2024-02-${i + 1}`),
          exercises,
        });
      }

      const stalls = detectStalls(history, exercises);

      expect(stalls.length).toBe(1);
      expect(stalls[0].exerciseId).toBe('ex-1'); // Only Bench is stalled
    });
  });
});

describe('suggestIntervention', () => {
  describe('Intervention suggestions', () => {
    it('should suggest microloading for 2-week stall', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Bench Press',
        weeksWithoutProgress: 2,
        currentLevel: 'microload',
      };

      const suggestion = suggestIntervention(stall);

      expect(suggestion.level).toBe('microload');
      expect(suggestion.action).toContain('1-2 lbs');
      expect(suggestion.rationale).toContain('2 weeks');
    });

    it('should suggest deload for 3-week stall', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Bench Press',
        weeksWithoutProgress: 3,
        currentLevel: 'deload',
      };

      const suggestion = suggestIntervention(stall);

      expect(suggestion.level).toBe('deload');
      expect(suggestion.action).toContain('Reduce load by 10%');
      expect(suggestion.rationale).toContain('3 weeks');
      expect(suggestion.rationale).toContain('fatigue');
    });

    it('should suggest variation swap for 5-week stall', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Bench Press',
        weeksWithoutProgress: 5,
        currentLevel: 'variation',
      };

      const suggestion = suggestIntervention(stall);

      expect(suggestion.level).toBe('variation');
      expect(suggestion.action).toContain('variation');
      expect(suggestion.action).toMatch(/grip|stance|equipment/i);
      expect(suggestion.rationale).toContain('5 weeks');
    });

    it('should suggest volume reset for 8-week stall', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Bench Press',
        weeksWithoutProgress: 8,
        currentLevel: 'volume_reset',
      };

      const suggestion = suggestIntervention(stall);

      expect(suggestion.level).toBe('volume_reset');
      expect(suggestion.action).toContain('MEV');
      expect(suggestion.action).toContain('4 weeks');
      expect(suggestion.rationale).toContain('8 weeks');
    });

    it('should suggest goal reassessment for 8+ week stall', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Bench Press',
        weeksWithoutProgress: 12,
        currentLevel: 'goal_reassess',
      };

      const suggestion = suggestIntervention(stall);

      expect(suggestion.level).toBe('goal_reassess');
      expect(suggestion.action).toContain('coaching');
      expect(suggestion.rationale).toContain('12');
    });

    it('should handle no intervention level', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Bench Press',
        weeksWithoutProgress: 1,
        currentLevel: 'none',
      };

      const suggestion = suggestIntervention(stall);

      expect(suggestion.level).toBe('none');
      expect(suggestion.action).toContain('Continue');
    });
  });

  describe('Suggestion details', () => {
    it('should include exercise name in suggestion', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Deadlift',
        weeksWithoutProgress: 3,
        currentLevel: 'deload',
      };

      const suggestion = suggestIntervention(stall);

      expect(suggestion.exerciseId).toBe('ex-1');
      expect(suggestion.exerciseName).toBe('Deadlift');
    });

    it('should provide actionable instructions', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Squat',
        weeksWithoutProgress: 3,
        currentLevel: 'deload',
      };

      const suggestion = suggestIntervention(stall);

      // Action should be specific and actionable
      expect(suggestion.action.length).toBeGreaterThan(10);
      expect(suggestion.action).toMatch(/\d+/); // Contains numbers (percentages, weeks, etc.)
    });

    it('should provide clear rationale', () => {
      const stall: StallState = {
        exerciseId: 'ex-1',
        exerciseName: 'Overhead Press',
        weeksWithoutProgress: 5,
        currentLevel: 'variation',
      };

      const suggestion = suggestIntervention(stall);

      // Rationale should mention duration and reasoning
      expect(suggestion.rationale).toContain('5 weeks');
      expect(suggestion.rationale.length).toBeGreaterThan(15);
    });
  });
});
