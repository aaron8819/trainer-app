export type LoadPrescriptionScenario = {
  id: string;
  description: string;
  prior: {
    performedLoad: number;
    performedReps?: number;
    actualRpe?: number;
    prescribedLoad: number;
    prescribedReps: number;
    prescribedRepMin?: number;
    prescribedRpe: number;
  };
  current: {
    prescribedReps: number;
    prescribedRpe: number;
  };
  increment: number;
  expected: {
    direction: "increase" | "decrease" | "hold" | "deload";
    targetLoad?: number;
    review?: "successful_autoregulation" | "watch";
  };
  history?: Array<{
    successful: boolean;
  }>;
  isDeload?: boolean;
  completedWorkingSetCount?: number;
};

/**
 * Canonical load-prescription calibration matrix. These cases intentionally
 * describe product behavior independently of any single engine entry point so
 * progression, generation, coaching, and review tests can share the contract.
 */
export const LOAD_PRESCRIPTION_SCENARIOS: readonly LoadPrescriptionScenario[] = [
  {
    id: "A",
    description: "same reps/RPE and prior result on target",
    prior: { performedLoad: 100, performedReps: 10, actualRpe: 8, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "hold", targetLoad: 100 },
  },
  {
    id: "B",
    description: "prior result approximately 2 RPE easier",
    prior: { performedLoad: 100, performedReps: 10, actualRpe: 6, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "increase", targetLoad: 105 },
  },
  {
    id: "C",
    description: "prior result approximately 2 RPE harder",
    prior: { performedLoad: 100, performedReps: 10, actualRpe: 10, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "decrease", targetLoad: 95 },
  },
  {
    id: "D",
    description: "performed above target but landed at intended reps/RPE",
    prior: { performedLoad: 105, performedReps: 10, actualRpe: 8, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "hold", targetLoad: 105, review: "successful_autoregulation" },
  },
  {
    id: "E",
    description: "performed below target but landed at intended reps/RPE",
    prior: { performedLoad: 95, performedReps: 10, actualRpe: 8, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "hold", targetLoad: 95, review: "successful_autoregulation" },
  },
  {
    id: "F",
    description: "same load with successful rep progression",
    prior: { performedLoad: 100, performedReps: 12, actualRpe: 8, prescribedLoad: 100, prescribedReps: 12, prescribedRpe: 8 },
    current: { prescribedReps: 12, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "hold", targetLoad: 100 },
  },
  {
    id: "G",
    description: "today's reps decrease while target RPE rises",
    prior: { performedLoad: 100, performedReps: 12, actualRpe: 8, prescribedLoad: 100, prescribedReps: 12, prescribedRpe: 8 },
    current: { prescribedReps: 8, prescribedRpe: 9 },
    increment: 5,
    expected: { direction: "increase", targetLoad: 105 },
  },
  {
    id: "H",
    description: "deload week remains the canonical 70 percent path",
    prior: { performedLoad: 100, performedReps: 10, actualRpe: 8, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 6 },
    increment: 5,
    expected: { direction: "deload", targetLoad: 70 },
    isDeload: true,
  },
  {
    id: "I",
    description: "valid 5 lb increment",
    prior: { performedLoad: 100, performedReps: 10, actualRpe: 6, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "increase", targetLoad: 105 },
  },
  {
    id: "J",
    description: "valid 10 lb increment",
    prior: { performedLoad: 100, performedReps: 10, actualRpe: 6, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 10,
    expected: { direction: "increase", targetLoad: 110 },
  },
  {
    id: "K",
    description: "first set supports one increment up",
    prior: { performedLoad: 100, performedReps: 12, actualRpe: 7, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "increase", targetLoad: 105 },
    completedWorkingSetCount: 1,
  },
  {
    id: "L",
    description: "first set supports one increment down",
    prior: { performedLoad: 100, performedReps: 8, actualRpe: 9, prescribedLoad: 100, prescribedReps: 10, prescribedRepMin: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "decrease", targetLoad: 95 },
    completedWorkingSetCount: 1,
  },
  {
    id: "M",
    description: "missing actual RPE is interpreted conservatively",
    prior: { performedLoad: 100, performedReps: 12, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "hold", targetLoad: 100 },
  },
  {
    id: "N",
    description: "partial or incomplete working sets do not become reliable evidence",
    prior: { performedLoad: 100, performedReps: 8, actualRpe: 9, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "hold", targetLoad: 100 },
    completedWorkingSetCount: 0,
  },
  {
    id: "O",
    description: "two successful exposures out of the latest three",
    prior: { performedLoad: 100, performedReps: 10, actualRpe: 8, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "increase", targetLoad: 105 },
    history: [{ successful: true }, { successful: false }, { successful: true }],
  },
  {
    id: "P",
    description: "one isolated deviation without repeated evidence",
    prior: { performedLoad: 105, performedReps: 10, actualRpe: 8, prescribedLoad: 100, prescribedReps: 10, prescribedRpe: 8 },
    current: { prescribedReps: 10, prescribedRpe: 8 },
    increment: 5,
    expected: { direction: "hold", targetLoad: 105, review: "watch" },
    history: [{ successful: true }, { successful: false }, { successful: false }],
  },
];
