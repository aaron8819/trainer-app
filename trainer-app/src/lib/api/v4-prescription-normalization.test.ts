import { describe, expect, it } from "vitest";
import {
  compileAcceptedHypertrophySeed,
  compileAcceptedHypertrophySeedV3,
  compileAcceptedHypertrophySeedV4,
  copyAcceptedHypertrophySeedV4ToDraft,
  projectExecutableSeedV4,
  type HypertrophyPlanDraftV1,
  type HypertrophyPlanDraftV2,
} from "@/lib/engine/hypertrophy-plan-authoring";
import {
  normalizeAcceptedHypertrophySeedV4,
  normalizeAcceptedSeedPayload,
} from "./mesocycle-seed-revision";
import {
  AcceptedSeedParseError,
  parseAcceptedSeedPayload,
  parseSlotPlanSeedJson,
} from "./slot-plan-seed-parser";
import { buildFourDayV4ExpressivenessFixture } from "@/lib/engine/hypertrophy-plan-authoring-v4.fixture";

const measurement = {
  profile: "REPS_EXTERNAL_LOAD" as const,
  loadConvention: "BARBELL_TOTAL" as const,
  repBasis: "TOTAL" as const,
};

const measurements = new Map([
  ["bench", measurement],
  ["row", measurement],
]);

function legacyDraft(): HypertrophyPlanDraftV1 {
  return {
    version: 1,
    settings: {
      equipmentProfile: "FULL_GYM",
      sessionDurationMinutes: 60,
    },
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER",
        exercises: [
          {
            exerciseId: "bench",
            workingSets: 4,
            intent: {
              userRole: "PRIMARY_LIFT",
              target: {
                kind: "movement_pattern",
                movementPattern: "horizontal_push",
              },
            },
          },
        ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER",
        exercises: [
          {
            exerciseId: "row",
            workingSets: 3,
            intent: {
              userRole: "SECONDARY_LIFT",
              target: {
                kind: "movement_pattern",
                movementPattern: "horizontal_pull",
              },
            },
          },
        ],
      },
    ],
  };
}

function v4Draft(): HypertrophyPlanDraftV2 {
  return {
    version: 2,
    settings: legacyDraft().settings,
    weeks: [
      { week: 1, phase: "ACCUMULATION" },
      { week: 2, phase: "ACCUMULATION" },
      { week: 3, phase: "DELOAD" },
    ],
    sessions: legacyDraft().sessions.map((session, sessionIndex) => ({
      slotId: session.slotId,
      name: session.name,
      focus: session.focus,
      exercises: session.exercises.map((exercise) => ({
        placementId: `${session.slotId}-${exercise.exerciseId}`,
        exerciseId: exercise.exerciseId,
        intent: exercise.intent,
        prescriptions: [
          {
            week: 1,
            status: "PRESCRIBE" as const,
            setCount: exercise.workingSets,
            reps:
              sessionIndex === 0
                ? { kind: "RANGE" as const, min: 6, max: 8 }
                : { kind: "EXACT" as const, reps: 10 },
            rir:
              sessionIndex === 0
                ? { kind: "TARGET_RANGE" as const, min: 3, max: 4 }
                : { kind: "NOT_APPLICABLE" as const },
          },
          {
            week: 2,
            status: "PRESCRIBE" as const,
            setCount: exercise.workingSets,
            reps:
              sessionIndex === 0
                ? { kind: "RANGE" as const, min: 6, max: 8 }
                : { kind: "EXACT" as const, reps: 10 },
            rir:
              sessionIndex === 0
                ? { kind: "TARGET_RANGE" as const, min: 2, max: 3 }
                : { kind: "NOT_APPLICABLE" as const },
          },
          ...(sessionIndex === 0
            ? [
                {
                  week: 3,
                  status: "PRESCRIBE" as const,
                  setCount: 2,
                  reps: { kind: "EXACT" as const, reps: 6 },
                  rir: { kind: "TARGET_RANGE" as const, min: 4, max: 5 },
                },
              ]
            : [{ week: 3, status: "OMIT" as const }]),
        ],
      })),
    })),
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseObjectKeys(entry)]),
    );
  }
  return value;
}

describe("V4 prescription normalization boundary", () => {
  it("represents the generic four-day weekly fixture without special cases", () => {
    const fixture = buildFourDayV4ExpressivenessFixture();
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: fixture.draft,
      measurementByExerciseId: fixture.measurementByExerciseId,
    });
    const normalized = normalizeAcceptedHypertrophySeedV4(accepted);
    const repeated = normalizeAcceptedHypertrophySeedV4(
      compileAcceptedHypertrophySeedV4({
        draft: structuredClone(fixture.draft),
        measurementByExerciseId: fixture.measurementByExerciseId,
      }),
    );

    expect(accepted.weeks).toEqual([
      { week: 1, phase: "ACCUMULATION" },
      { week: 2, phase: "ACCUMULATION" },
      { week: 3, phase: "ACCUMULATION" },
      { week: 4, phase: "DELOAD" },
    ]);
    expect(accepted.slots.map((slot) => slot.slotId)).toEqual(
      fixture.draft.sessions.map((session) => session.slotId),
    );
    expect(
      accepted.slots.flatMap((slot) =>
        slot.exercises.map((exercise) => exercise.placementId),
      ),
    ).toEqual(
      fixture.draft.sessions.flatMap((session) =>
        session.exercises.map((exercise) => exercise.placementId),
      ),
    );
    expect(
      accepted.slots.flatMap((slot) =>
        slot.exercises.flatMap((exercise) => exercise.prescriptions),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reps: { kind: "EXACT", reps: 7 } }),
        expect.objectContaining({ reps: { kind: "RANGE", min: 10, max: 12 } }),
        expect.objectContaining({ rir: { kind: "NOT_APPLICABLE" } }),
        { week: 4, status: "OMIT" },
      ]),
    );
    expect(accepted.slots.every((slot) => slot.exercises[0]!.measurement)).toBe(
      true,
    );
    expect(normalized.hash).toBe(repeated.hash);
    expect(normalized.executablePayload).toEqual(projectExecutableSeedV4(accepted));
  });

  it("canonicalizes and hashes the full strict accepted V4 contract", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: v4Draft(),
      measurementByExerciseId: measurements,
    });
    const normalized = normalizeAcceptedHypertrophySeedV4(accepted);

    expect(normalized).toMatchObject({
      canonicalPayload: accepted,
      executablePayload: projectExecutableSeedV4(accepted),
      hashAlgorithm: "sha256",
      payloadVersion: 4,
    });
    expect(normalized.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      normalizeAcceptedHypertrophySeedV4(reverseObjectKeys(accepted)).hash,
    ).toBe(normalized.hash);
  });

  it("changes the hash when accepted executable meaning changes", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: v4Draft(),
      measurementByExerciseId: measurements,
    });
    const originalHash = normalizeAcceptedHypertrophySeedV4(accepted).hash;
    const mutations: Array<(candidate: typeof accepted) => void> = [
      (candidate) => {
        const row = candidate.slots[0]!.exercises[0]!.prescriptions[0]!;
        if (row.status === "PRESCRIBE") row.setCount = 3;
      },
      (candidate) => {
        const row = candidate.slots[0]!.exercises[0]!.prescriptions[0]!;
        if (row.status === "PRESCRIBE") row.reps = { kind: "EXACT", reps: 7 };
      },
      (candidate) => {
        const row = candidate.slots[0]!.exercises[0]!.prescriptions[0]!;
        if (row.status === "PRESCRIBE") {
          row.rir = { kind: "TARGET_RANGE", min: 2.5, max: 3.5 };
        }
      },
      (candidate) => {
        candidate.slots[1]!.exercises[0]!.prescriptions[2] = {
          week: 3,
          status: "PRESCRIBE",
          setCount: 1,
          reps: { kind: "EXACT", reps: 8 },
          rir: { kind: "NOT_APPLICABLE" },
        };
      },
      (candidate) => {
        candidate.slots[0]!.exercises[0]!.measurement = {
          profile: "REPS_EXTERNAL_LOAD",
          loadConvention: "MACHINE_DISPLAYED",
          repBasis: "PER_SIDE",
        };
      },
    ];

    for (const mutate of mutations) {
      const changed = structuredClone(accepted);
      mutate(changed);
      expect(normalizeAcceptedHypertrophySeedV4(changed).hash).not.toBe(
        originalHash,
      );
    }
  });

  it("projects all runtime fields and no authoring-only envelope", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: v4Draft(),
      measurementByExerciseId: measurements,
    });
    const projection = projectExecutableSeedV4(accepted);
    expect(normalizeAcceptedHypertrophySeedV4(accepted).executablePayload).toEqual(
      projection,
    );
    expect(JSON.stringify(accepted)).not.toContain("preservedMeasurement");
    expect(JSON.stringify(projection)).not.toMatch(
      /settings|focus|name|preservedMeasurement|progressionPolicy|RirDefaults/,
    );
    expect(JSON.stringify(projection)).toMatch(
      /weeks|phase|placementId|intent|measurement|prescriptions|setCount|reps|rir/,
    );
    expect(projection.slots[0]!.exercises[0]!.intent).toEqual(
      accepted.slots[0]!.exercises[0]!.intent,
    );
  });

  it("preserves canonical identity across copied-draft measurement-map drift", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: v4Draft(),
      measurementByExerciseId: measurements,
    });
    const copied = copyAcceptedHypertrophySeedV4ToDraft(accepted);
    const changedMeasurement = {
      profile: "REPS_EXTERNAL_LOAD" as const,
      loadConvention: "MACHINE_DISPLAYED" as const,
      repBasis: "PER_SIDE" as const,
    };
    const recompiled = compileAcceptedHypertrophySeedV4({
      draft: copied,
      measurementByExerciseId: new Map([
        ["bench", changedMeasurement],
        ["row", changedMeasurement],
      ]),
    });

    expect(recompiled).toEqual(accepted);
    expect(normalizeAcceptedHypertrophySeedV4(recompiled).hash).toBe(
      normalizeAcceptedHypertrophySeedV4(accepted).hash,
    );
  });

  it("leaves live V1, V2, and V3 parsing unchanged and keeps V4 gated", () => {
    const v2 = compileAcceptedHypertrophySeed(legacyDraft());
    const v3 = compileAcceptedHypertrophySeedV3({
      draft: legacyDraft(),
      measurementByExerciseId: measurements,
    });
    const v4 = compileAcceptedHypertrophySeedV4({
      draft: v4Draft(),
      measurementByExerciseId: measurements,
    });

    expect(
      parseAcceptedSeedPayload({
        version: 1,
        slots: [
          {
            slotId: "upper",
            exercises: [
              {
                exerciseId: "bench",
                role: "CORE_COMPOUND",
                setCount: 4,
              },
            ],
          },
        ],
      }).acceptedVersion,
    ).toBeUndefined();
    expect(parseAcceptedSeedPayload(v2).acceptedVersion).toBe(2);
    expect(parseAcceptedSeedPayload(v3).acceptedVersion).toBe(3);
    expect(() => parseAcceptedSeedPayload(v4)).toThrowError(
      expect.objectContaining<Partial<AcceptedSeedParseError>>({
        code: "ACCEPTED_SEED_VERSION_UNSUPPORTED",
        version: 4,
      }),
    );
    expect(() => normalizeAcceptedSeedPayload(v4)).toThrow(
      /ACCEPTED_SEED_VERSION_UNSUPPORTED/,
    );
  });

  it("keeps the actual Executable V3 projection out of both live parsers", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: v4Draft(),
      measurementByExerciseId: measurements,
    });
    const executableV3 = projectExecutableSeedV4(accepted);

    expect(parseSlotPlanSeedJson(executableV3)).toBeNull();
    expect(() => parseAcceptedSeedPayload(executableV3)).toThrowError(
      expect.objectContaining<Partial<AcceptedSeedParseError>>({
        code: "ACCEPTED_SEED_MALFORMED",
        version: 3,
      }),
    );
  });
});
