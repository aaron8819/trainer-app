# Testing Patterns and Conventions

Standard patterns, fixtures, and best practices for writing Trainer App tests.

---

## Core Principles

### 1. Determinism First
**Never use `Math.random()` in engine code.** Use the seeded PRNG:

```typescript
import { createRng } from "./random";

// ✅ Good: Deterministic
const rng = createRng(12345);
const value = rng(); // Always returns same sequence for seed 12345

// ❌ Bad: Non-deterministic
const value = Math.random(); // Different every run
```

**Why:** Flaky tests erode confidence. Deterministic tests catch regressions reliably.

---

### 2. Arrange-Act-Assert Pattern
Structure tests with clear phases:

```typescript
it("should increase volume 20% during accumulation", () => {
  // Arrange: Set up inputs
  const basePrescription = {
    sets: 4,
    reps: 8,
    rir: 2,
    restSec: 120,
  };
  const blockContext = createAccumulationBlock(weekInBlock: 3);

  // Act: Execute function under test
  const result = prescribeWithBlock({ basePrescription, blockContext });

  // Assert: Verify outcomes
  expect(result.sets).toBe(5); // 4 * 1.2 = 4.8 → 5
  expect(result.rir).toBe(4); // 2 + 2 = 4
});
```

---

### 3. Test Behavior, Not Implementation
Focus on **what** the function does, not **how** it does it:

```typescript
// ✅ Good: Tests behavior
it("should select exercises within time budget", () => {
  const result = selectExercises(exercises, { timeBudget: 60 });
  const totalTime = result.selected.reduce((sum, c) => sum + c.timeContribution, 0);
  expect(totalTime).toBeLessThanOrEqual(60);
});

// ❌ Bad: Tests implementation
it("should call pruneByTime with correct args", () => {
  const spy = vi.spyOn(module, "pruneByTime");
  selectExercises(exercises, { timeBudget: 60 });
  expect(spy).toHaveBeenCalledWith(expect.anything(), 60);
});
```

**Why:** Tests should survive refactoring. Implementation details change; behavior should not.

---

## Common Fixtures

### User, Goals, Constraints

**Location:** `src/lib/engine/sample-data.ts`

```typescript
import {
  exampleUser,
  exampleGoals,
  exampleConstraints,
} from "./sample-data";

// Basic usage
const user = exampleUser();
const goals = exampleGoals();
const constraints = exampleConstraints();

// With overrides
const intermediateUser = exampleUser({ trainingAge: "intermediate" });
const strengthGoals = exampleGoals({ primary: "strength", secondary: "hypertrophy" });
const shortSession = exampleConstraints({ sessionMinutes: 45, daysPerWeek: 4 });
```

**Available Overrides:**
```typescript
// User
exampleUser({
  userId?: string;
  heightCm?: number; // Default 178 (5'10")
  weightKg?: number; // Default 82 (180 lb)
  sex?: "male" | "female";
  age?: number; // Default 30
  trainingAge?: "beginner" | "intermediate" | "advanced";
});

// Goals
exampleGoals({
  primary?: "hypertrophy" | "strength" | "fat_loss";
  secondary?: "hypertrophy" | "strength" | "fat_loss" | "none";
});

// Constraints
exampleConstraints({
  sessionMinutes?: number; // Default 90
  daysPerWeek?: number; // Default 6
  splitType?: "ppl" | "upper_lower" | "full_body";
  availableEquipment?: EquipmentType[];
  injuries?: string[]; // Injury/pain areas (lowercase)
});
```

---

### Exercise Library

```typescript
import { exampleExerciseLibrary } from "./sample-data";

// Full library (133 exercises)
const exercises = exampleExerciseLibrary();

// Filtered library
const pushExercises = exercises.filter((ex) => ex.splitTags.includes("push"));
const compounds = exercises.filter((ex) => ex.isCompound);
const mainLifts = exercises.filter((ex) => ex.isMainLiftEligible);
```

**Create custom exercises:**
```typescript
import type { Exercise } from "./types";

const customExercise: Exercise = {
  id: "ex-custom-1",
  name: "Custom Bench Press",
  primaryMuscles: ["Chest"],
  secondaryMuscles: ["Front Delts", "Triceps"],
  equipment: ["barbell"],
  movementPatterns: ["horizontal_push"],
  fatigueCost: 4,
  timePerSetSec: 180,
  sfrScore: 4,
  lengthPositionScore: 3,
  isCompound: true,
  isMainLiftEligible: true,
  difficulty: "intermediate",
  splitTags: ["push"],
  jointStress: "medium",
  isUnilateral: false,
  repRangeMin: 5,
  repRangeMax: 12,
};
```

---

### Workout History

```typescript
import { buildHistory } from "./sample-data";

// Empty history (beginner user)
const history: WorkoutHistoryEntry[] = [];

// Basic history builder
const history = buildHistory({
  weeksAgo: 4,
  sessionsPerWeek: 3,
  exerciseIds: ["ex-bench", "ex-squat", "ex-deadlift"],
});

// Custom history entry
const historyEntry: WorkoutHistoryEntry = {
  date: new Date("2026-03-01").toISOString(),
  completed: true,
  exercises: [
    {
      exerciseId: "ex-bench",
      movementPattern: "horizontal_push",
      sets: [
        { exerciseId: "ex-bench", setIndex: 1, reps: 8, rpe: 7, load: 185 },
        { exerciseId: "ex-bench", setIndex: 2, reps: 8, rpe: 7.5, load: 185 },
        { exerciseId: "ex-bench", setIndex: 3, reps: 7, rpe: 8, load: 185 },
      ],
    },
  ],
};
```

---

### Periodization Context

```typescript
import { generateMacroCycle, deriveBlockContext } from "./periodization";

// Generate macro cycle
const macro = generateMacroCycle({
  userId: "test-user",
  startDate: new Date("2026-03-01"),
  durationWeeks: 12,
  trainingAge: "beginner",
  primaryGoal: "hypertrophy",
});

// Get block context for specific date
const blockContext = deriveBlockContext(macro, new Date("2026-03-15"));

// Block context structure
interface BlockContext {
  block: {
    blockType: "accumulation" | "intensification" | "deload";
    weekInBlock: number; // 1-indexed
    totalWeeksInBlock: number;
  };
  mesocycle: {
    mesocycleIndex: number; // 0-indexed
    weekInMesocycle: number; // 1-indexed
  };
}
```

**Manual block context:**
```typescript
const accumulationBlock: BlockContext = {
  block: {
    blockType: "accumulation",
    weekInBlock: 2,
    totalWeeksInBlock: 3,
  },
  mesocycle: {
    mesocycleIndex: 0,
    weekInMesocycle: 2,
  },
};
```

---

### Selection Objective

```typescript
import { createMockObjective } from "./selection-v2/test-utils";

// Basic objective (default weights, empty context)
const objective = createMockObjective(
  new Map([
    ["Chest", 12], // Target 12 sets/week
    ["Triceps", 8],
  ])
);

// With current volume
const objective = createMockObjective(
  new Map([["Chest", 12]]),
  new Map([["Chest", 3]]) // Already did 3 sets this week
);

// Full custom objective
import type { SelectionObjective } from "./selection-v2/types";

const objective: SelectionObjective = {
  constraints: {
    volumeFloor: new Map([["Chest", 6]]),
    volumeCeiling: new Map([["Chest", 22]]),
    timeBudget: 60,
    equipment: new Set(["barbell", "dumbbell", "cable"]),
    contraindications: new Set(["shoulder"]),
    minExercises: 3,
    maxExercises: 8,
  },
  weights: {
    volumeDeficitFill: 0.4,
    rotationNovelty: 0.25,
    sfrEfficiency: 0.15,
    lengthenedBias: 0.1,
    movementDiversity: 0.05,
    sraReadiness: 0.03,
    userPreference: 0.02,
  },
  volumeContext: {
    weeklyTarget: new Map([["Chest", 12]]),
    weeklyActual: new Map([["Chest", 3]]),
    effectiveActual: new Map([["Chest", 3]]),
  },
  rotationContext: new Map([
    ["ex-bench", { lastUsedDaysAgo: 7, noveltyScore: 0.7 }],
  ]),
  sraContext: new Map([
    ["Chest", { readinessScore: 0.9, daysFromLastTraining: 2 }],
  ]),
  preferences: {
    favoriteExerciseIds: new Set(["ex-bench"]),
    avoidExerciseIds: new Set(["ex-decline-bench"]),
  },
};
```

---

## Common Test Patterns

### Testing Prescription Logic

```typescript
describe("prescribeSetsReps", () => {
  it("should prescribe hypertrophy rep range for main lifts", () => {
    const sets = prescribeSetsReps(
      true, // isMainLift
      "intermediate",
      { primary: "hypertrophy", secondary: "none" },
      { readinessScore: 3, missedLastSession: false }
    );

    expect(sets[0].targetReps).toBeGreaterThanOrEqual(6);
    expect(sets[0].targetReps).toBeLessThanOrEqual(10);
  });

  it("should prescribe more sets for advanced lifters", () => {
    const beginnerSets = prescribeSetsReps(true, "beginner", hypertrophyGoals, defaultFatigue);
    const advancedSets = prescribeSetsReps(true, "advanced", hypertrophyGoals, defaultFatigue);

    expect(advancedSets.length).toBeGreaterThan(beginnerSets.length);
  });
});
```

---

### Testing Volume Calculation

```typescript
describe("calculateVolumeLandmarks", () => {
  it("should return higher MAV for advanced lifters", () => {
    const beginnerLandmarks = calculateVolumeLandmarks("Chest", "beginner");
    const advancedLandmarks = calculateVolumeLandmarks("Chest", "advanced");

    expect(advancedLandmarks.mav).toBeGreaterThan(beginnerLandmarks.mav);
  });

  it("should calculate indirect volume correctly", () => {
    const directVolume = 8; // 8 sets bench press (chest primary)
    const indirectVolume = directVolume * 0.3; // Front delts secondary

    expect(indirectVolume).toBe(2.4);
  });
});
```

---

### Testing Exercise Selection

```typescript
describe("selectExercisesOptimized", () => {
  it("should respect equipment constraints", () => {
    const exercises = exampleExerciseLibrary();
    const objective = createMockObjective(
      new Map([["Chest", 12]]),
      new Map(),
      {
        equipment: new Set(["barbell"]), // Only barbell available
      }
    );

    const result = selectExercisesOptimized(exercises, objective);

    // All selected exercises should use barbell
    for (const candidate of result.selected) {
      expect(candidate.exercise.equipment).toContain("barbell");
    }
  });

  it("should fill volume deficit", () => {
    const result = selectExercisesOptimized(exercises, objective);

    const chestVolume = result.volumeFilled.get("Chest") ?? 0;
    const chestTarget = objective.volumeContext.weeklyTarget.get("Chest") ?? 0;

    expect(chestVolume).toBeGreaterThanOrEqual(chestTarget * 0.8); // At least 80% of target
  });
});
```

---

### Testing Periodization

```typescript
describe("prescribeWithBlock", () => {
  it("should increase volume during accumulation", () => {
    const basePrescription = { sets: 4, reps: 8, rir: 2, restSec: 120 };

    // Week 1 vs Week 3 of accumulation
    const week1 = prescribeWithBlock({
      basePrescription,
      blockContext: createAccumulationBlock(weekInBlock: 1),
    });
    const week3 = prescribeWithBlock({
      basePrescription,
      blockContext: createAccumulationBlock(weekInBlock: 3),
    });

    expect(week3.sets).toBeGreaterThan(week1.sets);
  });

  it("should reduce volume during deload", () => {
    const basePrescription = { sets: 4, reps: 8, rir: 2, restSec: 120 };
    const deloadContext = createDeloadBlock();

    const result = prescribeWithBlock({ basePrescription, blockContext: deloadContext });

    expect(result.sets).toBe(2); // 4 * 0.5 = 2
    expect(result.rir).toBe(7); // 2 + 5 = 7
  });
});
```

---

### Testing Autoregulation

```typescript
describe("applyAutoregulation", () => {
  it("should scale down volume when fatigued", async () => {
    // Create readiness signal indicating fatigue
    await prisma.readinessSignal.create({
      data: {
        userId: "test-user",
        subjectiveReadiness: 2, // Low readiness
        performanceRpeDeviation: 2.0, // Felt much harder than prescribed
        performanceStalls: 2,
        performanceCompliance: 0.7,
        fatigueScoreOverall: 0.28, // Below 0.31 threshold
      },
    });

    const autoregulated = await applyAutoregulation(userId, workout);

    expect(autoregulated.wasAutoregulated).toBe(true);
    expect(autoregulated.modifications).toContain("scaled_down");
  });
});
```

---

### Testing Explainability

```typescript
describe("explainExerciseRationale", () => {
  it("should extract top 2-3 primary reasons", () => {
    const candidate = createCandidate(exercise, {
      deficitFill: 0.9, // Top
      rotationNovelty: 0.8, // Second
      sfrScore: 0.7, // Third
      lengthenedScore: 0.5, // Below 0.6 threshold
    });

    const rationale = explainExerciseRationale(candidate, objective, library);

    expect(rationale.primaryReasons).toHaveLength(3);
    expect(rationale.primaryReasons[0]).toContain("deficit");
  });

  it("should cite research for lengthened exercises", () => {
    const exercise = createExercise({
      name: "Overhead Triceps Extension",
      lengthPositionScore: 5,
    });

    const rationale = explainExerciseRationale(candidate, objective, library);

    expect(rationale.citations.length).toBeGreaterThan(0);
    expect(rationale.citations[0].authors).toBeTruthy();
    expect(rationale.citations[0].year).toBeGreaterThan(2000);
  });
});
```

---

## Assertion Patterns

### Basic Assertions
```typescript
// Equality
expect(result.sets).toBe(4);
expect(result.name).toBe("Bench Press");

// Truthiness
expect(result.wasAutoregulated).toBe(true);
expect(candidate).toBeDefined();
expect(value).toBeNull();

// Comparisons
expect(result.volume).toBeGreaterThan(10);
expect(result.fatigue).toBeLessThan(0.5);
expect(result.sets).toBeGreaterThanOrEqual(3);
expect(result.sets).toBeLessThanOrEqual(5);
```

---

### Array Assertions
```typescript
// Length
expect(exercises).toHaveLength(8);
expect(exercises.length).toBeGreaterThan(0);

// Inclusion
expect(exerciseIds).toContain("ex-bench");
expect(selectedExercises.some((ex) => ex.id === "ex-bench")).toBe(true);

// All/None
expect(exercises.every((ex) => ex.isCompound)).toBe(true);
expect(exercises.some((ex) => ex.id === "invalid")).toBe(false);
```

---

### Object Assertions
```typescript
// Shape matching
expect(result).toMatchObject({
  sets: expect.any(Number),
  reps: expect.any(Number),
  rir: expect.any(Number),
});

// Property presence
expect(result).toHaveProperty("sets");
expect(result).toHaveProperty("rationale.primaryReasons");

// Nested properties
expect(result.volumeFilled.get("Chest")).toBeGreaterThan(0);
```

---

### String Assertions
```typescript
// Inclusion
expect(rationale.primaryReasons[0]).toContain("deficit");
expect(exerciseName.toLowerCase()).toContain("bench");

// Regex
expect(citation.finding).toMatch(/hypertrophy/i);

// Length
expect(explanation.length).toBeGreaterThan(10);
```

---

## Error Handling Tests

```typescript
describe("Error Handling", () => {
  it("should throw when no exercises available", () => {
    const emptyLibrary: Exercise[] = [];
    const objective = createMockObjective(new Map([["Chest", 12]]));

    expect(() => {
      selectExercisesOptimized(emptyLibrary, objective);
    }).toThrow();
  });

  it("should return error result when constraints impossible", () => {
    const objective = createMockObjective(
      new Map([["Chest", 50]]), // Impossible target
      undefined,
      { timeBudget: 10 } // Too little time
    );

    const result = selectExercisesOptimized(exercises, objective);

    expect(result.selected.length).toBeLessThan(objective.constraints.minExercises);
  });
});
```

---

## Testing Randomness

### Always Use Seeded PRNG
```typescript
import { createRng } from "./random";

describe("Exercise Selection", () => {
  it("should produce deterministic results with same seed", () => {
    const rng1 = createRng(12345);
    const rng2 = createRng(12345);

    const result1 = selectExercises(exercises, objective, rng1);
    const result2 = selectExercises(exercises, objective, rng2);

    expect(result1).toEqual(result2);
  });

  it("should produce different results with different seeds", () => {
    const rng1 = createRng(12345);
    const rng2 = createRng(67890);

    const result1 = selectExercises(exercises, objective, rng1);
    const result2 = selectExercises(exercises, objective, rng2);

    expect(result1).not.toEqual(result2);
  });
});
```

---

## Test Organization

### Use Nested `describe` Blocks
```typescript
describe("prescribeSetsReps", () => {
  describe("Hypertrophy Goal", () => {
    it("should prescribe 6-10 reps for main lifts", () => { /* ... */ });
    it("should prescribe 10-15 reps for accessories", () => { /* ... */ });
  });

  describe("Strength Goal", () => {
    it("should prescribe 3-6 reps for main lifts", () => { /* ... */ });
    it("should prescribe 6-10 reps for accessories", () => { /* ... */ });
  });

  describe("Training Age", () => {
    it("should prescribe more sets for advanced lifters", () => { /* ... */ });
    it("should prescribe fewer sets for beginners", () => { /* ... */ });
  });
});
```

---

### Use Descriptive Test Names
```typescript
// ✅ Good: Describes behavior and context
it("should increase volume 20% from week 1 to week 3 during accumulation", () => {});
it("should NOT select OHP after bench press (front delts)", () => {});
it("should trigger deload when fatigue < 0.3", () => {});

// ❌ Bad: Vague or implementation-focused
it("should work correctly", () => {});
it("should call getVolumeMultiplier", () => {});
it("test volume progression", () => {});
```

---

## Debugging Tips

### Use `.only` to Focus on Specific Tests
```typescript
it.only("should increase volume during accumulation", () => {
  // Only this test will run
});
```

### Use `.skip` to Temporarily Disable Tests
```typescript
it.skip("should rotate accessories every 3-4 weeks", () => {
  // This test will be skipped
});
```

### Add Debug Logging
```typescript
it("should select exercises within time budget", () => {
  const result = selectExercisesOptimized(exercises, objective);

  console.log("Selected exercises:", result.selected.map((c) => c.exercise.name));
  console.log("Total time:", result.selected.reduce((sum, c) => sum + c.timeContribution, 0));

  expect(result.selected.length).toBeGreaterThan(0);
});
```

### Check Test Output
```bash
# Verbose output (shows all test names)
npx vitest run --reporter=verbose

# Show console.log output
npx vitest run --reporter=default
```

---

## Common Pitfalls

### ❌ Using `Math.random()` Instead of Seeded PRNG
```typescript
// Bad
const exercises = shuffle(library, Math.random);

// Good
const rng = createRng(12345);
const exercises = shuffle(library, rng);
```

---

### ❌ Testing Implementation Instead of Behavior
```typescript
// Bad
it("should call pruneByTime", () => {
  const spy = vi.spyOn(module, "pruneByTime");
  selectExercises(exercises, objective);
  expect(spy).toHaveBeenCalled();
});

// Good
it("should select exercises within time budget", () => {
  const result = selectExercises(exercises, objective);
  const totalTime = result.selected.reduce((sum, c) => sum + c.timeContribution, 0);
  expect(totalTime).toBeLessThanOrEqual(objective.constraints.timeBudget);
});
```

---

### ❌ Not Co-Locating Tests with Source
```typescript
// Bad
tests/unit/engine/prescription.test.ts
src/lib/engine/prescription.ts

// Good
src/lib/engine/prescription.test.ts
src/lib/engine/prescription.ts
```

---

### ❌ Hardcoding Test Data
```typescript
// Bad
const user = {
  userId: "user-123",
  heightCm: 178,
  weightKg: 82,
  sex: "male",
  age: 30,
  trainingAge: "intermediate",
};

// Good
const user = exampleUser({ trainingAge: "intermediate" });
```

---

## Additional Resources

- [test-overview.md](test-overview.md) — Testing philosophy
- [unit-tests-by-module.md](unit-tests-by-module.md) — Complete test catalog
- [end-to-end-simulation.md](end-to-end-simulation.md) — Multi-week simulation tests
- [running-tests.md](running-tests.md) — Commands and debugging

---

**Last Updated:** 2026-02-16
