import { describe, expect, it } from "vitest";
import { normalizeAcceptedHypertrophySeedV4 } from "@/lib/api/mesocycle-seed-revision";
import { V4_REFERENCE_CANONICAL_HASH } from "@/lib/api/template-session-v4-reference.expected";
import {
  compileAcceptedHypertrophySeedV4,
  copyAcceptedHypertrophySeedV4ToDraft,
  resolveAcceptedHypertrophySeedV4Week,
  type HypertrophyPlanWeekV4,
  type RirTargetV4,
  type WeeklyPrescriptionV4,
} from "./hypertrophy-plan-authoring";
import { buildV4CustomPlanReferenceAcceptedSeed } from "./hypertrophy-plan-authoring-v4.fixture";
import {
  materializeBulkHypertrophyPrescriptionPattern,
  materializeHypertrophyPrescriptionPattern,
  recognizeHypertrophyPrescriptionPattern,
  STANDARD_ACCUMULATION_RIR,
  type DeloadPrescriptionPattern,
  type HypertrophyPrescriptionPattern,
} from "./hypertrophy-prescription-patterns";

const weeks: HypertrophyPlanWeekV4[] = [
  { week: 1, phase: "ACCUMULATION" },
  { week: 2, phase: "ACCUMULATION" },
  { week: 3, phase: "ACCUMULATION" },
  { week: 4, phase: "ACCUMULATION" },
  { week: 5, phase: "DELOAD" },
];

function pattern(
  overrides: Partial<HypertrophyPrescriptionPattern> = {},
): HypertrophyPrescriptionPattern {
  return {
    base: { setCount: 3, reps: { kind: "RANGE", min: 5, max: 8 } },
    effort: { kind: "STANDARD" },
    deload: { kind: "REDUCED_SETS", setCount: 2 },
    ...overrides,
  };
}

function materialize(
  overrides: Partial<HypertrophyPrescriptionPattern> = {},
): WeeklyPrescriptionV4[] {
  return materializeHypertrophyPrescriptionPattern({
    weeks,
    pattern: pattern(overrides),
  });
}

describe("hypertrophy prescription patterns", () => {
  it("materializes the authoritative standard accumulation curve in exact row order", () => {
    expect(materialize()).toEqual([
      ...STANDARD_ACCUMULATION_RIR.map((rir, index) => ({
        week: index + 1,
        status: "PRESCRIBE",
        setCount: 3,
        reps: { kind: "RANGE", min: 5, max: 8 },
        rir,
      })),
      {
        week: 5,
        status: "PRESCRIBE",
        setCount: 2,
        reps: { kind: "RANGE", min: 5, max: 8 },
        rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
      },
    ]);
  });

  it("supports stable and custom effort, exact reps, exact RIR, and valid half steps", () => {
    const exactRir = { kind: "TARGET_RANGE", min: 2.5, max: 2.5 } as const;
    const stable = materialize({
      base: { setCount: 4, reps: { kind: "EXACT", reps: 7 } },
      effort: { kind: "STABLE", rir: exactRir },
      deload: { kind: "MAINTAIN" },
    });
    expect(stable.slice(0, 4)).toEqual(
      [1, 2, 3, 4].map((week) => ({
        week,
        status: "PRESCRIBE",
        setCount: 4,
        reps: { kind: "EXACT", reps: 7 },
        rir: exactRir,
      })),
    );
    expect(stable[4]).toMatchObject({ setCount: 4, reps: { kind: "EXACT", reps: 7 } });

    const customRir: RirTargetV4[] = [
      { kind: "TARGET_RANGE", min: 4.5, max: 5 },
      { kind: "TARGET_RANGE", min: 3.5, max: 4 },
      { kind: "TARGET_RANGE", min: 2.5, max: 3 },
      { kind: "NOT_APPLICABLE" },
    ];
    expect(materialize({ effort: { kind: "CUSTOM", rirByWeek: customRir } }).slice(0, 4).map((row) =>
      row.status === "PRESCRIBE" ? row.rir : null,
    )).toEqual(customRir);
  });

  it("materializes reduced, maintained, omitted, and exact custom deload behavior", () => {
    expect(materialize()[4]).toMatchObject({ status: "PRESCRIBE", setCount: 2 });
    expect(materialize({ deload: { kind: "MAINTAIN" } })[4]).toMatchObject({
      status: "PRESCRIBE",
      setCount: 3,
    });
    expect(materialize({ deload: { kind: "OMIT" } })[4]).toEqual({
      week: 5,
      status: "OMIT",
    });
    const custom = {
      week: 5,
      status: "PRESCRIBE" as const,
      setCount: 1,
      reps: { kind: "EXACT" as const, reps: 12 },
      rir: { kind: "TARGET_RANGE" as const, min: 5.5, max: 6 },
    };
    expect(materialize({ deload: { kind: "CUSTOM", prescription: custom } })[4]).toEqual(custom);
  });

  it("recognizes standard, stable, reduced, maintained, and omitted rows from exact data", () => {
    expect(recognizeHypertrophyPrescriptionPattern({ weeks, prescriptions: materialize() })).toMatchObject({
      classification: "REDUCED_DELOAD",
      classificationLabel: "Reduced deload",
      accumulation: { kind: "STANDARD" },
      deload: { kind: "REDUCED_SETS", setCount: 2 },
      summary: "3 × 5–8 · RIR 3–4 → 1–2 · 2-set deload",
      isCustom: false,
    });
    expect(
      recognizeHypertrophyPrescriptionPattern({
        weeks,
        prescriptions: materialize({
          effort: { kind: "STABLE", rir: { kind: "TARGET_RANGE", min: 3, max: 3 } },
          deload: { kind: "MAINTAIN" },
        }),
      }),
    ).toMatchObject({
      classification: "STABLE_WEEKLY_PRESCRIPTION",
      accumulation: { kind: "STABLE" },
      deload: { kind: "MAINTAIN" },
    });
    expect(
      recognizeHypertrophyPrescriptionPattern({
        weeks,
        prescriptions: materialize({ deload: { kind: "OMIT" } }),
      }),
    ).toMatchObject({
      classification: "OMITTED_DELOAD",
      deload: { kind: "OMIT" },
      deloadSummary: "Omitted in Week 5",
    });
  });

  it("labels a single differing week and otherwise preserves custom rows", () => {
    const oneException = materialize();
    const weekThree = oneException[2]!;
    if (weekThree.status !== "PRESCRIBE") throw new Error("fixture");
    oneException[2] = { ...weekThree, setCount: 4 };
    expect(
      recognizeHypertrophyPrescriptionPattern({ weeks, prescriptions: oneException }),
    ).toMatchObject({
      classification: "WEEK_EXCEPTION",
      classificationLabel: "Week 3 exception",
      exceptionWeeks: [3],
      summary: "Custom · Week 3 differs",
      isCustom: true,
    });

    const custom = structuredClone(oneException);
    const weekTwo = custom[1]!;
    if (weekTwo.status !== "PRESCRIBE") throw new Error("fixture");
    custom[1] = { ...weekTwo, reps: { kind: "EXACT", reps: 6 } };
    const snapshot = structuredClone(custom);
    expect(
      recognizeHypertrophyPrescriptionPattern({ weeks, prescriptions: custom }),
    ).toMatchObject({
      classification: "CUSTOM_WEEKLY_PATTERN",
      exceptionWeeks: [2, 3],
      summary: "Custom · Weeks 2, 3 differ",
      isCustom: true,
    });
    expect(custom).toEqual(snapshot);
  });

  it("is deterministic and never mutates pattern inputs", () => {
    const source = pattern({
      base: { setCount: 2, reps: { kind: "EXACT", reps: 10 } },
      deload: { kind: "OMIT" },
    });
    const snapshot = structuredClone(source);
    const first = materializeHypertrophyPrescriptionPattern({ weeks, pattern: source });
    const second = materializeHypertrophyPrescriptionPattern({
      weeks: structuredClone(weeks),
      pattern: structuredClone(source),
    });
    expect(first).toEqual(second);
    expect(source).toEqual(snapshot);
  });

  it.each([
    ["set count", () => materialize({ base: { setCount: 0, reps: { kind: "EXACT", reps: 8 } } })],
    ["rep range", () => materialize({ base: { setCount: 3, reps: { kind: "RANGE", min: 12, max: 8 } } })],
    ["RIR", () => materialize({ effort: { kind: "STABLE", rir: { kind: "TARGET_RANGE", min: 2.25, max: 3 } } })],
    ["deload reduction", () => materialize({ deload: { kind: "REDUCED_SETS", setCount: 3 } })],
    ["topology", () => materializeHypertrophyPrescriptionPattern({ weeks: weeks.slice(0, 4), pattern: pattern() })],
  ])("fails explicitly for invalid %s", (_label, operation) => {
    expect(operation).toThrow(/PRESCRIPTION_PATTERN_/);
  });

  it("bulk materialization preserves each row's own base sets and reps", () => {
    const first = materialize();
    const second = materialize({
      base: { setCount: 2, reps: { kind: "EXACT", reps: 10 } },
      deload: { kind: "OMIT" },
    });
    const transform = (prescriptions: WeeklyPrescriptionV4[]) =>
      materializeBulkHypertrophyPrescriptionPattern({
        weeks,
        prescriptions,
        effort: { kind: "STABLE", rir: { kind: "TARGET_RANGE", min: 2.5, max: 3 } },
        deload: { kind: "MAINTAIN" },
      });
    const [afterFirst, afterSecond] = [transform(first), transform(second)];
    expect(afterFirst.slice(0, 4).map((row) => row.status === "PRESCRIBE" && [row.setCount, row.reps])).toEqual(
      Array(4).fill([3, { kind: "RANGE", min: 5, max: 8 }]),
    );
    expect(afterSecond.slice(0, 4).map((row) => row.status === "PRESCRIBE" && [row.setCount, row.reps])).toEqual(
      Array(4).fill([2, { kind: "EXACT", reps: 10 }]),
    );
  });

  it("reproduces the 25-placement reference draft, accepted V4 payload, hash, and runtime weeks exactly", () => {
    const accepted = buildV4CustomPlanReferenceAcceptedSeed();
    const draft = copyAcceptedHypertrophySeedV4ToDraft(accepted);
    const before = structuredClone(draft);
    const transformed = {
      ...draft,
      sessions: draft.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map((exercise) => {
          const recognized = recognizeHypertrophyPrescriptionPattern({
            weeks: draft.weeks,
            prescriptions: exercise.prescriptions,
          });
          if (recognized.accumulation.kind === "CUSTOM" || recognized.deload.kind === "CUSTOM") {
            throw new Error("REFERENCE_PATTERN_NOT_RECOGNIZED");
          }
          const deload: DeloadPrescriptionPattern = recognized.deload;
          return {
            ...exercise,
            prescriptions: materializeHypertrophyPrescriptionPattern({
              weeks: draft.weeks,
              pattern: {
                base: recognized.base,
                effort: recognized.accumulation,
                deload,
              },
            }),
          };
        }),
      })),
    };
    expect(transformed).toEqual(before);
    expect(transformed.sessions.map((session) => session.exercises.length)).toEqual([7, 6, 7, 5]);
    expect(
      transformed.sessions.map((session) =>
        session.exercises.filter((exercise) => exercise.prescriptions[4]!.status !== "OMIT").length,
      ),
    ).toEqual([7, 4, 7, 4]);

    const recompiled = compileAcceptedHypertrophySeedV4({
      draft: transformed,
      measurementByExerciseId: new Map(),
    });
    expect(recompiled).toEqual(accepted);
    expect(normalizeAcceptedHypertrophySeedV4(recompiled).hash).toBe(V4_REFERENCE_CANONICAL_HASH);
    for (const week of weeks) {
      expect(resolveAcceptedHypertrophySeedV4Week(recompiled, week.week)).toEqual(
        resolveAcceptedHypertrophySeedV4Week(accepted, week.week),
      );
    }
  });
});
