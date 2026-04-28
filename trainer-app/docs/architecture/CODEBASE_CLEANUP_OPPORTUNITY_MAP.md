# Codebase Cleanup Opportunity Map

This is a read-only cleanup inventory. It separates static code evidence from live-data dependency risk. A path that is unused by static references is not automatically safe to delete if persisted data or audit artifacts may still depend on it.

Current target model:

```txt
slotSequenceJson + slotPlanSeedJson
-> runtime replay
-> sessionDecisionReceipt
-> deriveSessionSemantics
-> Home/Program/audits
```

## 1. Executive Summary

- Biggest cleanup opportunity: compact the handoff slot-plan projection and template-session/runtime-selection code around the canonical seeded runtime path. The code is live, but the surrounding repair, diagnostics, and legacy fallback layers create the most noise.
- Safest deletion opportunity: remove the always-null workout-list debug label path after updating the two guarded consumers and nearby tests. Static references exist, but the helper returns `null` unconditionally.
- Biggest conceptual noise source: legacy/projection/audit names that sit next to canonical runtime terms: `generationPath`, `legacy_fallback`, `weeklySchedule`, `MesocycleExerciseRole`, old autoregulation metadata, and planner-only diagnostic fields.
- Highest-risk cleanup area: handoff projection repair. Repair mutates accepted successor seeds today and should not be deleted until materiality and live-data dependence are proven.
- Recommended cleanup order: delete inert UI debug label code; document/rename audit-only fields; compact duplicated pure helpers; inventory legacy persisted data; extract large live files without behavior change; only then move proven repair responsibilities upstream.

## 2. Canonical Path to Protect

The source-of-truth chain to preserve is:

```txt
prisma/schema.prisma
  slotSequenceJson: persisted slot order and slot semantics
  slotPlanSeedJson: accepted runtime composition seed

src/lib/api/mesocycle-slot-contract.ts
src/lib/api/mesocycle-slot-runtime.ts
src/lib/api/next-session.ts
  load and replay persisted slot order

src/lib/api/template-session/slot-plan-seed.ts
src/lib/api/template-session.ts
src/lib/api/deload-session.ts
  replay accepted seeded runtime composition

src/app/api/workouts/save/route.ts
src/lib/api/evidence/session-decision-receipt.ts
src/lib/api/selection-metadata.ts
  persist receipt-backed evidence under selectionMetadata.sessionDecisionReceipt

src/lib/session-semantics/derive-session-semantics.ts
  derive read-side session meaning

src/lib/api/home-page.ts
src/lib/api/program.ts
src/lib/api/program-page.ts
src/lib/api/weekly-volume.ts
src/lib/api/projected-week-volume.ts
src/lib/audit/workout-audit/*
  consume canonical receipt and semantics
```

Files that should not be casually modified:

| File | Why protected | Cleanup stance |
|---|---|---|
| `prisma/schema.prisma` | Owns persisted canonical fields and legacy data shape. | `do_not_touch` without migration and inventory plan. |
| `src/lib/api/template-session/slot-plan-seed.ts` | Enforces seeded runtime replay and no silent seeded fallback. | `do_not_touch` except focused tests and compatibility retirement. |
| `src/lib/api/mesocycle-slot-contract.ts` | Bridges canonical `slotSequenceJson` and legacy `weeklySchedule`. | `keep_until_data_inventory`. |
| `src/lib/api/mesocycle-slot-runtime.ts` | Runtime slot selection owner. | `do_not_touch` unless replay contract changes. |
| `src/lib/api/next-session.ts` | Canonical next-session derivation seam. | `do_not_touch` for incidental cleanup. |
| `src/lib/session-semantics/derive-session-semantics.ts` | Read-side semantic owner. | `do_not_touch` except to consolidate downstream recomputation. |
| `src/app/api/workouts/save/route.ts` | Write-side receipt/lifecycle fence. | `compact_candidate`, not delete. |
| `src/lib/api/mesocycle-handoff-slot-plan-projection*.ts` | High-complexity successor seed projection and repair. | `do_not_touch` until materiality audit. |

## 3. Cleanup Candidate Inventory

| Area | Candidate | Classification | Evidence | Risk | Recommended action |
|---|---|---|---|---|---|
| UI workout list | `getWorkoutListDebugLabel()` always returns `null`. | `delete_candidate` | `rg "getWorkoutListDebugLabel"` shows only the helper, two consumers, and tests; helper returns `null`. | Low | Remove helper and guarded render branches in a focused UI cleanup. |
| Log/review UI labels | `sessionTechnicalLabel` is wired through several components while the live log page sets it to `null`. | `keep_until_data_inventory` | `rg "sessionTechnicalLabel"` shows live prop plumbing plus fixture/test strings; `src/app/log/[id]/page.tsx` assigns `null`. | Low-medium | Inventory fixture intent before deletion; likely remove or rename as test-only display fixture. |
| Projection diagnostics facade | `mesocycle-handoff-slot-plan-projection.diagnostics.ts` is a 2-line re-export. | `rename_or_document_candidate` | Static imports from projection, audit types, and tests prove it is live. | Low | Keep or rename as compatibility facade; do not call it dead. |
| Audit generation labels | Top-level `generationPath` overlaps with `generationProvenance.auditOnly.generationPath`. | `rename_or_document_candidate` | Docs and audit serializer mark `generationPath` audit-only; `serializer.ts` emits both top-level and provenance forms. | Medium | Document as audit-only transition field; remove only after artifact consumers are inventoried. |
| Runtime budget math | Planner budget constants/helpers duplicated between `template-session.ts` and `template-session/role-budgeting.ts`. | `compact_candidate` | `rg "MAIN_LIFT_MAX_WORKING_SETS|getNonAnchorOvershootTolerance|roundPlannerValue"` finds duplicates in both files. | Medium | Extract or route callers through `role-budgeting.ts` with equality tests. |
| Template session orchestration | `src/lib/api/template-session.ts` is about 3k lines and mixes replay, fallback, diagnostics, and selection shaping. | `compact_candidate` | `wc`/inspection shows large file; static tests cover seeded and fallback paths. | High | Extract pure helpers only after focused tests; protect seeded replay behavior. |
| Save route | `src/app/api/workouts/save/route.ts` is about 830 lines and still contains route parsing plus lifecycle, receipt, week-close, exercise rewrite, and audit snapshot orchestration. | `compact_candidate` | Route already imports extracted lifecycle/status helpers, but owns many DB workflow steps. | High | Extract behavior-neutral private service/helpers under `src/lib/api` after receipt/lifecycle coverage. |
| Program/dashboard display | Volume and target-label formatting overlap in `program.ts`, `program-page.ts`, and related read models. | `compact_candidate` | `rg "formatTargetLabel|formatTargetDeltaLabel|buildVolumeLandmarkContext"` shows repeated server-side display logic. | Medium | Consolidate server read-model display helpers; keep clients consuming server rows. |
| Weekly volume | `weekly-volume.ts`, `projected-week-volume.ts`, `projected-week-volume-shared.ts`, and `logging-weekly-volume-guidance.ts` share rounding, date window, merge, and contribution patterns. | `compact_candidate` | `rg "roundToTenth|computeMesoWeekStartDate|mergeContributionTotals|computeWorkoutContributionByMuscle"` finds overlap. | Medium | Consolidate pure math/date helpers after focused volume tests. |
| UI session meaning | `workout-list-items.ts`, `session-summary.ts`, `log/[id]/page.tsx`, and parts of `program-page.ts` call low-level classifiers directly. | `move_upstream_candidate` | `rg "isStrictOptionalGapFillSession|isCloseoutSession|isStrictSupplementalDeficitSession|isCanonicalDeload"` in UI/read models. | Medium | Feed derived semantics into read models; do not reclassify in components. |
| Deprecated readiness route | `/api/session-checkins` is deprecated but still called by `GenerateFromTemplateCard.tsx`. | `keep_until_data_inventory` | `rg "session-checkins"` shows route plus client fetch and docs marking deprecation. | Medium | Migrate caller to readiness submit route before deletion. |
| Legacy mesocycle counter | `Mesocycle.completedSessions` is retained while newer counters own lifecycle meaning. | `keep_until_data_inventory` | Schema comment says legacy; lifecycle code still increments; program summaries still expose count. | Medium | Inventory clients and persisted values before removing. |
| Optional Prisma model shim | `context-loader.ts` conditionally accesses `mesocycleExerciseRole` via optional model shape. | `keep_until_data_inventory` | Schema defines model; many direct static refs use generated client; optional shim remains. | Medium | Verify all runtimes use generated clients with model before simplifying. |
| `MesocycleExerciseRole` fallback | Role rows are still used for unseeded fallback, projection continuity, audits, and scripts. | `keep_until_data_inventory` | `rg "MesocycleExerciseRole|mesocycleExerciseRole"` shows Prisma, handoff, audit, scripts, and tests. | High | Do not delete until unseeded/live-data and projection dependencies are retired. |
| `weeklySchedule` fallback | Legacy slot ordering fallback remains in slot contract/runtime. | `keep_until_data_inventory` | `mesocycle-slot-contract.ts` returns `legacy_weekly_schedule` when no valid sequence. | Medium-high | Inventory active mesocycles with null/invalid `slotSequenceJson`. |
| Identity-only seed compatibility | Seed parser tolerates seed exercises without `setCount` and warns. | `keep_until_data_inventory` | `slot-plan-seed.ts` emits legacy set prescription fallback; tests assert warning. | Medium | Inventory `slotPlanSeedJson` missing per-exercise `setCount`. |
| `BODY_PART` fallback | Body-part mesocycles intentionally bypass seeded replay. | `keep_safety_rail` | `resolveSeededSlotPlan()` returns null for `body_part`; tests assert body-part stays legacy. | Medium | Keep until product decision removes BODY_PART support. |
| Projection repair engine | Large repair engine mutates successor seed quality after projection. | `do_not_touch` | Existing pipeline map identifies repair as material and highest-risk. | High | Do not delete; run materiality audit first. |
| Audit explain serializers | `mesocycle-explain.ts`, `artifact-serialization.ts`, and `workout-audit/types.ts` are large and include artifact shape compatibility. | `compact_candidate` | File sizes: explain about 6.4k lines, serialization about 1k, types about 1.3k. | Medium | Split section builders/types only with artifact snapshot coverage. |
| Old autoregulation fields | `wasAutoregulated` and `autoregulationLog` remain in schema and compatibility docs. | `keep_until_data_inventory` | Docs say compatibility-only; validation no longer accepts top-level write inputs. | Medium | Inventory rows and readers before migration/removal. |

## 4. Dead / Likely Unused Code

No broad dead production path was found in the core generation/save seams. The clearest candidates are UI/display plumbing, not runtime policy.

| Candidate | Evidence it may be unused | Search evidence | Safe to delete now? |
|---|---|---|---|
| `src/lib/ui/workout-list-items.ts#getWorkoutListDebugLabel` | The helper returns `null` unconditionally, so consumers never render a label in production. | `rg "getWorkoutListDebugLabel"` finds helper, `RecentWorkouts.tsx`, `HistoryClient.tsx`, and tests asserting null behavior. | Yes, after a focused UI/test update. |
| `sessionTechnicalLabel` prop chain in log/review UI | Live log page sets `const sessionTechnicalLabel = null`; prop still flows through `LogWorkoutHeader`, `LogWorkoutClient`, and `CompletedWorkoutReview`. | `rg "sessionTechnicalLabel"` finds live prop plumbing plus tests/fixtures that pass strings. | Not yet. Inventory whether fixture strings document a desired future display state. |
| Optional `mesocycleExerciseRole` model shim in `context-loader.ts` | Generated Prisma schema includes the model, while this loader still treats it as optional. | `rg "mesocycleExerciseRole"` shows many direct non-optional uses elsewhere and this optional shim. | Not yet. Verify generated clients in all scripts/tests before simplifying. |
| `mesocycle-handoff-slot-plan-projection.diagnostics.ts` facade | It is only a re-export, but not unused. | `rg "mesocycle-handoff-slot-plan-projection.diagnostics"` finds projection, audit types, and tests. | No. Keep or rename/document; static refs prove it is live. |

## 5. Legacy / Compatibility Paths

| Path | Why it exists | Evidence of current use | Delete now? | What inventory is needed |
|---|---|---|---|---|
| Unseeded runtime composition | Supports mesocycles without accepted `slotPlanSeedJson`. | `template-session.ts` returns `legacy_fallback` when active mesocycle has no seed; tests assert unseeded mesocycles stay legacy. | No | Count active and historical mesocycles with null `slotPlanSeedJson`, grouped by status and intent. |
| `BODY_PART` fallback | BODY_PART templates do not use seeded slot-plan runtime. | `slot-plan-seed.ts` returns null for `body_part`; tests assert BODY_PART uses legacy fallback. | No | Product decision plus count of BODY_PART mesocycles/workouts. |
| `weeklySchedule` fallback | Bridges old mesocycles without valid `slotSequenceJson`. | `mesocycle-slot-contract.ts` builds `legacy_weekly_schedule`; `next-session.ts` exposes `legacy_weekly_schedule` slot source. | No | Count active/accepted mesocycles with missing/invalid `slotSequenceJson`. |
| Identity-only seed compatibility | Older seeds may store exercise identity without set prescription. | `slot-plan-seed.ts` warns and falls back to legacy set prescription; tests cover missing `setCount`. | No | JSON inventory of `slotPlanSeedJson` slots with exercises missing `setCount`. |
| `MesocycleExerciseRole` runtime fallback | Still supports unseeded fallback, continuity metadata, projection, scripts, and audits. | `context-loader.ts` comment says seeded runtime is separate; `rg` shows handoff, audit, Prisma scripts, and tests. | No | Prove no live unseeded runtime or projection path depends on role rows. |
| Old receipt/autoregulation metadata | Compatibility with historical saved workouts. | Schema fields `wasAutoregulated` and `autoregulationLog`; docs say save no longer accepts them as top-level inputs. | No | Count historical rows with these fields and confirm all readers use receipt/context instead. |
| Old audit artifact shapes | Keeps artifact consumers stable while provenance moved under receipt-backed summary. | `serializer.ts` emits top-level `generationPath` and `generationProvenance.auditOnly.generationPath`. | No | Inventory artifact readers, snapshots, and downstream scripts. |
| `completedSessions` | Legacy counter retained while lifecycle-specific counters own meaning. | Schema comment marks legacy; lifecycle code still increments; program summaries still expose it. | No | Confirm no UI/API/audit consumer needs the column after replacing with explicit lifecycle counts. |
| `/api/session-checkins` | Deprecated readiness route still has a client caller. | `rg "session-checkins"` finds route and `GenerateFromTemplateCard.tsx` fetch. | No | Migrate caller to canonical readiness route and verify behavior. |
| Legacy handoff starting-point schema | Reads historical successor seed draft shapes. | `readNextCycleSeedDraft()` and handoff summary parsing still include legacy schema tests. | No | Count existing `nextMesocycleStartingPointJson` shapes before retiring parser. |

## 6. Duplicate or Overlapping Responsibilities

| Responsibility | Files involved | Canonical owner | Duplicate/noisy owner | Recommendation |
|---|---|---|---|---|
| Session meaning | `derive-session-semantics.ts`, `workout-list-items.ts`, `session-summary.ts`, `log/[id]/page.tsx`, `program-page.ts` | `src/lib/session-semantics/derive-session-semantics.ts` | UI/read-model direct classifier calls | Move booleans through derived semantics read models. |
| Weekly volume contribution | `weekly-volume.ts`, `projected-week-volume.ts`, `projected-week-volume-shared.ts`, `logging-weekly-volume-guidance.ts` | Shared contribution helpers plus persisted workout logs | Local round/date/merge/contribution helpers | Consolidate pure math/date helpers after focused volume tests. |
| Seed parsing and serialization | `template-session/slot-plan-seed.ts`, `slot-plan-seed-parser.ts`, `mesocycle-handoff-slot-plan-projection.seed-serialization.ts`, `template-session.ts` | Parser plus runtime replay seam | Local normalization and compatibility wrappers | Keep parser canonical; compact wrappers only when behavior remains identical. |
| Selection metadata normalization | `api/selection-metadata.ts`, `evidence/session-decision-receipt.ts`, `ui/selection-metadata.ts`, save route helpers | Receipt-backed metadata API/evidence seams | UI helper and route merge/strip logic | Push display-only extraction into read helpers; keep write receipt validation in save seam. |
| Program/home summaries | `program.ts`, `program-page.ts`, `home-page.ts`, components | Server read models | Repeated display label and volume status formatting | Consolidate server display helper; avoid client reclassification. |
| Repair and quality diagnostics | Projection, repair engine, program quality, planning reality, audit explain serializers | Handoff projection owns accepted seed; audit owns diagnostics | Diagnostics and policy-like names near generation | Rename/document read-only diagnostics; keep repair live until materiality audit. |
| Slot ordering | `mesocycle-slot-contract.ts`, `mesocycle-slot-runtime.ts`, `next-session.ts`, legacy `weeklySchedule` | `slotSequenceJson` contract/runtime | `weeklySchedule` compatibility fallback | Keep fallback until DB inventory; do not add new consumers. |
| Lifecycle/session counters | Save route, lifecycle helpers, `program.ts`, schema legacy counters | Explicit lifecycle state and receipt/semantics | `completedSessions` legacy counter | Retire only after API/client inventory. |

## 7. Large File / Compaction Opportunities

| File | Why large/noisy | Suggested extraction | Risk | Payoff |
|---|---|---|---|---|
| `src/app/api/workouts/save/route.ts` | About 830 lines; mixes request parsing, receipt validation, lifecycle fence, week-close resolution, exercise rewrite, and audit snapshot attachment. | Extract behavior-neutral save workflow helpers under `src/lib/api`, starting with week-close context and exercise rewrite persistence. | High | High: route becomes a thin orchestration entrypoint again. |
| `src/lib/api/mesocycle-handoff-slot-plan-projection.ts` | About 1.7k lines; combines projection phases, planner-only toggles, candidate assembly, repair handoff, and diagnostics. | Split phase orchestration from pure projection helpers; leave repair behavior untouched. | High | High: clearer boundary between accepted seed generation and diagnostics. |
| `src/lib/api/template-session.ts` | About 3k lines; seeded runtime replay, legacy fallback, local budget math, diagnostics, and exercise selection are interleaved. | First extract duplicated budget/math helpers into `template-session/role-budgeting.ts`; later isolate fallback-only composition. | High | High: lowers risk of accidental seeded fallback changes. |
| `src/lib/audit/workout-audit/mesocycle-explain.ts` | About 6.4k lines; artifact explanation, seed comparison, diagnostics, and reporting sections live together. | Split section builders by artifact domain: seed replay, planner-only diagnostics, repair materiality, volume/quality summaries. | Medium | Medium-high: audit output becomes easier to maintain. |
| `src/lib/audit/workout-audit/artifact-serialization.ts` | About 1k lines; serializer compatibility and artifact shaping are dense. | Extract legacy artifact adapters and generation provenance serialization. | Medium | Medium: reduces audit-only noise around production semantics. |
| `src/lib/audit/workout-audit/types.ts` | About 1.3k lines; production-like and audit-only types share one file. | Split read-only diagnostics types from generated-session artifact contracts. | Medium | Medium: makes audit-only fields harder to misuse as policy. |
| `src/lib/ui/selection-metadata.ts` | About 1k lines; display extraction, compatibility parsing, and receipt-derived fields are close together. | Split display view helpers from compatibility readers. | Medium | Medium: reduces temptation to use UI helper as semantic source of truth. |
| `src/lib/api/program.ts` and `src/lib/api/program-page.ts` | Each exceeds 1.2k lines and repeats display/volume patterns. | Extract server-side volume display and target-label builders. | Medium | Medium: less duplicated read-model display logic. |
| `src/lib/api/mesocycle-handoff-slot-plan-projection.repair-engine.ts` | About 2.8k lines; likely contains material repair behavior. | Do not split until materiality findings are known; then extract only proven mechanical utilities. | High | High later, unsafe now. |
| `src/lib/api/planning-reality/*.ts` | Multiple large read-only diagnostics modules could be mistaken for planning policy. | Group report assembly vs evidence collection; keep `readOnly` and `affectsScoringOrGeneration: false` prominent. | Medium | Medium: clarifies diagnostics are not generation policy. |

## 8. Audit-Only Noise

| Audit item | Why confusing | Production dependency? | Recommendation |
|---|---|---|---|
| `generationPath` | Sounds like production routing, but docs say it is audit-only and narrower than receipt provenance. | Audit artifacts and tests depend on it. | Rename/document as audit-only; keep until artifact readers are inventoried. |
| `generationProvenance.auditOnly.generationPath` plus top-level `generationPath` | Same idea appears twice during transition. | Audit serializer emits both. | Keep temporarily; add deprecation note or compatibility adapter. |
| `plannerOnlyDryRun` and `plannerOnlyNoRepair` | Could be mistaken for runtime policy switches. | Audit CLI/tests use them as read-only diagnostics. | Keep names scoped to audit/reporting; avoid importing into production generation. |
| `planningReality` shadow demand/allocation fields | Looks like planning truth, but code marks `readOnly` and `affectsScoringOrGeneration: false`. | Audit artifacts and explain output. | Keep strong read-only labels; do not use for selection/repair scoring. |
| Audit compaction/omitted-count fields | Artifact-size management can look like domain filtering. | Audit serialization only. | Split serializer helpers and document they do not affect runtime. |
| Projection diagnostics facade | File name includes projection path and can look like generation dependency. | Imported by projection/audit/tests. | Rename/document as diagnostics facade, not planning policy. |
| Repair materiality diagnostics | Reports can look like recommendations to remove repair. | Investigation-only. | Treat as evidence-gathering until accepted-seed diffs prove redundancy. |

## 9. UI / Read Model Cleanup

| Area | Possible recomputation | Canonical source | Recommendation |
|---|---|---|---|
| `src/lib/ui/workout-list-items.ts` | Directly calls gap-fill, closeout, supplemental, and deload classifiers to assemble display booleans. | `deriveSessionSemantics()` plus server read model. | Feed semantics into list items or add a server read-model adapter. |
| `src/lib/ui/session-summary.ts` | Pulls receipt/context fields and low-level classifiers for display labels. | Receipt plus `deriveSessionSemantics()`. | Keep display formatting local, but source semantic booleans from derived semantics. |
| `src/app/log/[id]/page.tsx` | Uses `isStrictOptionalGapFillSession()` to block bonus add/exercise add. | Server capability/read model derived from semantics. | Move capability boolean upstream so page does not classify workout kind. |
| `src/lib/api/program-page.ts` | Uses `isCloseoutSession()` while building slot workout lookup. | `deriveSessionSemantics()`. | Low-risk consolidation: derive semantics once for workout rows and reuse. |
| `src/lib/api/program.ts` | Counts advancing sessions using semantics but still has closeout-specific helpers. | `deriveSessionSemantics()` and lifecycle state. | Leave closeout-specific support helpers if narrowly named; avoid broad session-kind recomputation. |
| Components under `src/components/*` | Mostly consume server labels; some debug/technical label plumbing remains. | Server read models. | Remove inert debug labels; keep clients dumb. |

## 10. High-Risk Areas Not To Touch Yet

- Projection repair engine before materiality audit. Existing architecture findings say repair is currently material and accepted seed quality can depend on it.
- Seeded runtime replay and `slotPlanSeedJson` parser/serializer. These enforce the no-silent-fallback contract.
- `slotSequenceJson` contract/runtime fallback removal before live DB inventory of missing/invalid slot sequences.
- `MesocycleExerciseRole` schema/table before proving unseeded runtime, continuity, projection, scripts, and audit no longer depend on it.
- Save route behavior before receipt/lifecycle/week-close contract tests are strengthened. Compaction is reasonable; behavior cleanup is not.
- Selection-v2 internals before upstream planner obligations are defined. Many downstream repairs exist because upstream planning is under-specified.
- Old autoregulation and legacy receipt fields before historical workout inventory.
- Audit artifact serializers before snapshot/equality coverage and artifact consumer inventory.
- `completedSessions` and deprecated readiness route until API/client uses are migrated.

## 11. Recommended Cleanup Roadmap

### Immediate / Low Risk

Audit/docs/types/delete obviously inert code only.

### Near-Term / Medium Risk

Compact large files and remove proven-unused compatibility paths.

### Long-Term / High Impact

Move planning responsibility upstream and delete now-redundant repair/compensation code.

| Order | Cleanup | Why first/next | Required proof | Suggested Codex prompt |
|---:|---|---|---|---|
| 1 | Delete `getWorkoutListDebugLabel` and guarded UI branches. | Clearest static deletion with tiny blast radius. | Focused `rg` refs and affected UI tests. | "Remove the always-null workout list debug label path only; update the two consumers and nearby tests; do not touch session semantics." |
| 2 | Document or rename audit-only `generationPath` usage. | Reduces conceptual noise without behavior change. | Audit serializer/tests still pass; no production imports added. | "Make `generationPath` visibly audit-only in docs/types/comments and preserve artifact shape." |
| 3 | Consolidate duplicate pure volume/display helpers. | Low production risk if pure helpers are equality-tested. | Focused tests for weekly/projected volume and program read models. | "Extract shared pure helpers for volume rounding/date windows/display labels without changing API output." |
| 4 | Inventory legacy persisted fallback data. | Unlocks safe deletion later. | DB queries for null `slotSequenceJson`, null/identity-only `slotPlanSeedJson`, BODY_PART mesocycles, old autoreg fields, role rows by status. | "Write a read-only Prisma inventory script/report for legacy slot/runtime fallback dependency; no migrations." |
| 5 | Compact `save/route.ts` behavior-neutral helpers. | Route is large and important; extraction improves maintainability. | Save route focused tests around receipt requirement, closed mesocycle fence, week close, and empty completion handling. | "Extract save route helper functions without changing behavior; preserve route contract and focused tests." |
| 6 | Compact duplicated template-session budget helpers. | Reduces drift between runtime and role-budgeting math. | `template-session` and `role-budgeting` tests prove identical decisions. | "Route duplicate template-session budget math through `role-budgeting.ts`; keep seeded runtime behavior identical." |
| 7 | Move UI session-kind booleans upstream. | Reduces downstream semantic recomputation. | Program/home/history/log UI tests and read-model snapshots. | "Have workout list/log read models consume `deriveSessionSemantics` booleans instead of low-level classifiers." |
| 8 | Split audit explain serializers. | Large audit files are noisy but not user-facing runtime. | Artifact snapshot/equality tests. | "Split mesocycle audit explain section builders by domain while preserving artifact output byte-for-byte where intended." |
| 9 | Run repair materiality inventory. | Needed before deleting or moving projection repair code. | No-repair vs repaired accepted seed diffs across representative mesocycles. | "Produce a repair materiality report comparing accepted slotPlanSeedJson with and without repair; no production changes." |
| 10 | Move one proven repair obligation upstream. | Long-term high-impact cleanup. | Materiality report identifies one bounded repair class with deterministic upstream owner. | "Move one proven projection repair obligation into upstream planner intent/budgeting, keep repair as safety rail, and verify accepted seed parity." |
| 11 | Retire compatibility fallback after data migration. | Removes real conceptual noise. | Inventory shows no live dependency, migration/backfill complete, contracts updated. | "Delete one proven-unused legacy fallback path after DB inventory and migration; update tests/docs." |

## 12. Final Recommendation

The best next cleanup action is to remove the inert workout-list debug label path. It is small, reversible, and backed by static evidence: `getWorkoutListDebugLabel()` always returns `null`, and its only production consumers render it conditionally.

Recommended first cleanup prompt:

```txt
Remove the always-null workout list debug label path only. Delete getWorkoutListDebugLabel, remove the guarded label render branches in RecentWorkouts and HistoryClient, update the nearby UI tests, and do not change session semantics, receipts, runtime generation, or audit behavior.
```

After that, run a read-only legacy data inventory before deleting any seeded-runtime, weeklySchedule, BODY_PART, identity-only seed, MesocycleExerciseRole, autoregulation, or projection repair compatibility path.
