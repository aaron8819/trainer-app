# Seed Runtime Alignment Audit

Generated: 2026-04-28  
Scope: read-only audit of one live active mesocycle. No production code, schema, test, seed, workout, or database mutation was performed.

## 1. Executive Summary

- Verdict: **PARTIAL**
- Owner: `aaron8819@gmail.com` (`f03601b5-5e2a-40dc-974d-14bb1d1862a3`)
- Active mesocycle: `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4`, meso `3`, `ACTIVE_ACCUMULATION`, `Strength-Hypertrophy`
- Next resolved slot: `upper_a`, intent `upper`, sequence index `0`, week `1`, session `1`
- Seed replay observed: **Yes**
- Fallback observed: **No**
- Main risk: Runtime composition aligned with the persisted seed, but the generated `sessionDecisionReceipt` does **not** include active mesocycle id, slot label, generation path, or seed source as first-class receipt fields. Those are available from surrounding audit/generation evidence, not from the receipt itself.

Interpretation: the core runtime composition invariant passed for this live path. The verdict is `PARTIAL` only because the requested receipt metadata completeness check found missing fields.

## 2. Evidence Sources

### Source Files Inspected

- `trainer-app/src/lib/api/next-session.ts`
- `trainer-app/src/lib/api/mesocycle-slot-contract.ts`
- `trainer-app/src/lib/api/mesocycle-slot-runtime.ts`
- `trainer-app/src/lib/api/template-session.ts`
- `trainer-app/src/lib/api/template-session/slot-plan-seed.ts`
- `trainer-app/src/lib/api/template-session/finalize-session.ts`
- `trainer-app/src/lib/api/workout-context.ts`
- `trainer-app/src/lib/session-semantics/derive-session-semantics.ts`
- `trainer-app/src/lib/audit/workout-audit/context-builder.ts`
- `trainer-app/src/lib/audit/workout-audit/generation-runner.ts`
- `trainer-app/scripts/workout-audit.ts`
- Supporting receipt schema inspection: `trainer-app/src/lib/evidence/types.ts`, `trainer-app/src/lib/evidence/session-decision-receipt.ts`

### Contract Tests Skimmed

- `trainer-app/src/lib/api/template-session.test.ts`
- `trainer-app/src/lib/api/template-session/slot-plan-seed.test.ts`
- `trainer-app/src/lib/api/next-session.test.ts`
- `trainer-app/src/lib/audit/workout-audit/generation-runner.test.ts`

### Commands Run

From `trainer-app/`:

```powershell
npm run audit:workout -- --env-file .env.local --mode future-week
```

Result:

- Owner source: `env-default`
- Owner: `aaron8819@gmail.com`
- User id: `f03601b5-5e2a-40dc-974d-14bb1d1862a3`
- Artifact: `trainer-app/artifacts/audits/2026-04-28T02-12-20-966Z-future-week-upper.json`
- Mode: `future-week`
- Diagnostics: `standard`
- Selected exercises: `6`
- Warnings: `0 blocking`, `0 semantic`, `0 background`

Additional evidence came from an inline read-only Prisma query through the app Prisma adapter to inspect persisted `slotSequenceJson`, `slotPlanSeedJson`, and active mesocycle state. No script file was created and no write/reseed/repair/apply mode was run.

## 3. Persisted Planning Truth

### Active Mesocycle

| Field | Value |
|---|---|
| Owner | `aaron8819@gmail.com` |
| User id | `f03601b5-5e2a-40dc-974d-14bb1d1862a3` |
| Mesocycle id | `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4` |
| Macrocycle id | `f72e2ba6-7350-4c39-9a21-25e5cbce39fd` |
| Meso number | `3` |
| State | `ACTIVE_ACCUMULATION` |
| Focus | `Strength-Hypertrophy` |
| Duration | `5` weeks |
| Sessions per week | `4` |
| Split | `UPPER_LOWER` |
| Accumulation sessions completed | `0` |
| Deload sessions completed | `0` |
| Current lifecycle position | week `1`, session `1`, phase `ACCUMULATION` |
| Constraint weekly schedule | `UPPER`, `LOWER`, `UPPER`, `LOWER` |

### `slotSequenceJson` Summary

Persisted sequence source: `handoff_draft`  
Resolved runtime source: `mesocycle_slot_sequence`  
Mode: `ordered_flexible`  
Has persisted sequence: `true`

| Index | Slot id | Intent | Authored semantics |
|---:|---|---|---|
| 0 | `upper_a` | `upper` | `upper_horizontal_balanced` |
| 1 | `lower_a` | `lower` | `lower_squat_dominant` |
| 2 | `upper_b` | `upper` | `upper_vertical_balanced` |
| 3 | `lower_b` | `lower` | `lower_hinge_dominant` |

### `slotPlanSeedJson` Summary

Persisted seed source: `handoff_slot_plan_projection`  
Seed version: `1`  
All inspected seed entries had explicit `setCount`.

| Slot | Exercise order and set counts |
|---|---|
| `upper_a` | Incline Dumbbell Bench Press `3`; T-Bar Row `3`; Lat Pulldown `3`; Cable Crossover `2`; Cable Triceps Pushdown `2`; Cable Rear Delt Fly `2` |
| `lower_a` | Barbell Back Squat `3`; Stiff-Legged Deadlift `2`; Lying Leg Curl `2`; Standing Calf Raise `2`; Leg Extension `4`; Seated Leg Curl `2` |
| `upper_b` | Dumbbell Overhead Press `3`; Incline Dumbbell Bench Press `5`; Lat Pulldown `3`; Seated Cable Row `2`; Machine Lateral Raise `2`; Cable Lateral Raise `2` |
| `lower_b` | Stiff-Legged Deadlift `5`; Barbell Back Squat `3`; Seated Calf Raise `4`; Leg Press Calf Raise `2`; Goblet Squat `2` |

## 4. Next-Session Resolution

`loadNextWorkoutContext()` resolved the next session as:

| Field | Value |
|---|---|
| Source | `rotation` |
| Existing workout | `null` |
| Intent | `upper` |
| Slot id | `upper_a` |
| Slot sequence index | `0` |
| Slot sequence length | `4` |
| Slot source | `mesocycle_slot_sequence` |
| Week in mesocycle | `1` |
| Session in week | `1` |

Derivation trace:

```txt
normalized_schedule_count=4
slot_contract_source=mesocycle_slot_sequence
incomplete_candidates=0
performed_advancing_intents_this_week=0
performed_advancing_slot_ids_this_week=0
derived_rotation intent=upper slot=upper_a week=1 session=1
selected_rotation_intent=upper
```

Interpretation: there were no incomplete workouts and no performed advancing sessions this week. Because the active mesocycle has a persisted ordered slot sequence, runtime chose the first unperformed persisted slot: `upper_a`.

## 5. Runtime Generation Result

Audit mode: `future-week`  
Generation path: `standard_generation` via `generateSessionFromIntent`  
Generated session intent: `UPPER`  
Generated exercise count: `6`

Runtime selection evidence:

- Every selected exercise had selection rationale reason `persisted_slot_plan_seed`.
- Every selected exercise had rationale component `slotPlanSeed`.
- No audit warnings were emitted.
- No fallback/reselection evidence appeared in the artifact.

| Order | Seed Exercise | Runtime Exercise | Seed Sets | Runtime Sets | Match? |
|---:|---|---|---:|---:|---|
| 1 | Incline Dumbbell Bench Press | Incline Dumbbell Bench Press | 3 | 3 | Yes |
| 2 | T-Bar Row | T-Bar Row | 3 | 3 | Yes |
| 3 | Lat Pulldown | Lat Pulldown | 3 | 3 | Yes |
| 4 | Cable Crossover | Cable Crossover | 2 | 2 | Yes |
| 5 | Cable Triceps Pushdown | Cable Triceps Pushdown | 2 | 2 | Yes |
| 6 | Cable Rear Delt Fly | Cable Rear Delt Fly | 2 | 2 | Yes |

Result: generated exercises and hard-set counts exactly matched the `upper_a` seed.

## 6. Receipt Integrity

Receipt location in artifact:

```txt
generation.selection.sessionDecisionReceipt
```

Receipt keys present:

```txt
cycleContext
deloadDecision
exceptions
lifecycleRirTarget
lifecycleVolume
plannerDiagnosticsMode
readiness
sessionSlot
sorenessSuppressedMuscles
version
```

| Field | Expected From Seed/Context | Receipt Value | Match? |
|---|---|---|---|
| Mesocycle id | `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4` | Not present | No |
| Week number | `1` | `cycleContext.weekInMeso = 1` | Yes |
| Block week | `1` | `cycleContext.weekInBlock = 1` | Yes |
| Phase | `accumulation` | `cycleContext.phase = accumulation` | Yes |
| Block type | `accumulation` | `cycleContext.blockType = accumulation` | Yes |
| Slot id | `upper_a` | `sessionSlot.slotId = upper_a` | Yes |
| Slot label | `upper_a` as human/display label if expected | Not present as separate field | No / not a current receipt field |
| Slot sequence index | `0` | `sessionSlot.sequenceIndex = 0` | Yes |
| Slot sequence length | `4` | `sessionSlot.sequenceLength = 4` | Yes |
| Intent | `upper` | `sessionSlot.intent = upper` | Yes |
| Slot source | `mesocycle_slot_sequence` | `sessionSlot.source = mesocycle_slot_sequence` | Yes |
| Generation source | `standard_generation` | Not present in receipt; present in artifact `generationPath` | No |
| Seed source | `handoff_slot_plan_projection` / `persisted_slot_plan_seed` | Not present in receipt; present in seed JSON and selection rationale | No |
| Deload mode | `none` | `deloadDecision.mode = none` | Yes |

Interpretation: receipt preserves the runtime slot identity needed by downstream session semantics: slot id, intent, index, length, slot source, week, phase, and deload state. It does not preserve active mesocycle id, slot label, generation path, or seed source as first-class receipt fields.

## 7. Fallback Analysis

Fallback used: **No**

Evidence:

- Active mesocycle had `slotSequenceJson` with `ordered_flexible` slots.
- Active mesocycle had `slotPlanSeedJson` with a matching `upper_a` slot.
- `loadNextWorkoutContext()` resolved `upper_a`.
- Runtime generated exactly the six `upper_a` seed exercises.
- Runtime set counts exactly matched seed `setCount` values.
- Selection rationale for every generated exercise was `persisted_slot_plan_seed`.
- Rationale components for every generated exercise included `slotPlanSeed`.
- No warnings or generation errors were emitted.

Fallback classification:

| Fallback Category | Observed? | Evidence |
|---|---|---|
| Expected legacy behavior | No | Persisted sequence and seed were valid and used. |
| Bad data | No | Seed slot matched next slot; all exercise references resolved. |
| Unsupported seed shape | No | Seed parsed and all rows had explicit `setCount`. |
| Missing exercise reference | No | Runtime generated every seeded exercise. |
| Runtime bug | No evidence | Runtime composition matched seed exactly. |
| Architecture risk | Yes, metadata-only | Receipt omits mesocycle id and explicit seed/generation source. Composition itself aligned. |

## 8. Mismatch Inventory

| Mismatch | Layer | Evidence | Severity | Likely Cause |
|---|---|---|---|---|
| Receipt lacks active mesocycle id | Receipt metadata | `sessionDecisionReceipt.cycleContext` has week/phase/block fields but no mesocycle id | Medium | Current receipt schema does not include mesocycle id. |
| Receipt lacks explicit slot label | Receipt/display metadata | `sessionSlot` carries `slotId=upper_a` but no separate label field | Low | Slot id appears to be the canonical machine/display identity; no separate label is currently modeled. |
| Receipt lacks generation path | Receipt metadata | Artifact has `generationPath.executionMode=standard_generation`; receipt does not | Low-medium | Generation path is audit artifact metadata, not current receipt schema. |
| Receipt lacks seed source | Receipt metadata | Seed JSON has `source=handoff_slot_plan_projection`; per-exercise rationale says `persisted_slot_plan_seed`; receipt does not | Medium | Seed provenance is carried in seed/rationale evidence, not current receipt schema. |

No mismatch was found between persisted sequence, persisted seed, next-session slot, generated workout composition, or generated set counts.

## 9. Verdict

**PARTIAL — Runtime replayed the persisted seed exactly, but receipt metadata did not preserve every requested provenance field.**

Runtime composition result:

- `PASS` for persisted `slotSequenceJson` -> next-session slot alignment.
- `PASS` for persisted `slotPlanSeedJson` -> runtime exercise identity alignment.
- `PASS` for persisted `slotPlanSeedJson.setCount` -> runtime set-count alignment.
- `PASS` for receipt preserving slot id, intent, slot source, sequence index, sequence length, week, phase, and deload state.
- `PARTIAL` for receipt preserving full provenance: active mesocycle id, slot label, generation path, and seed source are not first-class receipt fields.

## 10. Recommended Next Action

Run a focused receipt-contract follow-up to decide whether active mesocycle id and seed/generation provenance should be intentionally added to `sessionDecisionReceipt`, or explicitly documented as audit-only/context-only fields outside the receipt.
