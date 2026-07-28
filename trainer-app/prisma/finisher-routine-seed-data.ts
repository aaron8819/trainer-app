export type FinisherRoutineSeed = {
  code: string;
  version: number;
  name: string;
  description: string;
  category: "CORE" | "CONDITIONING";
  difficulty: "EASY" | "MODERATE" | "CHALLENGING";
  fatigueCost: "LOW" | "MODERATE" | "HIGH";
  impactLevel: "LOW" | "MODERATE" | "HIGH";
  preparationSeconds: number;
  includesFinalRecovery: boolean;
  equipmentRequirements: string[];
  bodyRegions: string[];
  limitationTags: string[];
  steps: Array<{
    movementName: string;
    workSeconds: number;
    recoverySeconds: number;
    techniqueCues: string[];
    alternatives?: string[];
  }>;
};

const timedSteps = (
  movements: Array<{
    movementName: string;
    techniqueCues?: string[];
    alternatives?: string[];
  }>
): FinisherRoutineSeed["steps"] =>
  movements.map((movement) => ({
    movementName: movement.movementName,
    workSeconds: 40,
    recoverySeconds: 20,
    techniqueCues: movement.techniqueCues ?? [],
    alternatives: movement.alternatives,
  }));

export const FINISHER_ROUTINE_SEEDS: FinisherRoutineSeed[] = [
  {
    code: "core-stability-10",
    version: 1,
    name: "Core Stability 10",
    description: "Ten controlled core movements using steady 40-second work intervals.",
    category: "CORE",
    difficulty: "MODERATE",
    fatigueCost: "MODERATE",
    impactLevel: "LOW",
    preparationSeconds: 10,
    includesFinalRecovery: true,
    equipmentRequirements: ["BODYWEIGHT", "CABLE", "HANGING_BAR"],
    bodyRegions: ["core", "shoulders", "hips"],
    limitationTags: ["shoulder", "wrist", "lower_back"],
    steps: timedSteps([
      {
        movementName: "Dead Bug",
        techniqueCues: [
          "Slow and controlled.",
          "Keep the lower back pressed into the floor.",
        ],
      },
      {
        movementName: "Front Plank",
        techniqueCues: [
          "Brace the abs and squeeze the glutes.",
          "Do not let the hips sag.",
        ],
      },
      {
        movementName: "Hanging Knee Raise",
        techniqueCues: [
          "Posteriorly tilt the pelvis at the top.",
          "Avoid swinging.",
        ],
        alternatives: ["Captain's Chair Knee Raise"],
      },
      {
        movementName: "Side Plank — Left",
        techniqueCues: [
          "Stack the shoulders and hips, brace the core, and keep the hips lifted.",
          "Maintain a straight line without rotating.",
        ],
      },
      {
        movementName: "Side Plank — Right",
        techniqueCues: [
          "Stack the shoulders and hips, brace the core, and keep the hips lifted.",
          "Maintain a straight line without rotating.",
        ],
      },
      {
        movementName: "Reverse Crunch",
        techniqueCues: [
          "Lift the hips off the floor.",
          "Curl the pelvis upward instead of swinging the legs.",
        ],
      },
      {
        movementName: "Cable Crunch",
        techniqueCues: [
          "Use controlled repetitions.",
          "Exhale hard at the bottom.",
        ],
        alternatives: ["Weighted Crunch"],
      },
      {
        movementName: "Bird Dog",
        techniqueCues: [
          "Use slow, controlled reaches.",
          "Resist torso rotation.",
        ],
      },
      {
        movementName: "Hollow Body Hold",
        techniqueCues: [
          "Bend the knees if needed to keep the lower back flat.",
        ],
      },
      {
        movementName: "Mountain Climbers",
        techniqueCues: [
          "Move quickly but under control.",
          "Keep the hips level.",
        ],
      },
    ]),
  },
  {
    code: "core-control-8",
    version: 1,
    name: "Core Control 8",
    description: "An eight-minute low-impact sequence focused on bracing and resisting rotation.",
    category: "CORE",
    difficulty: "EASY",
    fatigueCost: "LOW",
    impactLevel: "LOW",
    preparationSeconds: 10,
    includesFinalRecovery: true,
    equipmentRequirements: ["BODYWEIGHT", "BAND"],
    bodyRegions: ["core", "shoulders"],
    limitationTags: ["shoulder", "wrist", "lower_back"],
    steps: timedSteps([
      { movementName: "Heel Tap Dead Bug" },
      { movementName: "Bear Plank Hold", alternatives: ["Forearm Plank Hold"] },
      { movementName: "Bird Dog — Left Lead" },
      { movementName: "Bird Dog — Right Lead" },
      { movementName: "Side Plank from Knees — Left" },
      { movementName: "Side Plank from Knees — Right" },
      { movementName: "Band Pallof Press — Left", alternatives: ["Tall-Kneeling Brace Hold"] },
      { movementName: "Band Pallof Press — Right", alternatives: ["Tall-Kneeling Brace Hold"] },
    ]),
  },
  {
    code: "low-impact-conditioning-8",
    version: 1,
    name: "Low-Impact Conditioning 8",
    description: "Eight minutes of continuous, joint-conscious bodyweight conditioning.",
    category: "CONDITIONING",
    difficulty: "EASY",
    fatigueCost: "LOW",
    impactLevel: "LOW",
    preparationSeconds: 10,
    includesFinalRecovery: true,
    equipmentRequirements: ["BODYWEIGHT"],
    bodyRegions: ["full_body", "legs"],
    limitationTags: ["knee", "hip", "ankle"],
    steps: timedSteps([
      { movementName: "Fast March in Place" },
      { movementName: "Step Jack" },
      { movementName: "Alternating Knee Drive" },
      { movementName: "Lateral Step and Reach" },
      { movementName: "Boxer Step" },
      { movementName: "Alternating Reverse Step" },
      { movementName: "Standing Cross-Body Crunch" },
      { movementName: "Fast March with Arm Drive" },
    ]),
  },
  {
    code: "bodyweight-conditioning-6",
    version: 1,
    name: "Bodyweight Conditioning 6",
    description: "A short, higher-impact conditioning sequence for days with room for extra leg demand.",
    category: "CONDITIONING",
    difficulty: "CHALLENGING",
    fatigueCost: "HIGH",
    impactLevel: "HIGH",
    preparationSeconds: 10,
    includesFinalRecovery: true,
    equipmentRequirements: ["BODYWEIGHT"],
    bodyRegions: ["full_body", "legs"],
    limitationTags: ["knee", "hip", "ankle", "shoulder", "wrist"],
    steps: timedSteps([
      { movementName: "Jumping Jack", alternatives: ["Step Jack"] },
      { movementName: "Squat Thrust", alternatives: ["Hands-Elevated Squat Thrust"] },
      { movementName: "Skater Step" },
      { movementName: "High Knees", alternatives: ["Fast March"] },
      { movementName: "Mountain Climbers", alternatives: ["Incline Mountain Climbers"] },
      { movementName: "Quick Feet" },
    ]),
  },
];

export function deriveFinisherDurationSeconds(
  routine: Pick<FinisherRoutineSeed, "steps" | "includesFinalRecovery">
): number {
  return routine.steps.reduce((total, step, index) => {
    const includeRecovery =
      index < routine.steps.length - 1 || routine.includesFinalRecovery;
    return total + step.workSeconds + (includeRecovery ? step.recoverySeconds : 0);
  }, 0);
}
