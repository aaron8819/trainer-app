import { z } from "zod";

export const sourceFamilies = ["MacroCycle", "HypertrophyPlanDraft", "Mesocycle", "MesocycleSeedRevision", "TrainingBlock", "MesocycleWeekClose", "WorkoutTemplate", "WorkoutTemplateExercise", "Workout", "WorkoutExercise", "WorkoutSet", "SetLog", "Exercise", "ExerciseVariation", "ExerciseAlias", "ExerciseEquipment", "Equipment", "PreSessionReadinessSnapshot", "PostSessionReviewSnapshot", "SessionCheckIn", "FinisherOffer", "FinisherOfferItem", "FinisherExecution", "FinisherExecutionStep", "FinisherExecutionCommand", "DeviceDraft"] as const;
export const sourceFamilySchema = z.enum(sourceFamilies);
const id = z.string().min(1).max(1000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceIdentitySchema = z.object({ system: id, account: id, family: sourceFamilySchema, record: id }).strict();
export const rawSourceSchema = z.object({ family: sourceFamilySchema, record: id,
  // Direct PostgreSQL column ::text: scalar and nested values are strings;
  // SQL NULL is null, absent columns stay absent. Never parse numeric text.
  fields: z.record(z.string().min(1), z.string().max(1_000_000).nullable()),
}).strict();
export const sourceScopeSchema = z.object({ system: id, account: id,
  kind: z.enum(["synthetic-postgres", "synthetic-file"]),
  selection: z.literal("all-owner-reachable-rows-v1"),
  families: z.array(sourceFamilySchema).min(1), completeness: z.enum(["complete-within-declared-families", "partial"]),
}).strict().refine(s => new Set(s.families).size === s.families.length, "Duplicate source family");
export const sourceFixtureSchema = z.object({ schemaVersion: z.literal(1), synthetic: z.literal(true),
  scope: sourceScopeSchema, rows: z.array(rawSourceSchema).max(2000),
}).strict();

// An explicit external source assertion, bound to the exact surviving record.
// This is reference provenance, never import acceptance or historical verification.
export const sourceAssertionSchema = z.object({ schemaVersion: z.literal(1), identity: sourceIdentitySchema,
  payloadHash: hash, artifactId: id, artifactText: z.string().min(1).max(100_000),
  claims: z.object({ confirmedPerformance: z.literal(true).optional(), unit: z.enum(["kg", "lb"]).optional(),
    convention: z.enum(["BARBELL_TOTAL", "IMPLEMENT_WEIGHT", "MACHINE_DISPLAYED", "ADDED_EXTERNAL_LOAD", "DISPLAYED_ASSISTANCE"]).optional(),
    repBasis: z.enum(["TOTAL", "PER_SIDE"]).optional(), equipment: id.optional(),
    zeroMeaning: z.enum(["BODYWEIGHT_NO_ADDED_LOAD", "MACHINE_DEFAULT_NO_ADDED_LOAD", "ZERO_ASSISTANCE"]).optional(),
    performedDate: z.iso.date().optional(), performedInstant: z.iso.datetime({ offset: true }).optional(),
    finality: z.enum(["finished", "finished-partial"]).optional(),
  }).strict(),
}).strict();
export type SourceFamily = z.infer<typeof sourceFamilySchema>;
export type SourceIdentity = z.infer<typeof sourceIdentitySchema>;
export type RawSource = z.infer<typeof rawSourceSchema>;
export type SourceScope = z.infer<typeof sourceScopeSchema>;
export type SourceAssertion = z.infer<typeof sourceAssertionSchema>;

export const referenceSchema = z.object({ schemaVersion: z.literal(1), identity: sourceIdentitySchema,
  payloadHash: hash, dependencyHash: hash, revision: hash, raw: rawSourceSchema,
  assertions: z.array(sourceAssertionSchema),
  interpretation: z.object({ kind: z.enum(["prescription-reference", "session-reference", "recorded-log-unconfirmed", "source-asserted-performance", "skipped-log", "unconfirmed-draft", "unsupported-timed-reference", "source-context"]),
    finality: z.enum(["not-applicable", "unresolved", "source-completed", "source-skipped", "source-asserted-finished", "source-asserted-finished-partial"]),
    measurement: z.record(z.enum(["unit", "convention", "repBasis", "equipment", "zeroMeaning"]), z.object({ value: z.string().nullable(), confidence: z.enum(["unknown", "stored-reference", "external-source-assertion", "conflicting"]), basis: z.array(z.string()) }).strict()),
    time: z.object({ performedDate: z.string().nullable(), performedInstant: z.string().nullable(), confidence: z.enum(["unknown", "external-source-assertion", "conflicting"]) }).strict(),
    actualEffort: z.literal("raw-RPE-only-no-RIR-conversion"), startingPrescription: z.literal("not-verified-start"),
    corrections: z.literal("surviving-values-only-no-demonstrated-correction-chain"), quantitativelyQualified: z.literal(false),
  }).strict(), discrepancies: z.array(z.string()),
}).strict();
export type SourceReference = z.infer<typeof referenceSchema>;
export const sourceCaptureSchema = z.object({ schemaVersion: z.literal(1), scope: sourceScopeSchema,
  observation: z.object({ batchId: id, capturedAt: z.iso.datetime({ offset: true }), databaseSnapshot: z.string().nullable() }).strict(),
  sourceHash: hash, references: z.array(referenceSchema).max(2000), limitations: z.array(z.string()),
}).strict();
export type SourceCapture = z.infer<typeof sourceCaptureSchema>;
