import { describe, it, expect } from "vitest";
import {
  explainPrescriptionRationale,
  explainSetCount,
  explainRepTarget,
  explainLoadChoice,
  explainRirTarget,
  explainRestPeriod,
  type PrescriptionRationaleContext,
} from "./prescription-rationale";
import type { Exercise, WorkoutSet, Goals, UserProfile } from "../types";
import type { PeriodizationModifiers } from "../rules";

// --- Test Fixtures ---

const exampleExercise: Exercise = {
  id: "bench-press",
  name: "Barbell Bench Press",
  primaryMuscles: ["Chest"],
  secondaryMuscles: ["Front Delts", "Triceps"],
  equipment: ["barbell"],
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "moderate",
  fatigueCost: 4,
  isCompound: true,
  sfrScore: 5,
  lengthPositionScore: 3,
  timePerSetSec: 60,
};

const exampleIsolation: Exercise = {
  id: "tricep-extension",
  name: "Overhead Tricep Extension",
  primaryMuscles: ["Triceps"],
  secondaryMuscles: [],
  equipment: ["dumbbell"],
  movementPatterns: ["extension"],
  splitTags: ["push"],
  jointStress: "low",
  fatigueCost: 2,
  isCompound: false,
  sfrScore: 4,
  lengthPositionScore: 5,
  timePerSetSec: 40,
};

const exampleGoals: Goals = {
  primary: "hypertrophy",
  secondary: "none",
};

const exampleProfile: Pick<UserProfile, "trainingAge"> = {
  trainingAge: "intermediate",
};

const exampleSets: WorkoutSet[] = [
  { setIndex: 1, targetReps: 8, targetRpe: 8.0, targetLoad: 100 },
  { setIndex: 2, targetReps: 8, targetRpe: 8.0, targetLoad: 88 },
  { setIndex: 3, targetReps: 8, targetRpe: 8.0, targetLoad: 88 },
];

const accumulationPeriodization: PeriodizationModifiers = {
  rpeOffset: -1.0,
  setMultiplier: 1.2,
  backOffMultiplier: 0.88,
  isDeload: false,
};

const intensificationPeriodization: PeriodizationModifiers = {
  rpeOffset: 0.5,
  setMultiplier: 1.0,
  backOffMultiplier: 0.88,
  isDeload: false,
};

const deloadPeriodization: PeriodizationModifiers = {
  rpeOffset: -2.0,
  setMultiplier: 0.5,
  backOffMultiplier: 0.75,
  isDeload: true,
};

// --- Test Suite ---

describe("explainPrescriptionRationale", () => {
  it("generates complete prescription rationale for main lift", () => {
    const context: PrescriptionRationaleContext = {
      exercise: exampleExercise,
      sets: exampleSets,
      isMainLift: true,
      goals: exampleGoals,
      profile: exampleProfile,
      periodization: accumulationPeriodization,
      weekInMesocycle: 2,
      lastSessionLoad: 97.5,
      restSeconds: 180,
    };

    const rationale = explainPrescriptionRationale(context);

    expect(rationale.exerciseName).toBe("Barbell Bench Press");
    expect(rationale.sets.count).toBe(3);
    expect(rationale.reps.target).toBe(8);
    expect(rationale.load.load).toBe(100);
    expect(rationale.rir.target).toBe(2); // 10 - 8.0 RPE
    expect(rationale.rest.seconds).toBe(180);
    expect(rationale.overallNarrative).toContain("3×8 @ 100lbs");
  });

  it("generates rationale for accessory exercise", () => {
    const sets: WorkoutSet[] = [
      { setIndex: 1, targetReps: 12, targetRpe: 8.5, targetLoad: 20 },
      { setIndex: 2, targetReps: 12, targetRpe: 8.5, targetLoad: 20 },
      { setIndex: 3, targetReps: 12, targetRpe: 8.5, targetLoad: 20 },
    ];

    const context: PrescriptionRationaleContext = {
      exercise: exampleIsolation,
      sets,
      isMainLift: false,
      goals: exampleGoals,
      profile: exampleProfile,
      restSeconds: 90,
    };

    const rationale = explainPrescriptionRationale(context);

    expect(rationale.exerciseName).toBe("Overhead Tricep Extension");
    expect(rationale.sets.reason).toContain("accessory");
    expect(rationale.rest.exerciseType).toBe("isolation");
  });

  it("handles bodyweight exercises", () => {
    const bodyweightExercise: Exercise = {
      ...exampleExercise,
      id: "pullup",
      name: "Pull-up",
      equipment: ["bodyweight"],
    };

    const sets: WorkoutSet[] = [
      { setIndex: 1, targetReps: 8, targetRpe: 8.0, targetLoad: undefined },
    ];

    const context: PrescriptionRationaleContext = {
      exercise: bodyweightExercise,
      sets,
      isMainLift: false,
      goals: exampleGoals,
      profile: exampleProfile,
    };

    const rationale = explainPrescriptionRationale(context);

    expect(rationale.load.reason).toContain("Bodyweight exercise");
    expect(rationale.overallNarrative).toContain("BW");
  });

  it("throws error when no sets provided", () => {
    const context: PrescriptionRationaleContext = {
      exercise: exampleExercise,
      sets: [],
      isMainLift: true,
      goals: exampleGoals,
      profile: exampleProfile,
    };

    expect(() => explainPrescriptionRationale(context)).toThrow(
      "No sets provided for prescription rationale"
    );
  });
});

describe("explainSetCount", () => {
  it("explains standard main lift set count", () => {
    const rationale = explainSetCount(4, true, "intermediate", undefined);

    expect(rationale.count).toBe(4);
    expect(rationale.reason).toContain("main lift");
    expect(rationale.blockContext).toBe("Standard progression");
  });

  it("explains beginner volume reduction", () => {
    const rationale = explainSetCount(3, true, "beginner", undefined);

    expect(rationale.count).toBe(3);
    expect(rationale.reason).toContain("beginner");
    expect(rationale.reason).toContain("-15%");
  });

  it("explains advanced volume increase", () => {
    const rationale = explainSetCount(5, true, "advanced", undefined);

    expect(rationale.count).toBe(5);
    expect(rationale.reason).toContain("advanced");
    expect(rationale.reason).toContain("+15%");
  });

  it("explains accumulation phase volume", () => {
    const rationale = explainSetCount(4, true, "intermediate", accumulationPeriodization);

    expect(rationale.reason).toContain("accumulation phase");
    expect(rationale.reason).toContain("building volume");
    expect(rationale.blockContext).toContain("Accumulation");
  });

  it("explains intensification phase", () => {
    const rationale = explainSetCount(4, true, "intermediate", intensificationPeriodization);

    expect(rationale.reason).toContain("intensification phase");
    expect(rationale.blockContext).toContain("Intensification");
  });

  it("explains deload week volume reduction", () => {
    const rationale = explainSetCount(2, true, "intermediate", deloadPeriodization);

    expect(rationale.reason).toContain("deload week");
    expect(rationale.reason).toContain("reduced volume to promote recovery");
    expect(rationale.blockContext).toBe("Deload week");
  });

  it("explains accessory set count", () => {
    const rationale = explainSetCount(3, false, "intermediate", undefined);

    expect(rationale.reason).toContain("accessory");
    expect(rationale.reason).toContain("3-set protocol");
  });

  it("uses explicit blockType over multiplier-inferred phase (accumulation week 1 fix)", () => {
    // Week 0 periodization: setMultiplier=1.0 fails the >1.1 accumulation check —
    // without blockType it would fall through to "Standard progression".
    const weekZeroPeriodization: PeriodizationModifiers = {
      rpeOffset: -1.5,
      setMultiplier: 1.0,
      backOffMultiplier: 0.88,
      isDeload: false,
    };
    const rationale = explainSetCount(4, true, "intermediate", weekZeroPeriodization, "accumulation");
    expect(rationale.blockContext).toContain("Accumulation");
    expect(rationale.reason).toContain("accumulation phase");
  });
});

describe("explainRepTarget", () => {
  it("explains hypertrophy rep range for main lift", () => {
    const rationale = explainRepTarget(8, "hypertrophy", true, undefined);

    expect(rationale.target).toBe(8);
    expect(rationale.reason).toContain("muscle growth");
    expect(rationale.reason).toContain("6-10 rep range");
  });

  it("explains strength rep range", () => {
    const rationale = explainRepTarget(5, "strength", true, undefined);

    expect(rationale.target).toBe(5);
    expect(rationale.reason).toContain("maximal strength");
    expect(rationale.reason).toContain("3-6 rep range");
  });

  it("explains fat loss rep range for accessories", () => {
    const rationale = explainRepTarget(15, "fat_loss", false, undefined);

    expect(rationale.target).toBe(15);
    expect(rationale.reason).toContain("metabolic stress");
    expect(rationale.reason).toContain("12-20 rep range");
  });

  it("explains exercise-constrained rep range", () => {
    const exerciseConstraints = { min: 10, max: 20 };
    const rationale = explainRepTarget(12, "hypertrophy", false, exerciseConstraints);

    expect(rationale.target).toBe(12);
    expect(rationale.exerciseConstraints).toContain("10-20 rep range");
  });

  it("explains athleticism goal", () => {
    const rationale = explainRepTarget(6, "athleticism", true, undefined);

    expect(rationale.reason).toContain("power and athleticism");
    expect(rationale.reason).toContain("4-8 rep range");
  });

  it("explains general health goal", () => {
    const rationale = explainRepTarget(10, "general_health", true, undefined);

    expect(rationale.reason).toContain("general fitness");
    expect(rationale.reason).toContain("8-12 rep range");
  });
});

describe("explainLoadChoice", () => {
  it("explains load increase with linear progression", () => {
    const rationale = explainLoadChoice(102.5, 100, 8, 8, "beginner", undefined);

    expect(rationale.load).toBe(102.5);
    expect(rationale.progressionType).toBe("linear");
    expect(rationale.reason).toContain("Increased from 100kg");
    expect(rationale.reason).toContain("linear progression");
  });

  it("explains double progression", () => {
    const rationale = explainLoadChoice(102.5, 100, 8, 10, "intermediate", undefined);

    expect(rationale.progressionType).toBe("double");
    expect(rationale.reason).toContain("double progression");
  });

  it("explains autoregulated progression", () => {
    const rationale = explainLoadChoice(105, 100, 8, 8, "advanced", undefined);

    expect(rationale.progressionType).toBe("autoregulated");
    expect(rationale.reason).toContain("autoregulated based on performance");
  });

  it("explains maintained load", () => {
    const rationale = explainLoadChoice(100, 100, 8, 8, "intermediate", undefined);

    expect(rationale.reason).toContain("Maintained at 100kg");
  });

  it("explains deload reduction", () => {
    const rationale = explainLoadChoice(50, 100, 8, 8, "intermediate", deloadPeriodization);

    expect(rationale.reason).toContain("Reduced from 100kg");
    expect(rationale.reason).toContain("deload for recovery");
  });

  it("explains load reduction for fatigue management", () => {
    const rationale = explainLoadChoice(95, 100, 8, 8, "intermediate", undefined);

    expect(rationale.reason).toContain("Reduced from 100kg");
    expect(rationale.reason).toContain("manage fatigue");
  });

  it("explains initial baseline load", () => {
    const rationale = explainLoadChoice(80, undefined, undefined, 8, "intermediate", undefined);

    expect(rationale.reason).toContain("Initial working weight");
    expect(rationale.reason).toContain("baseline or estimated");
  });

  it("explains bodyweight exercise", () => {
    const rationale = explainLoadChoice(
      undefined,
      undefined,
      undefined,
      8,
      "intermediate",
      undefined
    );

    expect(rationale.load).toBe(0);
    expect(rationale.progressionType).toBe("autoregulated");
    expect(rationale.reason).toContain("Bodyweight exercise");
  });

  it("includes progression context for accumulation", () => {
    const rationale = explainLoadChoice(
      105,
      100,
      8,
      8,
      "intermediate",
      accumulationPeriodization
    );

    expect(rationale.progressionContext).toContain("Volume accumulation");
  });
});

describe("explainRirTarget", () => {
  it("explains early mesocycle RIR (conservative)", () => {
    const rationale = explainRirTarget(
      7.0,
      1,
      "intermediate",
      "hypertrophy",
      true,
      undefined
    );

    expect(rationale.target).toBe(3); // 10 - 7.0
    expect(rationale.reason).toContain("week 1");
    expect(rationale.reason).toContain("conservative intensity");
  });

  it("explains middle mesocycle RIR", () => {
    const rationale = explainRirTarget(
      8.0,
      2,
      "intermediate",
      "hypertrophy",
      true,
      undefined
    );

    expect(rationale.target).toBe(2);
    expect(rationale.reason).toContain("week 2");
    expect(rationale.reason).toContain("moderate intensity");
  });

  it("explains late mesocycle RIR (peak)", () => {
    const rationale = explainRirTarget(
      9.0,
      3,
      "intermediate",
      "hypertrophy",
      true,
      undefined
    );

    expect(rationale.target).toBe(1);
    expect(rationale.reason).toContain("week 3");
    expect(rationale.reason).toContain("peak intensity");
  });

  it("explains deload RIR", () => {
    const rationale = explainRirTarget(
      6.0,
      undefined,
      "intermediate",
      "hypertrophy",
      true,
      deloadPeriodization
    );

    expect(rationale.target).toBe(4);
    expect(rationale.reason).toContain("deload week");
    expect(rationale.reason).toContain("reduced intensity for recovery");
  });

  it("explains strength goal RIR", () => {
    const rationale = explainRirTarget(
      8.5,
      undefined,
      "intermediate",
      "strength",
      true,
      undefined
    );

    expect(rationale.reason).toContain("high intensity");
    expect(rationale.reason).toContain("strength adaptation");
  });

  it("explains fat loss goal RIR", () => {
    const rationale = explainRirTarget(
      7.0,
      undefined,
      "intermediate",
      "fat_loss",
      false,
      undefined
    );

    expect(rationale.reason).toContain("moderate intensity");
    expect(rationale.reason).toContain("metabolic demand");
  });

  it("includes training age context for beginner", () => {
    const rationale = explainRirTarget(
      7.0,
      undefined,
      "beginner",
      "hypertrophy",
      true,
      undefined
    );

    expect(rationale.trainingAge).toContain("Beginner");
    expect(rationale.trainingAge).toContain("Conservative RIR targets");
  });

  it("includes training age context for advanced", () => {
    const rationale = explainRirTarget(
      9.0,
      undefined,
      "advanced",
      "hypertrophy",
      true,
      undefined
    );

    expect(rationale.trainingAge).toContain("Advanced");
    expect(rationale.trainingAge).toContain("accurately gauge proximity to failure");
  });
});

describe("explainRestPeriod", () => {
  it("explains heavy compound rest (5 reps)", () => {
    const rationale = explainRestPeriod(300, exampleExercise, true, 5);

    expect(rationale.seconds).toBe(300);
    expect(rationale.exerciseType).toBe("heavy_compound");
    expect(rationale.reason).toContain("5 min");
    expect(rationale.reason).toContain("heavy compound");
    expect(rationale.reason).toContain("CNS demand");
  });

  it("explains main lift moderate reps", () => {
    const rationale = explainRestPeriod(180, exampleExercise, true, 8);

    expect(rationale.seconds).toBe(180);
    expect(rationale.exerciseType).toBe("heavy_compound");
    expect(rationale.reason).toContain("3 min");
    expect(rationale.reason).toContain("compound");
  });

  it("explains compound accessory low reps", () => {
    const rationale = explainRestPeriod(150, exampleExercise, false, 6);

    expect(rationale.seconds).toBe(150);
    expect(rationale.exerciseType).toBe("moderate_compound");
    expect(rationale.reason).toContain("compound accessory");
    expect(rationale.reason).toContain("2–3 min recovery");
  });

  it("explains compound accessory high reps", () => {
    const rationale = explainRestPeriod(150, exampleExercise, false, 12);

    expect(rationale.seconds).toBe(150);
    expect(rationale.exerciseType).toBe("moderate_compound");
    expect(rationale.reason).toContain("compound accessory");
    expect(rationale.reason).toContain("2–3 min recovery");
  });

  it("explains isolation rest", () => {
    const rationale = explainRestPeriod(90, exampleIsolation, false, 12);

    expect(rationale.seconds).toBe(90);
    expect(rationale.exerciseType).toBe("isolation");
    expect(rationale.reason).toContain("isolation");
    expect(rationale.reason).toContain("local fatigue");
    expect(rationale.reason).toContain("90s"); // sub-2-min shown in seconds, not "2 min"
  });

  it("uses default rest when not provided", () => {
    const rationale = explainRestPeriod(undefined, exampleExercise, true, 5);

    expect(rationale.seconds).toBe(120); // Default 2 min
  });

  it("accounts for fatigue cost in main lift rest", () => {
    const highFatigueExercise: Exercise = { ...exampleExercise, fatigueCost: 5 };
    const rationale = explainRestPeriod(180, highFatigueExercise, true, 8);

    expect(rationale.reason).toContain("high systemic fatigue");
  });
});
