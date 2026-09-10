import type { SourceFamily } from "../../trainer2-contracts/legacy-source";

// Fixed repository-schema queries. $1 always names the explicit legacy owner.
const plan = 'JOIN "MacroCycle" m ON m.id=t."macroCycleId"';
const meso = 'JOIN "Mesocycle" m ON m.id=t."mesocycleId" JOIN "MacroCycle" p ON p.id=m."macroCycleId"';
const workout = 'JOIN "Workout" w ON w.id=t."workoutId"';
const position = 'JOIN "WorkoutExercise" e ON e.id=t."workoutExerciseId" JOIN "Workout" w ON w.id=e."workoutId"';
const log = 'JOIN "WorkoutSet" s ON s.id=t."workoutSetId" JOIN "WorkoutExercise" e ON e.id=s."workoutExerciseId" JOIN "Workout" w ON w.id=e."workoutId"';
const template = 'JOIN "WorkoutTemplate" p ON p.id=t."templateId"';
const usedExercise = (column: string) => `(EXISTS (SELECT 1 FROM "WorkoutExercise" e JOIN "Workout" w ON w.id=e."workoutId" WHERE e."exerciseId"=${column} AND w."userId"=$1) OR EXISTS (SELECT 1 FROM "WorkoutTemplateExercise" e JOIN "WorkoutTemplate" w ON w.id=e."templateId" WHERE e."exerciseId"=${column} AND w."userId"=$1))`;
const offer = 'JOIN "FinisherOffer" o ON o.id=t."offerId" JOIN "Workout" w ON w.id=o."workoutId"';
const execution = 'JOIN "FinisherExecution" e ON e.id=t."executionId" JOIN "Workout" w ON w.id=e."workoutId"';
export const legacyQueries: { family: Exclude<SourceFamily, "DeviceDraft">; joins: string; owner: string; key?: string }[] = [
  { family: "MacroCycle", joins: "", owner: 't."userId"=$1' },
  { family: "HypertrophyPlanDraft", joins: plan, owner: 'm."userId"=$1', key: 't."macroCycleId"' },
  { family: "Mesocycle", joins: plan, owner: 'm."userId"=$1' },
  { family: "MesocycleSeedRevision", joins: meso, owner: 'p."userId"=$1' },
  { family: "TrainingBlock", joins: meso, owner: 'p."userId"=$1' },
  { family: "MesocycleWeekClose", joins: meso, owner: 'p."userId"=$1' },
  { family: "WorkoutTemplate", joins: "", owner: 't."userId"=$1' },
  { family: "WorkoutTemplateExercise", joins: template, owner: 'p."userId"=$1' },
  { family: "Workout", joins: "", owner: 't."userId"=$1' },
  { family: "WorkoutExercise", joins: workout, owner: 'w."userId"=$1' },
  { family: "WorkoutSet", joins: position, owner: 'w."userId"=$1' },
  { family: "SetLog", joins: log, owner: 'w."userId"=$1' },
  { family: "Exercise", joins: "", owner: usedExercise("t.id") },
  { family: "ExerciseVariation", joins: "", owner: usedExercise('t."exerciseId"') },
  { family: "ExerciseAlias", joins: "", owner: usedExercise('t."exerciseId"') },
  { family: "ExerciseEquipment", joins: "", owner: usedExercise('t."exerciseId"'), key: `json_build_array(t."exerciseId",t."equipmentId")::text` },
  { family: "Equipment", joins: "", owner: `EXISTS (SELECT 1 FROM "ExerciseEquipment" ee WHERE ee."equipmentId"=t.id AND ${usedExercise('ee."exerciseId"')})` },
  { family: "PreSessionReadinessSnapshot", joins: "", owner: 't."userId"=$1' },
  { family: "PostSessionReviewSnapshot", joins: workout, owner: 'w."userId"=$1' },
  { family: "SessionCheckIn", joins: "", owner: 't."userId"=$1' },
  { family: "FinisherOffer", joins: workout, owner: 't."ownerId"=$1 AND w."userId"=$1' },
  { family: "FinisherOfferItem", joins: offer, owner: 'o."ownerId"=$1 AND w."userId"=$1' },
  { family: "FinisherExecution", joins: workout, owner: 't."ownerId"=$1 AND w."userId"=$1' },
  { family: "FinisherExecutionStep", joins: execution, owner: 'e."ownerId"=$1 AND w."userId"=$1' },
  { family: "FinisherExecutionCommand", joins: execution, owner: 't."ownerId"=$1 AND e."ownerId"=$1 AND w."userId"=$1 AND t."workoutId"=w.id' },
];
