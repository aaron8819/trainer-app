# Legacy Fallback Data Inventory

Inventory generated from read-only Prisma/SQL queries on 2026-04-28. No DB writes, migrations, seed scripts, repair scripts, or app mutations were run.

Method notes:
- Raw SQL was used for JSONB/null and enum-array counts where it was clearer than Prisma JSON filters.
- Identity-only seed compatibility was inspected by reading `Mesocycle.slotPlanSeedJson` blobs in JS and counting seed exercises missing `setCount`.
- The schema has no `Mesocycle.split = BODY_PART` field and no `ARCHIVED` mesocycle state. BODY_PART live data was inventoried through the actual schema surfaces: `Workout.sessionIntent`, `WorkoutTemplate.intent`, `Constraints.weeklySchedule`, and `slotSequenceJson` slot intents.

Mesocycle baseline:

| Metric | Count |
|---|---:|
| Total mesocycles | 3 |
| Current active mesocycles (`isActive=true`) | 1 |
| Active-state mesocycles (`ACTIVE_ACCUMULATION` or `ACTIVE_DELOAD`) | 1 |
| `AWAITING_HANDOFF` mesocycles | 0 |
| `COMPLETED` mesocycles | 2 |

Active mesocycle sample:

| id | mesoNumber | state | isActive | splitType | has slotSequenceJson | has slotPlanSeedJson |
|---|---:|---|---|---|---|---|
| `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4` | 3 | `ACTIVE_ACCUMULATION` | true | `UPPER_LOWER` | true | true |

## 1. Executive Summary

- Safe to delete now: no full legacy/fallback path is safe to delete globally from DB evidence alone.
- Blocked by live data: `MesocycleExerciseRole` has active rows; old autoregulation logs still exist historically.
- Needs migration: historical missing `slotSequenceJson`, historical missing `slotPlanSeedJson`, historical identity-only seed rows, old `autoregulationLog` rows, and `SessionCheckIn` compatibility data if the deprecated route/table is retired.
- Unknown / insufficient evidence: whether historical completed mesocycles must remain replayable by every audit/report path after fallback removal. The DB shows no active runtime dependency for weeklySchedule fallback, unseeded runtime, or identity-only seed compatibility, but historical rows still depend on those readers unless backfilled or intentionally excluded.

High-level cleanup signal:
- Active runtime generation is not currently blocked by missing `slotSequenceJson`, missing `slotPlanSeedJson`, identity-only seed data, or active BODY_PART workouts.
- `SessionCheckIn` table deletion remains a separate historical data-retention decision; route deletion is no longer blocked by production callers.

## 2. Slot Sequence Fallback (weeklySchedule)

Goal: find mesocycles still relying on `weeklySchedule` fallback because they lack `slotSequenceJson`.

Query condition:

```sql
WHERE "slotSequenceJson" IS NULL OR "slotSequenceJson" = '{}'::jsonb
```

- Count: 1 mesocycle.
- Active vs historical: 0 active/current; 1 completed historical.
- Safe to remove? Not globally. Active runtime appears clear, but historical/audit/read paths may still need the fallback unless the completed row is backfilled or those paths explicitly stop replaying old mesocycles.

Breakdown:

| state | isActive | Count |
|---|---|---:|
| `COMPLETED` | false | 1 |

Summary:

| Metric | Count |
|---|---:|
| Missing slot sequence total | 1 |
| Current active missing slot sequence | 0 |
| Active-state missing slot sequence | 0 |
| Awaiting handoff missing slot sequence | 0 |
| Completed missing slot sequence | 1 |

## 3. Unseeded Runtime (slotPlanSeedJson)

Goal: detect mesocycles still relying on unseeded runtime composition because they lack `slotPlanSeedJson`.

Query condition:

```sql
WHERE "slotPlanSeedJson" IS NULL
```

- Count: 1 mesocycle.
- Active vs historical: 0 active/current; 1 completed historical.
- Risk level: low for active runtime cleanup; medium for historical audit/report replay.

Breakdown:

| state | isActive | Count |
|---|---|---:|
| `COMPLETED` | false | 1 |

Summary:

| Metric | Count |
|---|---:|
| Missing slot plan seed total | 1 |
| Current active missing slot plan seed | 0 |
| Active-state missing slot plan seed | 0 |
| Awaiting handoff missing slot plan seed | 0 |
| Completed missing slot plan seed | 1 |
| Active missing-seed samples fetched | 0 |

Active sample result: no active mesocycles were missing `slotPlanSeedJson`.

## 4. Identity-Only Seed Compatibility

Goal: detect legacy seed compatibility where seeded exercises exist but omit `setCount`.

Inspection strategy:
- Fetched all mesocycles with non-null `slotPlanSeedJson`.
- Inspected each `slots[*].exercises[*]` object for missing `setCount`.

- Count: 1 affected mesocycle.
- Affected mesocycles: 1 completed historical mesocycle, 4 affected seed slots.
- Risk level: low for active runtime; medium for historical/audit replay until backfilled.

Summary:

| Metric | Count |
|---|---:|
| Seeded mesocycles inspected | 2 |
| Affected identity-only seed mesocycles | 1 |
| Active affected identity-only seed mesocycles | 0 |
| Affected slots in sample | 4 |

Affected mesocycles:

| id | mesoNumber | state | isActive | splitType | affectedSlots |
|---|---:|---|---|---|---:|
| `12079700-5333-4ffc-9cbd-bb303588f288` | 2 | `COMPLETED` | false | `UPPER_LOWER` | 4 |

Safe to remove? Not globally. The active mesocycle has explicit set counts, but at least one historical seed still needs identity-only compatibility unless backfilled or excluded from replay.

## 5. BODY_PART Support

The requested `Mesocycle.split = "BODY_PART"` query does not match the current schema. `Mesocycle` has `splitType` (`PPL`, `UPPER_LOWER`, `FULL_BODY`, `CUSTOM`) and not a BODY_PART split column. BODY_PART exists as `WorkoutSessionIntent` and `TemplateIntent`.

Inventory surfaces checked:
- `Workout.sessionIntent = 'BODY_PART'`
- `WorkoutTemplate.intent = 'BODY_PART'`
- `Constraints.weeklySchedule` containing `BODY_PART`
- `slotSequenceJson.slots[*].intent = body_part`

- Count: 2 BODY_PART workouts.
- Active usage: 0 active BODY_PART workouts; 2 terminal historical workouts linked to completed mesocycles.
- Product dependency: still present in code/docs for supplemental and optional BODY_PART generation flows, even though live active DB usage is zero.

Summary:

| Metric | Count |
|---|---:|
| BODY_PART workouts | 2 |
| BODY_PART workouts linked to mesocycles | 2 |
| BODY_PART open/in-progress/planned/partial workouts | 0 |
| BODY_PART terminal workouts | 2 |
| BODY_PART workout templates | 0 |
| Constraints with BODY_PART in weeklySchedule | 0 |
| Slot sequences containing BODY_PART intent | 0 |
| Active BODY_PART workouts | 0 |

BODY_PART workout breakdown:

| mesocycle state | isActive | workout status | Count |
|---|---|---|---:|
| `COMPLETED` | false | `COMPLETED` | 2 |

Safe to remove? Not from data alone. Active DB data does not block active-runtime cleanup, but product/UI flows still expose BODY_PART for optional and supplemental sessions.

## 6. MesocycleExerciseRole

Goal: determine whether role rows are still live.

- Row count: 35 total `MesocycleExerciseRole` rows.
- Active usage: 5 rows linked to the current active mesocycle.
- Runtime dependency: table deletion or broad role fallback deletion is blocked. Even if seeded runtime composition is canonical, active role rows still exist as continuity/projection metadata.

Summary:

| Metric | Count |
|---|---:|
| Total role rows | 35 |
| Current active role rows | 5 |
| Active-state role rows | 5 |
| Awaiting handoff role rows | 0 |
| Completed role rows | 30 |

Active role samples:

| mesocycleId | mesoNumber | state | sessionIntent | role | exerciseId |
|---|---:|---|---|---|---|
| `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4` | 3 | `ACTIVE_ACCUMULATION` | `UPPER` | `CORE_COMPOUND` | `78089cb4-8ff0-4b32-94e8-5751fb4a7872` |
| `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4` | 3 | `ACTIVE_ACCUMULATION` | `UPPER` | `CORE_COMPOUND` | `985a65ca-6086-4659-83ab-289d89e3fcbf` |
| `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4` | 3 | `ACTIVE_ACCUMULATION` | `UPPER` | `CORE_COMPOUND` | `d6a35b43-3635-43a6-a5d3-89b396307eeb` |
| `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4` | 3 | `ACTIVE_ACCUMULATION` | `UPPER` | `CORE_COMPOUND` | `f81a8406-c6f5-4e70-a4b6-f097e3bbac8b` |
| `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4` | 3 | `ACTIVE_ACCUMULATION` | `LOWER` | `CORE_COMPOUND` | `6f1e89b9-8a41-403a-a4a0-a64f16c86352` |

Role rows by state/intent/role:

| state | isActive | sessionIntent | role | Count |
|---|---|---|---|---:|
| `ACTIVE_ACCUMULATION` | true | `UPPER` | `CORE_COMPOUND` | 4 |
| `ACTIVE_ACCUMULATION` | true | `LOWER` | `CORE_COMPOUND` | 1 |
| `COMPLETED` | false | `PUSH` | `CORE_COMPOUND` | 2 |
| `COMPLETED` | false | `PUSH` | `ACCESSORY` | 3 |
| `COMPLETED` | false | `PULL` | `CORE_COMPOUND` | 2 |
| `COMPLETED` | false | `PULL` | `ACCESSORY` | 4 |
| `COMPLETED` | false | `LEGS` | `CORE_COMPOUND` | 1 |
| `COMPLETED` | false | `LEGS` | `ACCESSORY` | 5 |
| `COMPLETED` | false | `UPPER` | `CORE_COMPOUND` | 4 |
| `COMPLETED` | false | `UPPER` | `ACCESSORY` | 4 |
| `COMPLETED` | false | `LOWER` | `CORE_COMPOUND` | 1 |
| `COMPLETED` | false | `LOWER` | `ACCESSORY` | 4 |

Recent workout sample showed historical workouts still matching role rows. Recent active-role rows exist even though current active seeded runtime has both `slotSequenceJson` and `slotPlanSeedJson`.

## 7. Autoregulation Legacy Fields

Goal: check old `Workout.wasAutoregulated` and `Workout.autoregulationLog` usage.

Schema note:
- `Workout.wasAutoregulated` is non-nullable with `@default(false)`.
- The requested not-null query therefore counts every workout, not meaningful legacy usage.

Required not-null query result:

| Query | Count |
|---|---:|
| `wasAutoregulated IS NOT NULL OR autoregulationLog IS NOT NULL` | 93 |

Meaningful legacy-use query:

```sql
WHERE "wasAutoregulated" = true OR "autoregulationLog" IS NOT NULL
```

Usage count:

| Metric | Count |
|---|---:|
| Meaningful legacy autoreg rows | 3 |
| `wasAutoregulated = true` rows | 0 |
| `autoregulationLog IS NOT NULL` rows | 3 |

Samples:

| workoutId | scheduledDate | status | sessionIntent | wasAutoregulated | hasAutoregulationLog |
|---|---|---|---|---|---|
| `b1d4db2e-be81-4b6d-bca6-ce2bf7d8e954` | `2026-03-02T17:10:56.131Z` | `COMPLETED` | `PULL` | false | true |
| `810bb3a4-b1c7-4f4a-8452-5a8e5af2417c` | `2026-02-27T19:35:46.128Z` | `COMPLETED` | `LEGS` | false | true |
| `388f1e4c-b8a7-4944-91c4-c573f66214e5` | `2026-02-25T22:50:46.970Z` | `COMPLETED` | `PUSH` | false | true |

Read paths:
- Static production refs exist in `src/components/AutoregulationDisplay.tsx`, `src/lib/api/autoregulation.ts`, `src/lib/evidence/session-decision-receipt.ts`, and `src/lib/ui/selection-metadata.ts`.
- Docs say current active runtime decision state is receipt-backed and save no longer accepts these compatibility fields as write inputs.

Safe to remove? No. Historical `autoregulationLog` rows exist and read/display code still exists. Removal needs a migration/backfill or a product decision that historical logs can be dropped.

## 8. Deprecated Routes

Route checked: `/api/session-checkins`.

Static evidence:

| Search | Evidence |
|---|---|
| `GenerateFromTemplateCard.tsx` | Production UI submits pre-generation readiness to `/api/readiness/submit`. |
| `src/app/api/session-checkins/route.ts` | Route deleted as endpoint cleanup after the deletion-readiness audit found no production caller. |
| Tests/docs | Focused tests cover the canonical readiness route and no current API contract lists the deleted route. |

DB evidence:

| Table | Count |
|---|---:|
| `SessionCheckIn` | 18 |
| `ReadinessSignal` | 63 |

- Still called? No.
- Safe to remove? Yes, route only. The Prisma `SessionCheckIn` table/model remains for historical data until a separate schema/data migration decision.

## 9. Classification

| Area | Status | Action |
|---|---|---|
| slotSequence fallback | No active DB dependency; 1 completed historical mesocycle missing `slotSequenceJson`. | Do not delete globally yet. Consider active-runtime compaction only after confirming historical/audit behavior or backfilling the completed row. |
| unseeded runtime | No active DB dependency; 1 completed historical mesocycle missing `slotPlanSeedJson`. | Active runtime cleanup is plausible; keep historical fallback until backfilled or intentionally unsupported. |
| identity-only seed | No active DB dependency; 1 completed historical seed missing `setCount` in 4 slots. | Backfill historical seed set counts or retain parser compatibility for history/audits. |
| BODY_PART | No active DB usage; 2 terminal historical workouts; no templates, constraints, or slot sequences using BODY_PART. | Data does not block active cleanup, but product flows still use BODY_PART for optional/supplemental generation. Do not delete without product/UI migration. |
| MesocycleExerciseRole | Live active dependency exists: 5 active rows, 35 total. | Do not delete table or broad role fallback. Narrow runtime reads only after projection/continuity ownership is proven. |
| autoreg fields | Historical dependency exists: 3 rows with `autoregulationLog`; production read/display paths still exist. | Needs migration/backfill or explicit historical-data drop decision before schema/code removal. |
| deprecated readiness route | No live static caller; 18 historical `SessionCheckIn` rows remain. | Route deleted; keep table/model until separate data-retention migration decision. |

## 10. Final Recommendation

The next cleanup action unlocked by this inventory is active-runtime fallback compaction for seeded mesocycles, not deletion of compatibility globally.

Best first concrete step:

```txt
Keep the deleted `/api/session-checkins` endpoint out of the current API surface, preserve `/api/readiness/submit`, and leave the `SessionCheckIn` table/model in place until a follow-up data-retention pass.
```

Why this first:
- It removes a confirmed obsolete endpoint with no seed/projection/runtime risk.
- It does not require DB migration.
- It moves one legacy path closer to deletion while avoiding the higher-risk historical seed/sequence and active `MesocycleExerciseRole` dependencies.

For fallback deletion specifically, run a follow-up backfill or historical-support decision for:
- 1 completed mesocycle missing `slotSequenceJson`.
- 1 completed mesocycle missing `slotPlanSeedJson`.
- 1 completed identity-only seed with 4 affected slots.
- 3 workouts with historical `autoregulationLog`.
