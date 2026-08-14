import { describe, expect, it, vi } from "vitest";

import { buildV2AcceptedPlannerIntentDto } from "@/lib/engine/planning/v2";
import { buildMesocycleSlotPlanSeed } from "../mesocycle-handoff-slot-plan-projection";
import { resolveRequiredSeededSlotPlan } from "./slot-plan-seed";
import type { MappedGenerationContext } from "./types";

function makeMapped(slotPlanSeedJson: unknown): MappedGenerationContext {
  return {
    activeMesocycle: {
      slotPlanSeedJson,
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
    },
    mappedConstraints: {
      weeklySchedule: ["upper"],
    },
    exerciseLibrary: [
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["upper"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
      },
    ],
    history: [],
  } as unknown as MappedGenerationContext;
}

describe("resolveRequiredSeededSlotPlan", () => {
  it("prefers the current V4 revision and resolves the lifecycle week exactly", () => {
    const prescriptions = [1, 2, 3, 4, 5].map((week) => ({
      week,
      status: "PRESCRIBE" as const,
      setCount: week === 4 ? 2 : 3,
      reps: week === 4
        ? { kind: "EXACT" as const, reps: 7 }
        : { kind: "RANGE" as const, min: 8, max: 10 },
      rir: { kind: "TARGET_RANGE" as const, min: 1, max: 2 },
    }));
    const v4 = {
      version: 4 as const,
      source: "custom_hypertrophy_plan_v2" as const,
      settings: { equipmentProfile: "FULL_GYM" as const, sessionDurationMinutes: 60 as const },
      weeks: [1, 2, 3, 4, 5].map((week) => ({
        week,
        phase: week === 5 ? "DELOAD" as const : "ACCUMULATION" as const,
      })),
      slots: [
        { slotId: "upper_a", name: "Upper", focus: "UPPER" as const, exerciseId: "bench" },
        { slotId: "lower_a", name: "Lower", focus: "LOWER" as const, exerciseId: "row" },
      ].map((slot) => ({
        slotId: slot.slotId,
        name: slot.name,
        focus: slot.focus,
        exercises: [{
          placementId: `${slot.slotId}-placement`,
          exerciseId: slot.exerciseId,
          role: "CORE_COMPOUND" as const,
          intent: {
            userRole: "PRIMARY_LIFT" as const,
            target: {
              kind: "movement_pattern" as const,
              movementPattern: slot.focus === "UPPER" ? "horizontal_push" as const : "hinge" as const,
            },
          },
          measurement: {
            profile: "REPS_EXTERNAL_LOAD" as const,
            loadConvention: "BARBELL_TOTAL" as const,
            repBasis: "TOTAL" as const,
          },
          prescriptions,
        }],
      })),
    };
    const mapped = makeMapped({
      version: 1,
      slots: [{
        slotId: "upper_a",
        exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 9 }],
      }],
    });
    mapped.lifecycleWeek = 4;
    mapped.activeMesocycle!.currentSeedRevision = { seedPayload: v4 } as never;
    mapped.activeMesocycle!.slotSequenceJson = {
      version: 1,
      source: "custom_hypertrophy_plan_v2",
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
      ],
    };
    mapped.exerciseLibrary.push({
      ...mapped.exerciseLibrary[0]!,
      id: "row",
      name: "Barbell Row",
    });

    const resolved = resolveRequiredSeededSlotPlan({
      mapped,
      sessionIntent: "upper",
      slotId: "upper_a",
    });

    expect(resolved).toMatchObject({
      slotId: "upper_a",
      hasExactWeeklyPrescriptions: true,
      setCountOverrides: { bench: 2 },
      exercises: [{
        placementId: "upper_a-placement",
        exerciseId: "bench",
        setCount: 2,
        reps: { kind: "EXACT", reps: 7 },
        targetRpe: 8.5,
      }],
    });
  });

  it("serializes acceptedPlannerIntent only when explicitly provided", () => {
    const seedWithoutMetadata = buildMesocycleSlotPlanSeed({
      slotSequence: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [
            {
              exerciseId: "bench",
              name: "Bench Press",
              role: "CORE_COMPOUND",
              setCount: 5,
            },
          ],
        },
      ],
    });
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();
    const seedWithMetadata = buildMesocycleSlotPlanSeed({
      slotSequence: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [
            {
              exerciseId: "bench",
              name: "Bench Press",
              role: "CORE_COMPOUND",
              setCount: 5,
            },
          ],
        },
      ],
      acceptedPlannerIntent,
    });

    expect(seedWithoutMetadata).not.toHaveProperty("acceptedPlannerIntent");
    expect(seedWithMetadata.acceptedPlannerIntent).toEqual(acceptedPlannerIntent);
  });

  it("whitelists acceptedPlannerIntent and drops diagnostic/debug fields", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();
    const rawPlannerObject = {
      ...acceptedPlannerIntent,
      planningReality: { status: "debug" },
      mesocycleStrategyDiagnostic: { source: "v2_mesocycle_strategy" },
      debugArtifact: { path: "sidecar.json" },
      noRepair: true,
      repairedProjection: { slotPlans: [] },
      sessionDecisionReceipt: { version: 1 },
      weekPolicies: acceptedPlannerIntent.weekPolicies.map((week, weekIndex) =>
        weekIndex === 0
          ? {
              ...week,
              slots: week.slots.map((slot, slotIndex) =>
                slotIndex === 0
                  ? {
                      ...slot,
                      lanes: slot.lanes.map((lane, laneIndex) =>
                        laneIndex === 0
                          ? {
                              ...lane,
                              evidence: ["debug-only"],
                              selectedExercise: { exerciseId: "not-seed-truth" },
                            }
                          : lane
                      ),
                    }
                  : slot
              ),
            }
          : week
      ),
    };

    const seed = buildMesocycleSlotPlanSeed({
      slotSequence: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [
            {
              exerciseId: "bench",
              name: "Bench Press",
              role: "CORE_COMPOUND",
              setCount: 5,
            },
          ],
        },
      ],
      acceptedPlannerIntent: rawPlannerObject as typeof acceptedPlannerIntent,
    });
    const serialized = JSON.stringify(seed.acceptedPlannerIntent);

    expect(seed.acceptedPlannerIntent).toEqual(acceptedPlannerIntent);
    expect(serialized).not.toMatch(
      /planningReality|mesocycleStrategyDiagnostic|debugArtifact|noRepair|repairedProjection|sessionDecisionReceipt|selectedExercise|not-seed-truth|debug-only/
    );
  });

  it("does not serialize planner-only override data into slotPlanSeedJson", () => {
    const seed = buildMesocycleSlotPlanSeed({
      slotSequence: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          plannerOnlyPolicyOverride: {
            id: "calves_4_4_lower_slot_allocation",
          },
          exercises: [
            {
              exerciseId: "bench",
              name: "Bench Press",
              role: "CORE_COMPOUND",
              setCount: 5,
              plannerOnlyPolicyOverride: {
                id: "calves_4_4_lower_slot_allocation",
              },
            },
          ],
        },
      ] as never,
    });

    expect(JSON.stringify(seed)).not.toContain("plannerOnlyPolicyOverride");
    expect(JSON.stringify(seed)).not.toContain("calves_4_4_lower_slot_allocation");
  });

  it("does not serialize planner-only no-repair audit markers into slotPlanSeedJson", () => {
    const seed = buildMesocycleSlotPlanSeed({
      slotSequence: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          experimentalPlannerOnlyNoRepair: true,
          exercises: [
            {
              exerciseId: "bench",
              name: "Bench Press",
              role: "CORE_COMPOUND",
              setCount: 5,
              experimentalPlannerOnlyNoRepair: true,
            },
          ],
        },
      ] as never,
    });

    expect(JSON.stringify(seed)).not.toContain("experimentalPlannerOnlyNoRepair");
    expect(seed.slots[0]?.exercises[0]).toEqual({
      exerciseId: "bench",
      role: "CORE_COMPOUND",
      setCount: 5,
    });
  });

  it("keeps seeded runtime replay deterministic for planner-only no-repair-shaped input", () => {
    const seed = buildMesocycleSlotPlanSeed({
      slotSequence: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [
            {
              exerciseId: "bench",
              name: "Bench Press",
              role: "CORE_COMPOUND",
              setCount: 5,
            },
          ],
        },
      ],
    });

    const first = resolveRequiredSeededSlotPlan({
      mapped: makeMapped(seed),
      sessionIntent: "upper",
      slotId: "upper_a",
    });
    const second = resolveRequiredSeededSlotPlan({
      mapped: makeMapped(seed),
      sessionIntent: "upper",
      slotId: "upper_a",
    });

    expect(first).toEqual(second);
  });

  it("ignores acceptedPlannerIntent during seeded runtime replay", () => {
    const seed = {
      version: 1,
      source: "handoff_slot_plan_projection",
      acceptedPlannerIntent: buildV2AcceptedPlannerIntentDto(),
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 5 }],
        },
      ],
    };

    const resolvedWithMetadata = resolveRequiredSeededSlotPlan({
      mapped: makeMapped(seed),
      sessionIntent: "upper",
      slotId: "upper_a",
    });
    const resolvedWithoutMetadata = resolveRequiredSeededSlotPlan({
      mapped: makeMapped({ ...seed, acceptedPlannerIntent: undefined }),
      sessionIntent: "upper",
      slotId: "upper_a",
    });

    expect(resolvedWithMetadata).toEqual(resolvedWithoutMetadata);
    expect(resolvedWithMetadata).toMatchObject({
      slotId: "upper_a",
      setCountOverrides: { bench: 5 },
      usesLegacySetCountFallback: false,
    });
  });

  it("returns explicit set-count overrides for set-aware seeds", () => {
    const resolved = resolveRequiredSeededSlotPlan({
      mapped: makeMapped({
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 5 }],
          },
        ],
      }),
      sessionIntent: "upper",
      slotId: "upper_a",
    });

    expect(resolved).toMatchObject({
      slotId: "upper_a",
      setCountOverrides: { bench: 5 },
      usesLegacySetCountFallback: false,
    });
  });

  it("preserves Lower B set-aware seed order before runtime section grouping", () => {
    const seed = {
      version: 1,
      source: "handoff_slot_plan_projection",
      slots: [
        {
          slotId: "lower_b",
          exercises: [
            { exerciseId: "sldl", role: "CORE_COMPOUND", setCount: 3 },
            { exerciseId: "leg-curl", role: "ACCESSORY", setCount: 3 },
            { exerciseId: "split-squat", role: "CORE_COMPOUND", setCount: 3 },
            { exerciseId: "calf-raise", role: "ACCESSORY", setCount: 3 },
          ],
        },
      ],
    };
    const mapped = {
      activeMesocycle: {
        slotPlanSeedJson: seed,
        slotSequenceJson: {
          version: 1,
          source: "handoff_draft",
          sequenceMode: "ordered_flexible",
          slots: [{ slotId: "lower_b", intent: "LOWER" }],
        },
      },
      mappedConstraints: {
        weeklySchedule: ["lower"],
      },
      exerciseLibrary: [
        { id: "sldl", name: "Stiff-Legged Deadlift" },
        { id: "leg-curl", name: "Seated Leg Curl" },
        { id: "split-squat", name: "Bulgarian Split Squat" },
        { id: "calf-raise", name: "Seated Calf Raise" },
      ],
      history: [],
    } as unknown as MappedGenerationContext;

    const resolved = resolveRequiredSeededSlotPlan({
      mapped,
      sessionIntent: "lower",
      slotId: "lower_b",
    });

    expect(resolved && !("error" in resolved)
      ? resolved.exercises.map(({ exerciseId, role, setCount }) => ({
          exerciseId,
          role,
          setCount,
        }))
      : resolved).toEqual([
      { exerciseId: "sldl", role: "CORE_COMPOUND", setCount: 3 },
      { exerciseId: "leg-curl", role: "ACCESSORY", setCount: 3 },
      { exerciseId: "split-squat", role: "CORE_COMPOUND", setCount: 3 },
      { exerciseId: "calf-raise", role: "ACCESSORY", setCount: 3 },
    ]);
    expect(resolved && !("error" in resolved)
      ? resolved.templateExercises.map(({ exercise, orderIndex, mesocycleRole }) => ({
          exerciseId: exercise.id,
          orderIndex,
          mesocycleRole,
        }))
      : resolved).toEqual([
      { exerciseId: "sldl", orderIndex: 0, mesocycleRole: "CORE_COMPOUND" },
      { exerciseId: "leg-curl", orderIndex: 1, mesocycleRole: "ACCESSORY" },
      { exerciseId: "split-squat", orderIndex: 2, mesocycleRole: "CORE_COMPOUND" },
      { exerciseId: "calf-raise", orderIndex: 3, mesocycleRole: "ACCESSORY" },
    ]);
  });

  it("marks missing setCount as legacy fallback and logs the compatibility path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const resolved = resolveRequiredSeededSlotPlan({
        mapped: makeMapped({
          version: 1,
          source: "handoff_slot_plan_projection",
          slots: [
            {
              slotId: "upper_a",
              exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
            },
          ],
        }),
        sessionIntent: "upper",
        slotId: "upper_a",
      });

      expect(resolved).toMatchObject({
        slotId: "upper_a",
        usesLegacySetCountFallback: true,
      });
      expect(resolved && !("error" in resolved) ? resolved.setCountOverrides : "error").toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("missing setCount for seeded runtime replay")
      );
    } finally {
      warn.mockRestore();
    }
  });
});
