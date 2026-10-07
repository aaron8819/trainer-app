import { z } from "zod";

export const id = z.uuid().refine(v => v === v.toLowerCase(), "UUIDs must use lowercase spelling");
const label = z.string().max(200);
// Decimal spelling is authored meaning: never coerce, quantize, or normalize it.
export const decimal = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/);
export const measurement = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("externalLoad"), value: decimal,
    unit: z.enum(["kg", "lb"]), convention: z.enum(["barbellTotal", "perImplement", "machineDisplayed", "machinePlatesPerArm", "smithPlatesTotal"]),
    zeroMeaning: z.enum(["validZero", "notAllowed"]) }).strict(),
  z.object({ kind: z.literal("addedLoad"), value: decimal, unit: z.enum(["kg", "lb"]),
    convention: z.literal("addedExternal"), zeroMeaning: z.literal("noAddedLoad") }).strict(),
  z.object({ kind: z.literal("assistance"), value: decimal, unit: z.enum(["kg", "lb"]),
    convention: z.literal("displayedAssistance"), zeroMeaning: z.literal("noAssistance") }).strict(),
  z.object({ kind: z.literal("bodyweight"), convention: z.literal("bodyweightOnly") }).strict(),
]).superRefine((v, ctx) => {
  if (v.kind === "externalLoad" && v.zeroMeaning === "notAllowed" && /^0(?:\.0+)?$/.test(v.value))
    ctx.addIssue({ code: "custom", message: "Zero requires explicit valid-zero meaning" });
});
export const target = z.object({
  id, classification: z.enum(["preparation", "rampUp", "working", "optionalFinisher"]), required: z.boolean(),
  reps: z.object({ min: z.int().min(1).max(1000), max: z.int().min(1).max(1000),
    basis: z.enum(["total", "perSide", "alternating"]) }).strict().refine(v => v.min <= v.max),
  measurement: measurement.nullable(), rir: decimal.refine(v => Number(v) <= 10, "RIR must be at most 10").nullable(), restSeconds: decimal.nullable(),
}).strict();
export const exercise = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('authoredDescription'), name: label, variation: label }).strict(),
  z.object({ kind: z.literal('catalogSnapshot'), catalogId: label, catalogVersion: z.literal(1), name: label, variation: label,
    equipment: z.array(label).min(1), purpose: label, repBasis: target.shape.reps.shape.basis,
    loadKind: z.enum(['externalLoad', 'bodyweight', 'addedLoad', 'assistance']),
    convention: z.enum(['barbellTotal', 'perImplement', 'machineDisplayed', 'machinePlatesPerArm', 'smithPlatesTotal', 'bodyweightOnly', 'addedExternal', 'displayedAssistance']),
    // Absent in the frozen released v1 definitions; never backfilled on read.
    catalogFacts: z.object({ movementPatterns: z.array(label).min(1), primaryMuscles: z.array(label),
      secondaryMuscles: z.array(label), externalZeroMeaning: z.enum(['validZero', 'notAllowed']).nullable(),
      repDefaults: z.object({ min: z.int().min(1).max(1000), max: z.int().min(1).max(1000) }).strict().refine(v => v.min <= v.max),
    }).strict().optional(),
  }).strict(),
]);
export const role = z.enum(['Main lift', 'Secondary lift', 'Accessory', 'Calves', 'Core']);
export const overrideField = z.enum(['exercise', 'role', 'sets', 'reps', 'measurement', 'rir', 'restSeconds', 'classification', 'required']);
export const weekEdits = z.object({ removed: z.array(id), order: z.boolean(),
  fields: z.record(id, z.array(overrideField).min(1)),
  values: z.record(id, target.omit({ id: true }).partial()).optional(),
  targets: z.record(id, z.array(z.enum(['reps', 'measurement', 'rir', 'restSeconds', 'classification', 'required'])).min(1)).optional(),
}).strict();
export const position = z.object({ id, sourceKey: id.optional(), role: role.optional(), exercise, targets: z.array(target).max(100) }).strict();
export const occurrence = z.object({ id, stageId: id, name: label, workoutKey: id.optional(), weekOverride: z.boolean().optional(),
  overrides: weekEdits.optional(),
  positions: z.array(position).max(100) }).strict();
export const stage = z.object({ id, name: label }).strict();
// Plan-wide authored policy. Performance groups/algorithms are a later contract.
// Absence means unknown, including in historical saved documents.
export const progressionIntent = z.object({
  version: z.literal(1), mode: z.literal('plannedPrescriptions'),
  scope: z.literal('wholePlan'), parameters: z.object({}).strict(),
}).strict();
export const builder = z.object({ version: z.literal(1), template: z.literal("hypertrophy"),
  starterVersion: z.literal(1).optional(), equipment: z.array(label).optional(),
  weeks: z.array(z.object({ stageId: id, deload: z.boolean(), rir: target.shape.rir }).strict()).length(5)
    .refine(weeks => weeks.every((week, i) => week.deload === (i === 4)), "The supported schedule ends with one deload week"),
  workouts: z.array(z.object({ key: id, name: label, rows: z.array(z.object({
    key: id, exercise: position.shape.exercise, role: role.optional(), sets: z.int().min(1).max(20), prescription: target.omit({ id: true }),
  }).strict()).max(20) }).strict()).length(4),
}).strict();
// Read compatibility only. New commands must use draftDocument below.
export const savedDraftDocument = z.object({ schemaVersion: z.literal(1), name: label,
  progression: progressionIntent.optional(),
  builder: builder.optional(),
  endpoint: z.literal("endOfOrderedOccurrences"), stages: z.array(stage).max(100),
  occurrences: z.array(occurrence).max(500),
}).strict().superRefine((doc, ctx) => {
  const all = [...doc.stages.map(s => s.id)];
  const stages = new Set(all);
  for (const o of doc.occurrences) {
    if (!stages.has(o.stageId)) ctx.addIssue({ code: "custom", message: "Unknown stage reference" });
    all.push(o.id);
    for (const p of o.positions) {
      all.push(p.id); all.push(...p.targets.map(t => t.id));
      if (p.exercise.kind === 'catalogSnapshot') {
        const e = p.exercise;
        if (p.targets.some(t => t.reps.basis !== e.repBasis || (t.measurement && (t.measurement.kind !== e.loadKind || t.measurement.convention !== e.convention ||
          (t.measurement.kind === 'externalLoad' && e.catalogFacts && t.measurement.zeroMeaning !== e.catalogFacts.externalZeroMeaning)))))
          ctx.addIssue({ code: 'custom', message: 'Prescription must retain catalog measurement meaning' });
      }
    }
    if (o.overrides && (o.weekOverride || Object.keys(o.overrides.fields).some(key => !o.positions.some(p => p.id === key)) || Object.keys(o.overrides.targets ?? {}).some(key => !o.positions.some(p => p.targets.some(t => t.id === key))) || new Set(o.overrides.removed).size !== o.overrides.removed.length))
      ctx.addIssue({ code: 'custom', message: 'Invalid explicit week edits' });
  }
  if (new Set(all).size !== all.length) ctx.addIssue({ code: "custom", message: "Duplicate identity" });
  if (doc.builder) {
    const b = doc.builder;
    const keys = b.workouts.flatMap(w => [w.key, ...w.rows.map(r => r.key)]);
    if (new Set(keys).size !== keys.length || b.weeks.some((w, i) => w.stageId !== doc.stages[i]?.id) || doc.stages.length !== 5 || doc.occurrences.length !== 20)
      ctx.addIssue({ code: "custom", message: "Invalid builder structure" });
    b.weeks.forEach((w, weekIndex) => b.workouts.forEach((workout, workoutIndex) => {
      const ordered = doc.occurrences[weekIndex * 4 + workoutIndex];
      if (ordered?.stageId !== w.stageId || ordered?.workoutKey !== workout.key)
        ctx.addIssue({ code: "custom", message: "Workout order must match the authored schedule" });
      const matches = doc.occurrences.filter(o => o.stageId === w.stageId && o.workoutKey === workout.key);
      if (matches.length !== 1) ctx.addIssue({ code: "custom", message: "Missing or duplicate recurring workout" });
      for (const o of matches) {
        const sources = o.positions.flatMap(p => p.sourceKey ? [p.sourceKey] : []);
        if (new Set(sources).size !== sources.length) ctx.addIssue({ code: "custom", message: "Duplicate exercise counterpart" });
        if (!o.weekOverride && (sources.some(key => !workout.rows.some(r => r.key === key)) || o.overrides?.removed.some(key => !workout.rows.some(r => r.key === key) || sources.includes(key))))
          ctx.addIssue({ code: 'custom', message: 'Invalid removed or inherited slot' });
      }
    }));
  } else if (doc.occurrences.some(o => o.workoutKey || o.weekOverride !== undefined || o.overrides || o.positions.some(p => p.sourceKey))) {
    ctx.addIssue({ code: "custom", message: "Counterparts require builder context" });
  }
});
export const draftDocument = savedDraftDocument.superRefine((doc, ctx) => {
  for (const o of doc.occurrences) {
    const edits = o.overrides;
    if (!edits) continue;
    for (const [key, values] of Object.entries(edits.values ?? {})) {
      const p = o.positions.find(p => p.id === key);
      const mask = edits.fields[key] ?? [];
      if (!p || Object.keys(values).some(field => !mask.includes(field as z.infer<typeof overrideField>)))
        ctx.addIssue({ code: 'custom', message: 'Override values require a position in this workout and corresponding field masks' });
      if (p?.exercise.kind === 'catalogSnapshot') {
        const e = p.exercise;
        if ((values.reps && values.reps.basis !== e.repBasis) || (values.measurement && (values.measurement.kind !== e.loadKind || values.measurement.convention !== e.convention)))
          ctx.addIssue({ code: 'custom', message: 'Override values must retain catalog measurement meaning' });
      }
    }
    for (const p of o.positions) if (!p.sourceKey && (edits.fields[p.id] || edits.values?.[p.id] || p.targets.some(t => edits.targets?.[t.id])))
      ctx.addIssue({ code: 'custom', message: 'Independent additions have no shared inheritance overrides' });
  }
});
export type DraftDocument = z.infer<typeof draftDocument>;
export const editOperation = z.discriminatedUnion("op", [
  z.object({ op: z.literal('setProgressionIntent'), progression: progressionIntent.nullable() }).strict(),
  z.object({ op: z.literal('setWeekEdits'), occurrenceId: id, overrides: weekEdits.optional() }).strict(),
  z.object({ op: z.literal('editPositionRole'), positionId: id, role: role.optional() }).strict(),
  z.object({ op: z.literal("editWorkoutDefaults"), builder }).strict(),
  z.object({ op: z.literal("setWeekOverride"), occurrenceId: id, weekOverride: z.boolean() }).strict(),
  z.object({ op: z.literal("editPositionTargets"), positionId: id, targets: z.array(target).max(100) }).strict(),
  z.object({ op: z.literal("renamePlan"), name: label }).strict(),
  z.object({ op: z.literal("addStage"), stage }).strict(),
  z.object({ op: z.literal("renameStage"), stageId: id, name: label }).strict(),
  z.object({ op: z.literal("removeStage"), stageId: id }).strict(),
  z.object({ op: z.literal("reorderStages"), stageIds: z.array(id).max(100) }).strict(),
  z.object({ op: z.literal("addOccurrence"), occurrence }).strict(),
  z.object({ op: z.literal("editOccurrence"), occurrenceId: id, stageId: id, name: label }).strict(),
  z.object({ op: z.literal("removeOccurrence"), occurrenceId: id }).strict(),
  z.object({ op: z.literal("reorderOccurrences"), occurrenceIds: z.array(id).max(500) }).strict(),
  z.object({ op: z.literal("addPosition"), occurrenceId: id, position }).strict(),
  z.object({ op: z.literal("editExercise"), positionId: id, exercise: position.shape.exercise }).strict(),
  z.object({ op: z.literal("removePosition"), positionId: id }).strict(),
  z.object({ op: z.literal("reorderPositions"), occurrenceId: id, positionIds: z.array(id).max(100) }).strict(),
  z.object({ op: z.literal("addTarget"), positionId: id, target }).strict(),
  z.object({ op: z.literal("editTarget"), target }).strict(),
  z.object({ op: z.literal("removeTarget"), targetId: id }).strict(),
  z.object({ op: z.literal("reorderTargets"), positionId: id, targetIds: z.array(id).max(100) }).strict(),
]);
const envelope = {
  schemaVersion: z.literal(1), actionId: id, originatingAccountId: z.string().min(1).max(100),
  deviceId: id, ownershipEpoch: z.int().min(0), dependsOn: z.array(id).max(100),
};
export const createDraftCommand = z.object({ ...envelope, commandType: z.literal("CreateDraft"),
  target: z.object({ planId: id }).strict(), expected: z.object({}).strict(),
  intent: draftDocument,
}).strict();
export const editDraftCommand = z.object({ ...envelope, commandType: z.literal("EditDraft"),
  target: z.object({ planId: id }).strict(), expected: z.object({ planRevisionId: id }).strict(),
  intent: z.object({ operations: z.array(editOperation).min(1).max(1000) }).strict(),
}).strict();
export type CreateDraftCommand = z.infer<typeof createDraftCommand>;
export type EditDraftCommand = z.infer<typeof editDraftCommand>;
export type DraftCommand = CreateDraftCommand | EditDraftCommand;
export type DraftError = "PLAN_NOT_DRAFT" | "STALE_REVISION" | "NOT_FOUND" | "TOMBSTONED" | "IDENTITY_REUSED" |
  "INVALID_OPERATION" | "INVALID_DOCUMENT" | "DEPENDENCIES_UNSUPPORTED" | "OWNERSHIP_EPOCH";
export type DraftOutcome = {
  status: "Accepted"; actionId: string; commandType: string;
  acceptedSequence: string; result: { planId: string; revisionId: string; revisionNumber: number; contentHash: string };
} | { status: "Rejected" | "Conflict"; actionId: string; commandType: string; code: string };
export type CommandResponse = { outcome: DraftOutcome; replayed: boolean; outcomeCursor: string };
