# Trainer App 2.0 — Repository Gap Analysis

## 1. Status / executive verdict

**Analysis complete. Recommend broad replacement of core domain authority through strangler/replacement boundaries, with selective extraction of useful capabilities.** The existing application is not a suitable domain skeleton for Trainer App 2.0. It is a useful source of training records, exercise data, calculations, interface mechanics, and integrity techniques.

The strongest recent implementation—authored weekly hypertrophy prescriptions, immutable accepted V4 seeds, explicit placement correlation, schedule resolution, frozen measurement tuples, and transactional final-slot completion—reduces real legacy risks. It does not establish the future model. Future occurrences are still derived seed/week/slot obligations; the same Workout/WorkoutExercise/WorkoutSet hierarchy serves planned work and execution; PARTIAL does not resolve scheduled work; corrections lack preserved versions; and local drafts are not durable synchronization.

Preserving that runtime and adding the missing concepts around it would preserve competing ownership. Replace Planning, Execution & Evidence, lifecycle, synchronization, and recommendation authority. Extract algorithms only after their inputs and assumptions are made compatible with the finalized contract. Preserve legacy history as sourced evidence, not as live 2.0 obligations.

This is a static, read-only repository investigation. No application files, migrations, tests, branches, PRs, dependencies, databases, or provider state were changed. The sole written deliverable is this Markdown file outside the repository. No tests or runtime/DB audit commands were executed; test observations below describe inspected assertions, not newly passing results.

## 2. Repository coordinates inspected

| Coordinate | Inspected value |
| --- | --- |
| Repository | `C:\Users\aabloch\claude\vibe-coding\Trainer` |
| Application | `trainer-app/` |
| Branch | `master` |
| Commit | `eb1b45e9c516d14e8857e5b028f2be13233619cd` — Expose final-state prescription readouts (#78) |
| Git tree | `f0ee3a9f3c99c128f9d22e55cfe8b9f6e36b2a76` |
| Working state at inspection | Clean |
| Inspection date | September 9, 2026 |
| Product authority | [Trainer-App-2.0-Blueprint-FINAL (1).md](<C:/Users/aabloch/Downloads/Trainer-App-2.0-Blueprint-FINAL (1).md>), second adversarial-review revision |
| Product SHA-256 | `5FC72877DC2E1103DC8A199EBC791ED6E149B4CEBF11955CF949CD92C2023094` |
| Architecture authority | [TRAINER_APP_2_DOMAIN_ARCHITECTURE.md](C:/Users/aabloch/Downloads/TRAINER_APP_2_DOMAIN_ARCHITECTURE.md), verdict READY FOR REPOSITORY GAP ANALYSIS |
| Architecture SHA-256 | `174501628F254383389C867F2D08519D30E1A0B433CADBC922665FF7E4DFE547` |

References B§n mean blueprint sections; A§n and Ixx mean architecture sections and invariants. The architecture explicitly identifies this exact blueprint filename/hash, resolving the apparent filename difference from the task. Older blueprint versions were not used.

Investigation covered the schema and relevant migration SQL; plan creation/copy/finalization/selection; generation and seed replay; normal save/logging/runtime mutations; next-session and terminal lifecycle; history/PR/volume/progression; local recovery; and corresponding tests. Documentation discovery began at [00_START_HERE.md](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/docs/00_START_HERE.md). Its existing-code authority applies only to claims about current behavior; the user's finalized future documents govern disposition.

### Evidence reference index

These references identify primary owners, not merely folders. Later tables use these IDs to keep the comparison readable. Symbols named in findings locate the relevant logic within a file.

| ID | Exact repository reference and inspected responsibility |
| --- | --- |
| E01 | [schema.prisma](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/prisma/schema.prisma): domain entities, relationships, nullability, status enums |
| E02 | [plan-management.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/plan-management.ts): creation, lifecycle projection, review, finalize, archive |
| E03 | [hypertrophy-plan-drafts.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/hypertrophy-plan-drafts.ts): draft CAS, preview/health scope, make-ready, copy |
| E04 | [hypertrophy-plan-authoring.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/engine/hypertrophy-plan-authoring.ts): draft/accepted formats, placement IDs, V4 compiler and copy |
| E05 | [active-plan-context.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/active-plan-context.ts): selected-plan pointer, transition claim, serializable selection |
| E06 | [template-session.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/template-session.ts): generation orchestration, accepted-V4 path, template/intent selection |
| E07 | [v4-scheduled-slot-resolution.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/v4-scheduled-slot-resolution.ts): accepted revision validation, finite required slots, claims |
| E08 | [next-session.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/next-session.ts): incomplete-workout selection, rotation/slot derivation, blockers |
| E09 | [workouts/save/route.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/app/api/workouts/save/route.ts): generic save, receipt reconciliation, persistence and terminal effects |
| E10 | [save-workout/persistence.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/save-workout/persistence.ts): row CAS, structure replacement, measurement capture |
| E11 | [save-workout/guards.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/save-workout/guards.ts): planned-only rewrites, closed-mesocycle fences |
| E12 | [logs/set/route.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/app/api/logs/set/route.ts): upsert/delete actual sets, warmup creation, first-log status transition |
| E13 | [workout-mutation.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/workout-mutation.ts): workout revision claim and selected-plan guard |
| E14 | [runtime-exercise-swap-service.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/runtime-exercise-swap-service.ts): replacement discovery, prescription, conditional commit |
| E15 | [runtime-exercise-remove-service.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/runtime-exercise-remove-service.ts): unlogged-row removal |
| E16 | [runtime-edit-reconciliation.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/runtime-edit-reconciliation.ts): session-only operation metadata and structure reconciliation |
| E17 | [placement-correlation.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/session-semantics/placement-correlation.ts): explicit generated-to-persisted matching and legacy fallback |
| E18 | [workout-status.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/workout-status.ts), [save-workout/status.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/save-workout/status.ts): performed/completed/resolved policies and finish metrics |
| E19 | [save-workout/lifecycle.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/save-workout/lifecycle.ts): V4 resolution and legacy terminal effects |
| E20 | [mesocycle-lifecycle-state.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/mesocycle-lifecycle-state.ts): finite completion, handoff, early finish, terminal locks |
| E21 | [mesocycle-week-close.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/mesocycle-week-close.ts): deficit snapshots, optional closeout creation/dismissal |
| E22 | [workout-deletion.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/workout-deletion.ts), [mesocycle-lifecycle-reconciliation.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/mesocycle-lifecycle-reconciliation.ts): destructive deletion and lifecycle repair |
| E23 | [exercise-measurement/semantics.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/exercise-measurement/semantics.ts): measurement tuples, frozen zero capability, comparison key |
| E24 | [exercise-history.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/exercise-history.ts): performed exposure projection and load records |
| E25 | [pr-tracker.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/pr-tracker.ts): load/reps PR aggregation |
| E26 | [engine/progression.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/engine/progression.ts): legacy progression, overshoot/catch-up, regression/deload rules |
| E27 | [engine/load-prescription.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/engine/load-prescription.ts), [canonical-progression-input.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/progression/canonical-progression-input.ts), [progression-eligibility.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/progression/progression-eligibility.ts): evidence binding, calibration/comparability and eligibility |
| E28 | [weekly-volume.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/weekly-volume.ts), [projected-week-volume.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/projected-week-volume.ts): performed and projected volume |
| E29 | [pre-session-readiness-snapshot.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/pre-session-readiness-snapshot.ts), [post-session-review-snapshot.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/post-session-review-snapshot.ts): cached readiness and historical interpretations |
| E30 | [useSetDraft.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/components/log-workout/useSetDraft.ts), [log-workout/api.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/components/log-workout/api.ts): local input drafts and request delivery |
| E31 | [templates.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/templates.ts): reusable ordered exercise lists and analysis |
| E32 | [ui/selection-metadata.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/ui/selection-metadata.ts), [session-capacity-reduction.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/template-session/session-capacity-reduction.ts): structure inputs and short-today fingerprints |
| E33 | [workout-context.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/workout-context.ts): configured owner, generation/history adapters |
| E34 | [06_TESTING.md](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/docs/06_TESTING.md), [package.json](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/package.json): verification inventory and operational command entry points |
| E35 | [immutable-seed migration](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/prisma/migrations/20260713180000_add_immutable_mesocycle_seed_revisions/migration.sql), [measurement migration](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/prisma/migrations/20260807120000_add_exercise_measurement_foundation/migration.sql): provenance import, immutability trigger, tuple constraints |
| E36 | [production-write-gate-http.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/operations/production-write-gate-http.ts): pre-mutation maintenance rejection |

## 3. Current-state architecture map

| Subsystem | Current responsibility and owned data | Dependencies and overlapping responsibility |
| --- | --- | --- |
| Application/UI | Next.js route/page/component application; plan editor, home/program, preview, logger, history, library. E30/E34 and `src/components/LogWorkoutClient.tsx` | UI payloads include generation/selection metadata, status actions and expected revision. Presentation carries domain-shaped reconstruction inputs |
| Plan management | MacroCycle is the visible plan; User selects it; Mesocycle carries operational phase/state. Draft payload lives in HypertrophyPlanDraft. E01–05 | Lifecycle is projected from child mesocycles plus draft existence and the separate selected pointer. READY is not equivalent to current Active |
| Custom authoring | Versioned draft sessions, placements, per-week prescriptions, review and health confirmation; make-ready compiles accepted seed and deletes draft. E03–04 | Depends on catalog measurement, current limitations, V4 topology and acceptance; not a general live occurrence editor |
| Reuse and recommended structures | WorkoutTemplate stores ordered exercise references; custom plan copy creates new macro/draft; generation can supply proposed structure. E03–04/E31 | Templates do not store the complete target structure required by 2.0. Copy carries old slot/placement strings, although nested under a new plan |
| Legacy planner/generator | Pure V2 planning/materialization under `src/lib/engine/planning/v2`; optimized selection under `selection-v2`; periodization and runtime composition in E06 | Goals, muscles/landmarks, inventory, recent work, readiness, seed lanes and remaining-week deficits influence generated prescriptions |
| Accepted runtime authority | MesocycleSeedRevision owns immutable executable seed; slot sequence and lifecycle remain separate. E01/E07/E35 | Seeds are better protected than compatibility JSON, but complete runtime meaning also depends on current mesocycle and receipt/claim state |
| Planned work / next | V4 enumerates week+slot obligations; older paths derive rotation/session from counters and performed claims. Persisted incomplete Workout can take priority. E07–08 | No general occurrence-owned future object with explicit removal/skip/amendment lifecycle; generated claim metadata bridges intent to execution |
| Execution/logging | Workout with child positions/target sets; one SetLog per target row; runtime edit operations in selectionMetadata. E09–18 | First logging can change PLANNED to IN_PROGRESS. Completion uses log coverage. Same mutable target structure is read by history/completeness |
| Lifecycle/closure | Mesocycle phases/counters, week close, optional gap-fill, finite V4 completion or successor handoff. E19–22 | Terminal transactions can invoke review snapshot generation and deficit evaluation. Deletion can reconcile lifecycle |
| Catalog/measurement | Exercise IDs, aliases, muscle/equipment relationships, substitution rules, nullable measurement and frozen WorkoutExercise fields. E01/E23 | Catalog contains programming scores and landmarks as well as descriptive facts. No user-owned custom exercise creation path found in inspected exercise routes |
| Progression/load | History adapters → calibration/comparability → load application and progression decision trace. E26–27; `src/lib/engine/apply-loads.ts` | Multiple legacy policy families, session eligibility and accepted seed prescriptions meet in generation and logging guidance |
| Analytics | Exercise history, PRs, stimulus/volume, program projection, readiness/review. E24–29 | Different consumers apply different evidence filters. Some calculations feed future generation or transactional closure artifacts |
| Goals/preferences/constraints | Profile, two goal enums, Constraints schedule/split, Injury, favorite/avoid arrays; draft limitation/equipment inputs. E01/E03/E33 | No full criteria-bearing milestones or versioned scoped instruction/exception authority. Injury/readiness and selection heuristics overlap |
| Synchronization | Debounced localStorage field drafts, sessionStorage UI/rest timer, direct HTTP requests. E30 | No general action journal, acknowledged offline log queue, included-action finish dependencies, or conflict record owner found |
| Migration/operations | Immutable seed import, snapshot backfills, historical slot repair, write gate, classified tests, integrity tooling. E34–36 | Useful integrity infrastructure; repairs target legacy semantics and are not a 2.0 import/cutover system |
| Optional finishers | Separate routine versions, offers, decisions, executions, commands, timer steps. E01; `src/lib/api/finisher-service.ts` | Stronger local command/provenance vocabulary than main logger, but post-workout lifecycle and legacy Workout linkage require adaptation |

Current normal flow: draft → accepted seed/mesocycle → selected plan → next slot → generation/preview → save Workout → log/mutate → save status → schedule/counters/closure/review → history → next generated guidance. Older automatic plans and newer authored plans converge in this runtime rather than having independent domain authority.

## 4. Current authority map

| Fact | Current authority | Required 2.0 authority and finding |
| --- | --- | --- |
| Future workout intent | Draft payload before make-ready; accepted seed afterward; legacy fallback seed where applicable. E03–07 | Planning owns independently identified pending occurrence prescriptions. Ownership changes format and runtime dependency at readiness; REWRITE |
| Plan structure | MacroCycle/Mesocycle/TrainingBlock plus seed and slotSequenceJson. E01–07 | One Plan's approved intent/stages/occurrences/amendments. Duplicated structural representations must not become competing target owners |
| Next workout | E08 combines selected context, incomplete workouts, V4 claims or counters/rotation and closeout blockers | Derived earliest pending retained occurrence; account-wide Resume wins. Current selection is coupled to generation validity |
| Workout identity | Workout UUID plus seed, slot receipt, snapshots and materialization classification. E07/E09 | Occurrence identity exists before execution; execution has its own stable identity and ordinary source relationship |
| Exercise occurrence identity | Accepted placementId, generated placement ID, persisted WorkoutExercise UUID and correlation sidecar. E04/E10/E17 | Explicit planned position and session position with source relationship. Current bridge is valuable but incomplete |
| Started prescription | Persisted WorkoutSet targets, frozen position measurement, generated audit evidence; no explicit universal start capture boundary. E09–12 | Execution owns immutable starting meaning and separate adjustments, not a mutable target graph plus inferred provenance |
| Runtime substitutions | E14 changes unlogged row exercise/targets; E16 records operation | Execution owns replacement remaining work, preserving already performed sets and start meaning |
| Logged sets | SetLog keyed uniquely by WorkoutSet; mutable upsert/delete. E01/E12 | Execution & Evidence owns actual assertion identity, versions and corrections |
| Completion | E18 infers COMPLETED vs PARTIAL from coverage; only COMPLETED/SKIPPED schedule-resolve | Explicit finish resolves occurrence, with independent completeness and unknowns |
| Plan closure | E19–20 finite V4 completion or legacy handoff; state/counters on Mesocycle | Planning owns endpoint, cause, Completed/Concluded Early, prior state and open-at-closure context |
| Historical corrections | Main log updates are limited to editable status; destructive workout deletion has lifecycle reconciliation. E12/E13/E22 | Explicit correction preserves original/effective evidence and never implicitly changes resolution |
| Progression advice | E26–27 plus apply-loads/guidance/receipt snapshots | Recommendations owns policy/presentation/decision; target edits go to Planning or Execution; current advice has no general acceptance/disposition history |
| Measurement | Catalog for new work; nullable frozen tuple and zero capability on WorkoutExercise. E23 | Meaning belongs to every assertion, with units, equipment and rep basis. Some historical meaning remains inferred or unavailable |
| Exercise history | Derived from performed WorkoutExercise/SetLog and metadata; PRs use another query policy. E24–25 | Derived corrected, question-qualified evidence. No independent history authority required, but consumers disagree today |
| Constraints/preferences | Mutable profile/goal/constraint/injury/preferences rows and draft settings | Goals & Constraints owns explicit scope, history and exceptions; all prescribing boundaries consume the same applicability rule |

Current defenses establish selected-field authority, not one authority per future fact. In particular, saved targets, original generation evidence, receipt slot identity, mesocycle snapshots and selected-plan context each answer part of “what workout is this?” Lifecycle-dependent access fences then change whether that same execution can be edited.

## 5. Identity and lineage findings

1. **Plan IDs are stable, but occurrence identity is derived.** E07's V4RequiredSlot contains week, phase, slotId and sequence position, validated against the accepted revision. It enumerates a supported 5-week × 4-slot topology. A week+slot obligation is not an independently owned occurrence that can move stages, be repeated, or survive a radical explicit edit without reconstruction. I03–06/I22 require those operations to define continuity.
2. **V4 placement identity is a useful advance, not a complete lineage model.** E04 accepts distinct placementIds, and E17 validates generated-to-row mappings including duplicate same-exercise positions. It rejects malformed explicit maps and many-to-one assignments rather than guessing. However, it also allows `legacy_unique` matching when an exercise ID is unique on both sides. That fallback is migration evidence at most; it must never establish 2.0 continuity.
3. **Ordinary planned rewrites replace identities.** E10 `rewriteWorkoutExercises` deletes existing sets/positions and recreates them with new UUIDs. E11 limits this to PLANNED, protecting logged execution from that operation. Nevertheless, changing pending contents is not a reason to replace continuing position identity. The generic save supplies an entire reconstructed structure instead of explicit continue/remove/add operations.
4. **Copy does not explicitly author independent counterparts.** E04 `copyAcceptedHypertrophySeedV4ToDraft` copies `slotId` and `placementId` strings unchanged. A new macro/draft supplies a different namespace, so this alone is not evidence of cross-plan DB collisions. It does show that copying is not explicitly creating occurrence/position/counterpart relationships with operation provenance as required by I05–06.
5. **Repeated exercise handling differs by subsystem.** Correlation supports duplicates; accepted-measurement persistence builds a Map by exerciseId and rejects differing meanings for that exercise; swap eligibility blocks a replacement already elsewhere in the workout. E10/E14/E17. Two same-exercise positions with different meanings/roles cannot be safely modeled by these global exercise-level shortcuts.
6. **Substitution identity is row mutation.** E14 keeps the unlogged WorkoutExercise row but changes its exercise/targets and records a from/to operation. It rejects partially/fully logged sources and already-swapped sources in inspected tests. 2.0 requires repeated explicit substitutions of remaining target work, while earlier sets retain their actual exercise. A new remaining-work relationship is required; overwriting the whole position or blocking the task is insufficient.
7. **Runtime additions have actual row IDs and conservative provenance.** E16 explicitly sets continuity/progression aliases to none and future generation/seed carry-forward to ignore. Extract that non-inference principle. These additions must remain evidence and may qualify for future advice only through explicit group eligibility; they need not become planned counterparts.
8. **Historical exposure identity can still be reconstructed.** E27 `toBoundProgressionExposure` falls back to `history:${date ?? index}`. This is an evaluation label, not reliable import or continuity identity. E24 returns workout-based exposures from position rows; repeated positions are not explicit progression-group relationships.

Names/aliases identify catalog search/display in useful places, but legacy name-keyed ExerciseExposure remains physically represented and ignored in Prisma. Sequence indexes arrange work; UUIDs identify persisted rows; template IDs identify sources; neither dates nor those reusable sources establish 2.0 lineage. Preserve stable source row IDs for import, and label reconstructed associations as uncertain.

## 6. Intent → execution → evidence findings

### Traced normal authored V4 session

This trace follows actual source paths, not a newly executed scenario.

| Step | Current code and stored/derived meaning | 2.0 consequence |
| --- | --- | --- |
| Author plan | E03 `saveHypertrophyPlanDraft` CAS-updates payload/revision. E04 stores weekly prescriptions by placement | Valuable authored intent exists before generation |
| Make ready | E03 `makeHypertrophyPlanReady` checks draft/health/topology, creates mesocycle and accepted seed revision, deletes draft | Accepted executable seed preserves intent, but draft→seed is not the future Plan's amendment lifecycle |
| Select/start plan | E05 swaps selected macro pointer with expected previous pointer and readiness checks | This is selection among ready legacy plans, not explicit conclusion of an old current Plan followed by activation |
| Locate future work | E07–08 derive next unresolved required week+slot, or a persisted incomplete workout | Future occurrence prescription is a projection of accepted weekly seed, not an occurrence-owned record |
| Preview/generate | E06 validates V4 scheduled capability and composes from accepted authority; load history feeds runtime load application | This is real protection against arbitrary legacy reselection on the V4 path. Still, preview/generation and execution start are distinct meanings without the required universal start action |
| Persist plan for logging | E09–10 create PLANNED Workout with target sets, seed provenance, generated/persisted audit correlation and frozen measurement | This is the nearest persisted prescription snapshot. It occurs at save, not at a strongly checked online start with durable device capture |
| Begin execution | E12 can change PLANNED→IN_PROGRESS on first log | No source-owner start capture or account-wide open-execution claim is present in this path |
| Adjust today | E14–16 mutate rows/targets and append session-only operations; short-today E32 reduces a generated offered structure before save | Useful baseline/adjustment evidence exists in pockets; there is no complete common start/adjustment/target model |
| Log sets | E12 validates and upserts SetLog against target ID, with actual reps/load/RPE and skip flag | Explicit logging is separate from target prefill, which is valuable. Original entered precision, performed time, and correction versions are not fully preserved |
| Finish | E09/E18 return PARTIAL when targets are unresolved, COMPLETED otherwise; E19 resolves only COMPLETED/SKIPPED | A user finishing 8 of 12 leaves a schedule-unresolved PARTIAL workout. This directly conflicts with I12 |
| History/review | E24 derives exposure from current position/sets/logs; E29 retains a versioned historical interpretation snapshot | Saved generated evidence helps reconstruct context, but a review snapshot is not a universal start prescription or effective corrected evidence |
| Next advice | E26–27 consume history/confidence/eligibility through load prescription and generation/guidance | Existing policy does not enforce the finalized complete-group, two-exposure, 28-day, disruption-aware foundation policy |

### The five required layers

| Meaning | Current location | Collapse / missing distinction |
| --- | --- | --- |
| 1. Authored plan intent | Draft JSON, then accepted seed payload | Good source artifact; incomplete original-versus-amended Plan semantics |
| 2. Future occurrence prescription | Accepted slot's weekly prescription projected using week/slot/phase | Occurrence not independently identified/owned; arbitrary future scope cannot be addressed safely |
| 3. Start-time prescription | Closest equivalent: saved WorkoutSet rows plus generated audit metadata | No explicit immutable capture at start; planned rewrite regenerates rows; capture/guidance/device readiness not one acceptance |
| 4. Today-only adjusted prescription | Current mutable WorkoutSet/WorkoutExercise plus runtimeEditReconciliation and short-today facts | Adjustment explanations vary by operation; remove records counts but not a full universal prior target capture; equality inputs omit measurement |
| 5. Performed evidence | SetLog actual fields and classification, attached to current target/position | Updates overwrite earlier assertion and timestamp; deletes erase it; actual meaning is inherited from position rather than independently preserved per assertion |

**Concrete denominator problem:** E18 counts the current stored sets. Removing an unlogged exercise removes its sets from that denominator; runtime metadata records the removal, but there is no general start-target owner guaranteeing the original and adjusted denominator for every history consumer. E29 may preserve a historical interpretation at finalization, but that does not replace the missing captured targets or correction semantics. This differs from claiming that future seed edits currently overwrite every open workout: the immutable seed and frozen saved fields do prevent some drift.

## 7. Lifecycle and sequencing findings

| Behavior | Current implementation | Future-state comparison |
| --- | --- | --- |
| Default next | Incomplete status priority and seed/rotation-derived context; V4 exact unresolved slots. E08 | Extract earliest-unresolved and ambiguity rejection concepts; replace identity/source and ensure Resume across concluded source plans |
| Later workout | V4 selection supports off-order obligation by intent within authored week; tests verify it | General later pending occurrence across approved sequence is broader; earlier pending must remain pending, without regeneration |
| Stage advancement | Legacy counters and slot history; V4 fixed weekly topology and resolution | Assigned occurrence stage must survive scheduling changes. Existing V4 weekly intent is useful; counters are not the future authority |
| Skip | V4 explicit scheduled claim resolves without performed counter increment. Save rejects skip after actual work. E18–19 | Valuable behavioral pieces. Skip must target a pre-existing occurrence and be correctable, not require a generated Workout as its identity |
| Final skip | V4 resolver returns no next slot and terminal flow can complete finite V4 | Already implemented for supported V4, not universally broken. Retain scenario, rewrite ownership and generality |
| Partial | PARTIAL is performed and editable, but not scheduleResolved; finish metrics choose it when work is unknown | Foundational conflict: finish must resolve while completeness remains partial |
| Closure | Finite V4 completes under terminal locks; older plans enter AWAITING_HANDOFF and seed draft preparation | Retire successor-generation gate as closure authority. All retained occurrences resolve under explicit Plan rules |
| End early | E20 blocks partial/performed incomplete workouts and marks eligible incomplete rows SKIPPED before close/handoff | Must preserve open execution and mark pending work not pursued, not fabricate individual skip decisions |
| Plan states | DRAFT/READY/PREPARING/HANDOFF_PENDING/COMPLETED/INVALID are projected separately from selected pointer. E02 | Replace with Draft/Active/Paused/Completed/Concluded Early and explicit causal transitions |
| Pause/disruption | No Plan pause state/action found; short-today and readiness exist | Pause must preserve sequence/stage; shift dates, explicit skip scope, and re-entry guidance need independent operations |
| Successor activation | E05 checks any IN_PROGRESS workout and swaps selected plan; no explicit early conclusion of previous Plan | 2.0 permits activating after old closure even with old execution open, but blocks new execution start. Current fence is at the wrong boundary |
| Corrections | Terminal immutability and deletion/reconciliation instead of Undo Finish/Undo Skip | Requires dedicated atomic resolution correction, distinct from evidence correction |
| Standalone | Non-scheduled/body-part/manual/bonus materialization exists; save commonly requires receipt/cycle context and resolves mesocycle | Useful session UI, but no clean account-wide standalone execution lifecycle independent of plan advancement |

Legacy-only lifecycle systems include rotation advancement as scheduling authority, optional deficit closeout gating deload, handoff seed preparation/refresh, successor acceptance, and repair of state from generated/performed workouts. Retire these runtime responsibilities. User-requested copy/recommended next plan remains a product capability owned by new draft authoring.

## 8. Mutation-authority findings

### Major mutation surfaces

| Path / owner | Current mutation | Boundary finding |
| --- | --- | --- |
| `api/plans` and draft/copy/regenerate/finalize/activate/archive routes; E02–05 | Macro/draft/accepted seed creation, readiness and selected pointer | Draft CAS and review scope are useful; active future occurrence edits, closure and restriction exceptions are absent |
| `api/periodization/macro`, mesocycle draft/accept-next-cycle/refresh-next-seed-draft/finish-deload; E20 and handoff owners | Generate/change cycle intent, accept successor, finish phase | Retire as future runtime authority; preserve source history and useful draft suggestion calculations |
| `api/workouts/generate-from-intent`, `generate-from-template`; E06 | Produce selection, prescriptions and decision evidence; some setup paths have broader orchestration dependencies | Treat generation as proposed reusable intent/guidance only in 2.0; never source identity or automatic future-work author |
| `api/workouts/save`; E09–11 | Structure rewrite, scheduling fields, status, selection metadata, snapshots, counters/closure/review | Generic semantic mutation hub. Split by domain actions rather than enlarging its guards |
| `api/logs/set`; E12–13 | Set upsert/delete, warmup target creation, first-log status | Revision guard is good; lacks durable action identity, assertion versions and dependency-aware finish |
| Workout add-exercise/add-set/exercise DELETE/swap routes; E14–16 | Current rows, target sets, measurement and runtime operation metadata | Partial protection against log loss; cannot express substitute remaining work after performance or whole today+future edit |
| `api/workouts/delete`; E22 | Deletes actual logs, targets, positions and workout; reconciles mesocycle | Not a historical correction model. DB/history guards may reject particular records, but eligible deletion destroys provenance |
| Workout dismiss-closeout and week-close closeout/dismiss; E21 | Workflow state, optional workout linkage, metadata | Presentation decision and training workflow remain coupled; races have guards, but future dismissal cannot control closure/training availability |
| Profile/preferences/exercise favorite/avoid; E01/E33 | Mutable user settings/arrays and profile setup | No shared versioned scoped restriction/exception owner across acceptance boundaries |
| Readiness submit, readiness prepare/review snapshot owners; E29 | Subjective/derived signals and persisted read artifacts | Separate historical advice/presentation facts from recomputable interpretations; do not let them authorize domain changes |
| Finisher routes/service; E01 | Versioned offers/decisions, command hash/revision, timers and evidence | Extract retry/conflict techniques; adapt optional-work semantics and account linkage |
| Prisma repair/backfill scripts; E34–35 | Potential seed, receipt, lifecycle and history mutations | Operational source-repair tools, not normal corrections; never execute as a gap-analysis side effect |

### Known risk areas: current fix versus remaining architectural gap

- **Ordinary saves and decision fields:** E09 shallow-merges incoming metadata, normalizes receipt context, attaches saved audit evidence, and persists selectionMode/intent/forcedSplit/template/scheduling fields. It explicitly fences materialization changes, seed provenance, V4 scheduled receipt changes and stimulus preservation. These protections must be credited. They do not make this a narrow note/status action: multiple semantic owners still share one accepted payload. This report does not claim every client-supplied receipt field can currently bypass those guards.
- **Generation/receipt evidence mutation:** Runtime operations and saved snapshots live alongside generation evidence in mutable selectionMetadata. The code deliberately appends reconciliation facts and refreshes saved evidence; immutable seed identity exists separately. 2.0 needs retained starting meaning and past advice, plus current adjustments—not a general normalization pass over all meanings.
- **Closeout dismissal conflict:** Existing integration tests reject completion after a linked closeout is no longer pending and exercise concurrent terminal locks. Keep that race evidence. Retire the semantic requirement that optional gap-fill/review resolution gates main training.
- **Malformed metadata as absence:** E17 distinguishes absent from invalid explicit correlation; E09 detects invalid materialization and requires receipt cycleContext. E07 has an explicit `blocked` outcome for bad V4 authority. Other compatibility readers still return undefined/null, and E07's initial non-V4 discrimination is only one layer. Do not call all malformed paths safe or all exploitable; remove permissive fallback from new authority and preserve invalid source data at import.
- **Substitution/duplicate lineage:** No-logs conditional update in E14 avoids relabeling existing logged sets. That is a meaningful fix, but blocking substitution after two sets does not satisfy the required remaining-work operation. E17's duplicate handling cannot fix exerciseId-keyed measurement or swap eligibility elsewhere.
- **Measurement omitted from equality:** E10 `buildPersistedExercisesForSave` and E32 `PersistedWorkoutStructureExerciseInput` omit measurement; E32 `fingerprintSessionCapacityWorkout` hashes exercise/role/targets but not measurement or placement identity. Thus equal numeric structure is not proof of equal prescription meaning. Separate V3/V4 measurement checks prevent some acceptance drift; they do not repair every downstream comparison or establish meaningful equipment identity.

## 9. Exercise and measurement findings

The catalog's stable IDs, aliases, muscle mappings, movement patterns and equipment categories are valuable data. The existing Exercise model also requires scores/eligibility attributes that a minimal custom logging exercise should not need. Inspected exercise collection/detail/search routes expose reads and preference operations; no ordinary custom-exercise authoring owner was found. A repository/API search is not proof of what external admin tooling or production data may contain.

| Dimension | Current evidence | Gap / disposition |
| --- | --- | --- |
| Exercise identity | UUID + unique name, aliases and variations. E01 | EXTRACT IDs/source mappings and descriptive data; names must not merge historical meaning |
| Frozen meaning | WorkoutExercise measurementProfile/loadConvention/repBasis/zeroLoadMeaning; strict tuple parser. E10/E23 | EXTRACT validation and capture discipline; REWRITE complete assertion semantics |
| Units | Float targetLoad/actualLoad without original-unit field; many paths use pounds | Original entered units not independently recoverable from numeric values alone |
| Per-hand/combined | IMPLEMENT_WEIGHT, BARBELL_TOTAL and display inference for legacy dumbbells | Partial capability. Do not infer original convention from current equipment/name; no general historical combined/per-hand representation |
| Machine/setup | MACHINE_DISPLAYED and generic Equipment category/name | No per-assertion machine/setup identity or available-value inventory in main evidence model |
| Assistance | REPS_ASSISTED / DISPLAYED_ASSISTANCE represented | E27 conservatively blocks unsupported prescription comparisons; foundation assistance decrease/zero transition still required |
| Bodyweight | Separate bodyweight and added-load profiles; bodyweight logs reject inappropriate load | Useful. No silently assumed total-system load or missing bodyweight reconstruction allowed |
| Zero | Explicit zero capability, null checks and tests; legacy log route can supply zero when targetLoad is zero | EXTRACT valid-zero rules. Historical legacy zero may be target-derived rather than independently entered; preserve provenance uncertainty |
| Rep basis | TOTAL/PER_SIDE | Useful subset; unknown and unsupported source meaning must remain explicit, not coerced |
| Precision | `units/load-quantization.ts` defaults to 2.5 lb; logging quantizes pound-like entries | Stored value is not necessarily original input. Do not promise recovery of rounded-away precision |
| Comparability | E23 key = exercise + profile/convention/basis, or legacy exercise ID | Missing units/equipment/question/group/version dimensions. Zero capability is outside the key |
| History safety | E24 separates tuple keys; disables classified machine record comparison and bodyweight/assistance load comparisons | Credit abstention. Legacy-null same-ID records still can be compared and conventions inferred from present catalog |
| PR inconsistency | E25 aggregates positive actualLoad by exerciseId, reports lbs; no WORK-only predicate or equivalent measurement grouping | Can treat prep or differing positive-load meanings as a load PR; a concrete consumer defect within a broader missing comparability owner |

E10 also strips measurement when no accepted measurement-aware revision exists, while V3/V4 capture accepted tuples. Historical quality therefore varies by path and era. New catalog classification cannot retroactively prove old measurement meaning. Suitability ranking can be extracted from substitution code, but must never authorize numeric load transfer.

## 10. Progression findings

| Current system | Product value and ownership assessment | Disposition |
| --- | --- | --- |
| Load anchoring/calibration (`engine/apply-loads.ts`, `load-calibration.ts`, E27) | Useful hold/calibrate/explain capabilities; bound to history adapters, seed prescriptions and confidence tiers | EXTRACT explicit-value validation, explanation and abstention pieces; replace orchestration |
| Double/linear/periodized progression (E26) | Required advice capability, but existing beginner increments, advanced periodization, regression reduction and overshoot/catch-up are not B§21 defaults | REWRITE policy; do not preserve numerical behavior by name |
| Canonical input binding (E27) | Better evidence IDs/confidence/comparability structure, but default comparable/eligible and synthetic exposure IDs remain | EXTRACT explicit evidence reference concept; REWRITE eligibility owner |
| Partial exposure eligibility | Allows at least two sets and ≥2/3 coverage for multi-set exposure | REWRITE: all required sets in the selected group must qualify; a session can be partial elsewhere |
| RIR/RPE | Authored target effort and actualRpe exist; legacy fallback accepts missing RPE in some triggers | EXTRACT representation/conversion helpers only when meanings are explicit; prescribed effort never substitutes for actual effort |
| Weekly progression (`engine/planning/v2/weekly-progression.ts`) | Generates intended demand changes | EXTRACT optional draft authoring assistance; no automatic mutation of pending approved intent |
| Volume landmarks/ramps (`engine/volume-landmarks.ts`, `volume-targets.ts`, Muscle fields) | Legacy programming assumptions can support explicitly labeled research/reference context | RETIRE as personalized capacity/target authority; EXTRACT arithmetic and transparent workload summaries |
| Deload (`planning/v2/deload-transform.ts`, periodization, E20/E26) | Authored deload stage and suppressing escalation are useful; inferred auto-deload/phase advancement differs | EXTRACT draft transform and stage context; RETIRE autonomous deload lifecycle |
| Forecasting/projected week (E28) | Useful proposed-intent comparison/duration/volume readout | EXTRACT deterministic summaries; RETIRE repeated runtime generation as future truth |
| Readiness/autoregulation (`engine/readiness/autoregulate.ts`, E29) | Explicit fatigue/disruption context can support advice | REWRITE into optional explained guidance; scores cannot silently prescribe or infer restrictions |
| Exposure history (`api/exercise-rotation-history.ts`, E24/E27) | Actual exercise evidence is useful; stale name-based projection already retired from runtime | EXTRACT evidence queries; RETIRE rotation freshness as sequence/identity authority |
| Runtime-added exercise guidance (`api/runtime-added-exercise-preview.ts`, E16/E27) | Session-local defaults/calibration useful, no implied future lineage | EXTRACT calibration mechanics; qualify future advice only with captured explicit target groups |
| Recommendation records | Receipts/readiness/review capture parts of reasoning; no general presented/accepted/overridden/dismissed owner | REWRITE with retained policy/input/decision meaning and current applicability |

Specific policy incompatibilities include E26's single-session confidence-scaled increase, overshoot/catch-up lanes, `computeDoubleProgressionLoad` allowing undefined RPE, and E27's partial adequacy threshold. These are code capabilities and tested legacy behavior; not every branch is asserted to run for every V4 exercise. They cannot be imported as the foundation policy.

B§21 requires two qualifying same-load exposures within 28 days for double progression; latest qualifying exposure for rep progression; all required group sets and any prescribed RIR; actual supported adjacent equipment step; decreasing assistance; no transfer across changed structure/role/meaning; and intervening/current disruption checked before filtering qualifiers. No inspected end-to-end owner implements that complete contract. No progression method should own future plan changes or performed evidence.

## 11. Analytics / derived-state findings

| Calculation/read model | Current state kind | Required treatment |
| --- | --- | --- |
| Exercise/session history (E24; `api/history-page.ts`) | Derived | Rebuild on corrected assertions and preserved training date; do not use current catalog inference to certify comparison |
| Working/muscle volume (E28; `session-semantics/set-classification.ts`) | Derived; stimulus snapshots preserve historical accounting basis | EXTRACT arithmetic/classification intent; distinguish optional/preparation and declared weighted versus direct counting |
| Adherence/completeness (E18; program/review) | Derived coverage also drives status acceptance | REWRITE: finish independent of completeness; original/adjusted/removed/unknown/skipped denominators distinct |
| PRs (E25) | Derived, recomputed | REWRITE common comparability/evidence qualification; don't retain old aggregate results as authority |
| Progression readiness (E26–29) | Derived, sometimes cached in readiness/receipts | Current applicability must be revalidated; preserve historical advice separately |
| Next workout (E08) | Derived; used to authorize generation/claim context | Projection may suggest; accepted start validates owned occurrence/open state |
| Forecasting (E28) | Derived from simulation/composition plus performed work | Future intent must be inspectable without re-executing generation; simulation is only proposed/estimated output |
| Plan Health (`engine/hypertrophy-plan-health.ts`, E03) | Derived, participates in readiness confirmation | EXTRACT tiered review and exact-scope invalidation; replace legacy topology/coverage assumptions and avoid universal quality score |
| Volume landmarks | Stored heuristic parameters consumed by derived selection/programming | RETIRE as personal source truth; preserve only labeled context if a required recommendation uses it |
| ReadinessSignal (E01) | Mixed: reported observations plus computed fatigue/performance fields | Separate explicit observations from derived interpretations; preserve both as sourced history where available |
| Pre-session readiness (E29) | Cached derived state with identity/freshness metadata | Useful freshness technique; not start reservation or current recommendation acceptance |
| Post-session snapshot (E29) | Preserved historical interpretation, not merely disposable cache | Preserve as source explanation; provide corrected current review separately. Do not overwrite prior advice or freeze current analytical truth |
| Week close deficit (E21) | Derived deficit persisted as workflow snapshot; can create optional Workout | Derived→mutation promotion. RETIRE deficit workflow authority, EXTRACT transparent volume readout |
| Lifecycle reconciliation (E22) | Derived reconstruction writes source counters/state | Repair, deletion and normal correction must not become competing plan authors |

Two important promotions are concrete: E21 uses deficit evaluation to persist week-close state/optional work; E22 recomputes lifecycle after deletion. E09 also makes post-session interpretation snapshot creation part of terminal save success—tests assert rollback if finalization fails. Historical advice capture may be important, but a general optional review calculation should not become a new administrative finish gate.

## 12. Persistence semantic findings

No replacement tables or schema are proposed here.

- **Mixed ownership:** Workout combines future scheduling, mutable prescribed structure, execution status, generator classification, seed provenance and lifecycle snapshots. WorkoutSet is both prescribed target and unique address for its one current SetLog. MacroCycle/Mesocycle combine visible Plan and legacy phases/counters. ReadinessSignal combines observation and interpretation.
- **Duplicated representations:** selected macro pointer versus child isActive/state; accepted seed versus compatibility slotPlanSeedJson; slotSequenceJson versus seed slots; generated structure versus saved rows; cycle snapshots versus receipt context; completedSessions versus phase counters. Some are explicitly compatibility/projection rather than equal authority—the immutable revision is the current accepted truth when present—but consumers still need elaborate reconciliation.
- **Important JSON authority:** draft payload, seedPayload, selectionMetadata/receipt/materialization/correlations/runtime operations, volume/RIR configuration, week-close deficit, handoff/next seed, readiness and review payloads. JSON itself is not the defect. Missing or overlapping owners and permissive reconstruction are.
- **Nullable meaning:** measurement all-null has a legacy meaning; partial tuples fail strict parsing. Null seed/hash/receipt provenance can mean old data, unsupported path or missing evidence. These must not become proof of a valid unplanned session or comparable exposure. Nullable actual values do not establish performed work.
- **Indirect state:** plan status derived from mesocycles and draft existence; occurrence resolution from generated claim status; stage from counters/slot evidence; open execution from WorkoutStatus rather than a strongly accepted start relationship.
- **Composite matching:** week+slot+revision claim, generated placement→row sidecar, WorkoutSet→single SetLog, mesocycle/exercise/intent role uniqueness. These constrain duplicate positions, correction versions and explicit operation continuity.
- **Missing source facts:** no original unit on SetLog, no durable action/version conflict history for normal logs, no preserved execution training timezone/precision, no general start/adjusted target separation, no explicit skip versus abandoned/removed occurrence facts.
- **Migration burden:** E35 imports eligible legacy seeds as `legacy_unknown` without invented hashes and installs an immutable-row trigger. Measurement migration adds nullable fields with tuple constraints. These are good examples of honest partial provenance. They do not prove legacy per-record meaning, nor migration application in production.
- **Legacy physical data:** ignored LegacyExerciseExposure retains old name-based aggregates; source migrations/repairs and old receipt versions remain relevant to historical interpretation. Retiring their runtime does not authorize deleting original exports or history.
- **Database protections beyond Prisma:** SQL triggers/checks can impose constraints not visible as Prisma fields. Future migration assessment must preserve source constraints and enumerate installed migrations before any cutover. This report inspected source SQL, not deployed database state.

## 13. Test-suite findings

The five test categories below are the task's test-specific categories; component dispositions remain the five uppercase classifications. Test count and naming are not preservation arguments.

| Inspected suite / assertion | Test category | Future value / change |
| --- | --- | --- |
| [placement-correlation.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/session-semantics/placement-correlation.test.ts): duplicate exercise reorder, malformed explicit map, many-to-one rejection | behavioral contract worth retaining | Keep explicit identity/ambiguity cases; legacy-unique fallback assertion belongs only to import interpretation |
| [v4-scheduled-slot-resolution.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/v4-scheduled-slot-resolution.test.ts): skipped nonfinal/final slot, duplicate claims, unknown status, off-order slot, concurrent complete/skip | behavioral contract worth retaining | Port scenarios to occurrence identities/general stages; retire 20-obligation topology oracle |
| [finite-v4-plan-completion.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/finite-v4-plan-completion.test.ts): terminal lock scope, rollback, no malformed V4 fallback | migration/integrity infrastructure worth retaining | Preserve atomicity/fail-closed lessons; terminal proof tied to seed topology is legacy architecture |
| [save route integration tests](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/app/api/workouts/save/route.integration.test.ts): revision conflicts, foreign ownership, no skip after logs, exact receipt protection | behavioral contract worth retaining | Retain authority/race scenarios under new commands; do not preserve generic save payload |
| Same save suite: PARTIAL does not advance, no active mesocycle rejects performed save, closed mesocycle blocks save | obsolete behavior test | Replace with partial resolution, standalone, and open execution surviving plan closure |
| Same save suite: snapshot failure rolls back finish; gap-fill classification and lifecycle effects | legacy architecture test | Extract necessary atomicity technique; retire optional review/gap-fill gating |
| [runtime-exercise-swap-service.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/runtime-exercise-swap-service.test.ts): logs arriving after preview reject row replacement | behavioral contract worth retaining | Preserve no relabeling of performed sets; add remaining-target substitution |
| Same swap suite: block partially logged/already swapped source and duplicate replacement elsewhere | obsolete behavior test | Cannot define 2.0 duplicate-position or repeated remaining-work substitution behavior |
| [persistence.measurement.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/save-workout/persistence.measurement.test.ts): exact capture, invalid zero tuple, null calibrated target | behavioral contract worth retaining | Port assertion-level meaning protection; legacy stripping test becomes source compatibility only |
| [semantics.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/exercise-measurement/semantics.test.ts), [setValidity.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/logging/setValidity.test.ts) | useful algorithm test worth extracting | Zero/null, profile validity, no invented actual load; expand for units/equipment/context |
| [progression.correctness.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/engine/progression.correctness.test.ts): one-session scaling, overshoot, catch-up, auto-deload | obsolete behavior test | Replace numerical expectations with B§21; preserve only measurement/no-fabrication boundary cases |
| [load-prescription.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/engine/load-prescription.test.ts) and scenario fixtures | useful algorithm test worth extracting | Calibration/unknown/unsupported context cases; legacy bridge policy is not retained by default |
| [exercise-history.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/exercise-history.test.ts), [pr-tracker.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/pr-tracker.test.ts) | behavioral contract worth retaining | Keep raw-versus-estimated/performed evidence scenarios; rewrite legacy comparison assumptions and add correction invalidation |
| [hypertrophy-plan-health.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/engine/hypertrophy-plan-health.test.ts) | useful algorithm test worth extracting | Non-mutating, neutral approximate volume and review severity distinctions; reclassify current issue codes for future validity |
| [active-plan-context.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/active-plan-context.test.ts), [hypertrophy-plan-drafts.test.ts](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/lib/api/hypertrophy-plan-drafts.test.ts) | migration/integrity infrastructure worth retaining | CAS/review-version conflict cases; replace selected-plan switching semantics with explicit lifecycle |
| [useSetDraft.test.tsx](C:/Users/aabloch/claude/vibe-coding/Trainer/trainer-app/src/components/log-workout/useSetDraft.test.tsx) / logger tests | useful algorithm test worth extracting | Input restoration mechanics only; 24-hour expiry cannot be a durable acknowledged-evidence oracle |
| V2 materialization/acceptance, handoff, seed replay and fixture tests | legacy architecture test | Retain for source compatibility until retirement; extract pure useful draft calculations rather than preserving runtime fixture parity |
| E34 migration/readiness integrity, environment classification, exact-tree verification and disposable-DB suites | migration/integrity infrastructure worth retaining | Keep credential isolation, exact-evidence qualification and DB-level checks; replace domain-specific fixtures |

Missing future acceptance coverage is not just a larger unit-test list: online start races with skip/remove/pause/end; one Open across standalone/planned; dependency-aware provisional finish; stale set correction reconciliation; today+future all-or-none; post-log substitution; paused final completion and undo; concluded-plan open-session resume; source-revision import retry/late writes; no inferred lineage; units/equipment-aware evidence qualification. A§17 supplies the target behavioral oracles. DB suites were not run and their present environment qualification was not independently certified.

## 14. Historical-data preservation findings

These ratings concern semantic recoverability from the inspected representations. They do not certify production rows. “Trustworthy” means valuable explicit source fact if the stored row passes integrity checks; it does not imply physiological accuracy or eligibility for automation.

| Data category | Historical semantics | Preservation treatment |
| --- | --- | --- |
| Workout/position/set/log IDs | trustworthy as source identifiers for extant rows | Preserve with source account/revision/export mapping; do not convert derived week/index into missing identity |
| Current recorded reps/load/RPE | partially trustworthy | Preserve stored actual values. Separate skipped/empty/warmup. Quantization and edits limit original-entry claims |
| Original value before overwrite or deleted log | unrecoverable from current rows alone | Do not invent; backups/exports may improve coverage only after inspection |
| Dates | partially trustworthy | scheduledDate is used for history; SetLog completedAt changes on edit. Preserve fields and precision; do not assert actual performed instant/timezone from them |
| Units/convention | partially trustworthy where frozen tuple/context is explicit; ambiguous otherwise | Preserve known semantics and source UI convention evidence separately; no default lb/per-hand inference solely to enable comparisons |
| Machine/assistance/setup identity | ambiguous where not recorded | Keep textual context if present; block affected numerical transfer. Generic machine category is not a setup identity |
| Zero load | partially trustworthy | Explicit classified zero can be meaningful; legacy route may infer it from target. Unknown is not zero |
| Accepted plans/prescriptions | trustworthy as retained accepted source payload when exact/hash-validated; partially trustworthy as actual start prescription | Preserve seed revision/hash and draft/source context. Do not recreate live obligations or claim every stored target was the one shown at start |
| Changed/removed prescription history | partially trustworthy; some prior details unrecoverable | Keep generated snapshots/runtime operation facts and label omissions. Counts/from-to names are not full old targets |
| Actual effort | partially trustworthy when actualRpe explicitly present | Preserve as recorded RPE. A display conversion is not an originally recorded RIR assertion; missing effort stays missing |
| Notes/check-ins | trustworthy as recorded text/observations | Preserve without interpreting as diagnosis, restriction, performance or action |
| Substitutions/runtime additions | partially trustworthy | Preserve row IDs and from/to runtime operations; no inferred future counterpart or automatic comparability |
| Plan/slot relationships | partially trustworthy, strongest with exact accepted provenance and valid receipt | Retain as historical source context. Quarantine conflicting/legacy-derived associations |
| Skips/completion | partially trustworthy | Preserve source status and known action. PARTIAL is not future Finished; early-finish-created SKIPPED may mean abandoned work, so retain cause where known |
| Corrections | ambiguous; original versions often unrecoverable | Latest row is source effective value, not correction history. Response `previousLog` is not persisted correction provenance |
| Review/readiness snapshots | trustworthy as sourced interpretation when integrity-valid; not proof of delivery or underlying completeness | Preserve provenance/version/basis; distinguish exact from legacy_derived/unknown |
| Old exposure aggregates/counters | ambiguous as primary evidence; derived | Export for reconciliation if useful; rebuild qualified views from actual rows, never fabricate sets |
| Device-local drafts | ambiguous input, not confirmed performance | Inventory/reconcile/export known devices before cutover; don't import a prefill as a performed set |

Historical preservation has higher priority than reproducing current analytics. A record may be accepted as honest history while remaining ineligible for progression. Existing in-flight plans become reference material; continuing them requires a reviewed new 2.0 draft with new obligations, not attaching old logs to newly inferred occurrences. B§33/A§16 already decide this.

## 15. Component disposition matrix

Classification applies to the named component at the stated granularity. An EXTRACT row inside a retired subsystem is intentional: preserve the useful piece, not its owner or behavior wholesale.

| Component | Current role | Trainer App 2.0 role | Classification | Why | Dependencies / extraction concerns |
| --- | --- | --- | --- | --- | --- |
| Next.js application/build foundation (E34) | App hosting/build/runtime | Delivery infrastructure | RETAIN | No demonstrated conflict with domain contract | Does not endorse current routes, auth assumptions or component flows |
| Maintenance write gate (E36) | Reject scoped writes before mutation | Operational cutover protection | RETAIN | Narrow operational responsibility | Expand operation inventory when new owners exist; gate alone is not migration coverage |
| Credential-isolation/exact-tree verification framework (E34) | Safe reproducible verification | Verification infrastructure | RETAIN | Domain-independent integrity value | Replace legacy assertions, retain safety/classification machinery |
| Catalog IDs, aliases, descriptive muscle/movement data | Search and selection source | Catalog/source-history foundation | EXTRACT | Useful stable source data inside programming-heavy model | Preserve mappings; review scoring/contraindication claims; no automatic merge |
| Catalog/custom exercise ownership | Global rich Exercise entity | Minimal correct custom logging + prospective definitions | REWRITE | Missing user authoring and complete historical meaning | Retained catalog data does not satisfy custom exercise behavior |
| Frozen tuple/zero validation (E23) | Measurement validity | Part of full Measurement owner | EXTRACT | Correct null/zero and prospective capture ideas | Add units/setup/history meaning; remove legacy-null equivalence |
| Load quantization arithmetic | Round to configured scalar step | Small equipment-aware calculation | EXTRACT | Arithmetic useful | Never quantize away original entered evidence or fabricate available steps |
| Macro/Mesocycle Plan ownership (E01–05) | Selected generated/authored cycle hierarchy | Finite Plan owner | REWRITE | Lifecycle and occurrence authority incompatible | Preserve source provenance, not old runtime hierarchy |
| Draft authoring validation/preview (E03–04) | Versioned weekly authoring and review | Manual/recommended/copy editor inputs | EXTRACT | Human-authored intent and scoped review valuable | Remove fixed 5×4 topology and seed compilation as acceptance truth |
| Plan lifecycle/activation (E02/E05/E20) | Ready selection, phase/handoff | Current-plan exclusivity and explicit transitions | REWRITE | Wrong states and open-work fence | CAS technique reusable; old semantic switch not retained |
| Template content/ordered-list mechanics (E31) | Reusable exercise list | Independent copyable intent | EXTRACT | Useful reuse UX/data | Needs complete prescriptions, new identities and counterpart copy rules |
| Workout/exercise/set persistence (E09–13) | Combined prescription/execution graph | Execution & Evidence with explicit source/capture | REWRITE | Cannot add corrections/start capture safely by normalization alone | Import current rows as evidence; no live dual owner |
| Main logger visual input/rest mechanics | Fast logging/editor UI | Logging presentation | EXTRACT | Useful interaction pieces | Rebind to durable actions, captured meaning and truthful finish |
| Local draft persistence (E30) | Expiring field recovery | Durable continuation and conflict recovery | REWRITE | Drafts are not acknowledged offline actions | Account isolation, retry identity and finish dependencies required |
| Revision/CAS transaction pattern (E05/E13) | Reject stale mutation | Acceptance integrity | EXTRACT | Valuable concurrency primitive | Add stable outcomes, independent changes and explicit conflicts; do not retain whole-workout last-version semantics by default |
| Placement correlation validator (E17) | Generation-to-row identity bridge | Legacy import validation / explicit relationship checks | EXTRACT | Strong malformed/duplicate tests | Exclude legacy matching from new continuity |
| Runtime substitution/removal/addition (E14–16) | Unlogged-row mutations | Remaining-work adjustments and source links | REWRITE | Missing post-performance and combined-scope semantics | Extract suitability/calibration and no-log-relabeling defenses |
| Generic save metadata/receipt hub (E09) | Central mutation/reconciliation | No equivalent owner | RETIRE | Multiple facts rewritten through one payload | EXTRACT provenance readers and protected-field regression scenarios |
| Accepted seed runtime/compatibility replay | Executable generation source | Historical source artifact only | RETIRE | Future Plan owns authored occurrences | EXTRACT immutable capture/hash/provenance techniques; keep import readers as needed |
| V2 planner/materializer/acceptance runtime | Demand/selection/materialization authority | Optional draft suggestion input | RETIRE | Not future execution or identity authority | EXTRACT useful transparent draft calculations independently |
| Legacy generation/remaining-week closure/rotation | Automatically fill and advance work | No automatic future-work owner | RETIRE | Conflicts with approved intent and explicit operations | EXTRACT ordered-list, workload and suitability calculations |
| Finite V4 schedule resolution | Validate week+slot claims and final closure | General occurrence sequencing/resolution | REWRITE | Closest behavior, wrong identity/topology and partial semantics | EXTRACT no duplicate claim/final-skip/race scenarios |
| Handoff/successor/optional deficit workflow | Gate closure and generate next work | User chooses new draft/copy; optional review | RETIRE | No mandatory handoff/gap-fill gate in 2.0 | Preserve historical reviews/seed provenance; extract summary calculations |
| Historical correction/deletion/reconciliation | Upsert/delete and state repair | Provenance-preserving evidence/resolution correction | REWRITE | Deletion/counter repair cannot represent correction meaning | Existing exports/backups may protect earlier evidence |
| Progression eligibility/policy (E26–27) | Multi-lane confidence/load algorithms | B§21 groups/policies | REWRITE | Required behavior differs materially | EXTRACT calibrated input handling; replace policy expectations |
| Recommendation history/acceptance | Receipts and readouts | Presented advice + decision authority | REWRITE | Missing complete disposition/stale acceptance model | Preserve old snapshots as source explanation |
| Volume/stimulus arithmetic | Weighted muscle totals | Declared derived workload | EXTRACT | Useful transparent calculations | Remove landmarks as inferred capacity; qualify preparation/optional/time |
| PR/history/comparability queries | Multiple derived consumers | Common qualified evidence projections | REWRITE | Inconsistent filters and incomplete measurement/context | EXTRACT query/performance techniques, not legacy equivalence |
| Plan Health presentation policy | Tiered issue presentation | Hard validity versus concern/tradeoff review | EXTRACT | Valuable separation and neutral summaries | Rewrite domain checks; no universal quality score |
| Review presentation | Large optional readouts and workflow states | Quiet completion, revisitable review | SIMPLIFY | Concept survives with smaller UI responsibility | Only presentation; source/closure/advice owners are rewritten separately |
| Favorites/preferences list UX | Favorite/avoid settings | Explicit preferences UI | SIMPLIFY | Simple preference lists remain useful | Avoid/exclusion authority moves to scoped Goals & Constraints; no heuristic override |
| Goals/constraints/injury authority | Enums, arrays, mutable injury state | Direction/milestones/priorities/restrictions/exceptions | REWRITE | Required distinctions and history missing | Preserve explicit source text/settings; never infer medical restrictions |
| Finisher timer/protocol and command techniques | Optional timed work with commands | Optional work/recovery mechanics | EXTRACT | Useful narrow mechanics/provenance | Do not adopt its entire parallel execution lifecycle or expired command policy unexamined |
| Historical snapshot/import integrity techniques | Hash/version/unknown provenance | Migration and retained explanation | EXTRACT | Explicit uncertainty and immutability valuable | New cutover/source revision mapping still required |
| Legacy repair scripts | Operational corrections to old model | Temporary source preservation tools | RETIRE | Not normal 2.0 mutation authority | Keep source/tool history and any needed read-only provenance readers |

### Adversarial disposition review

**Every RETAIN was challenged:** the framework is retained only as infrastructure, not its owner-selection/auth behavior; the write gate retains a narrow operational rejection function, not legacy lifecycle gates; verification framework retention excludes domain fixtures and unsafe command assumptions. Catalog, measurement, CAS, finisher commands and snapshots were deliberately downgraded to EXTRACT because each carries legacy semantics or incomplete contracts.

**Every SIMPLIFY was challenged:** only optional review presentation and simple preference-list UX remain SIMPLIFY. Neither is asked to evolve into a new domain authority. The tempting alternatives—simplifying MacroCycle, generic save, PARTIAL, or old progression—were rejected as more complex than replacement because they require mutually incompatible meanings to coexist.

**Every RETIRE was checked for recoverable value:** save/receipt hub → source readers and authority tests; accepted seeds → immutable source artifacts/hash techniques; V2/generation/rotation → draft calculations and descriptive catalog logic; handoff/gap-fill → historical explanation and volume math; repair scripts → original source history and integrity knowledge. Retirement applies to runtime responsibility, never automatic deletion of historical evidence. No large subsystem survives merely because its test suite is large.

## 16. Future-state gap matrix

Severity: **Critical** = foundational authority/evidence invariant absent or incompatible; **High** = required capability significantly incomplete; **Moderate** = useful foundations exist but bounded extension/extraction is needed. Severity is about fit, not implementation effort or evidence of production incidents.

| Future-state requirement | Current state | Gap severity | Existing useful pieces | Recommended disposition |
| --- | --- | --- | --- | --- |
| Plan ownership | Macro/mesocycle/seed/draft split | Critical | Authored weekly intent, immutable accepted artifacts | REWRITE |
| Planned occurrence identity | Derived week+slot+revision claims | Critical | Exact V4 duplicate-claim validation | REWRITE |
| Exercise-position identity | Placement IDs plus recreated rows/correlation | High | Explicit duplicate correlation | REWRITE |
| Future counterpart relationships | Reused slot placements; no operation-owned membership | Critical | Explicit source IDs/provenance | REWRITE |
| Start prescription capture | Saved targets/generation snapshot, implicit first log start | Critical | Frozen tuples, seed provenance | REWRITE |
| Today-only adjustment | Session-only ops, row changes, short-today | High | Conservative no-future-alias directives | REWRITE |
| Future edit scope | Draft edits, no full pending-scope acceptance owner | Critical | Draft CAS/review fingerprints | REWRITE |
| Training evidence | Explicit SetLog but target-coupled mutable assertion | Critical | Actual fields/IDs and skip separation | REWRITE |
| Historical corrections | Overwrite/delete or immutable terminal fence | Critical | Revision rejection, source exports | REWRITE |
| Resolution corrections | No dedicated undo owner; deletion reconciliation | Critical | Terminal atomicity scenarios | REWRITE |
| Sequencing | V4 earliest unresolved; legacy rotation/counters | High | Final skip, duplicate rejection | REWRITE |
| Pause | No Plan pause state/action found | High | Session-local context/rest pause is not Plan pause | REWRITE |
| Standalone workout | Non-scheduled paths tied to receipt/cycle context | High | Logger/manual exercise selection | REWRITE |
| Plan closure | Finite V4 exists; partial unresolved; early finish skips; legacy handoff | Critical | Transactional final-slot closure | REWRITE |
| Measurement semantics | Frozen partial tuple; missing original unit/setup/time | Critical | Strict profile/zero validation | EXTRACT |
| Comparability | Tuple/exercise keys; consumer-specific policies | Critical | Unsupported/uncertain abstention paths | REWRITE |
| Progression groups/policies | Exposure-level heuristics and partial eligibility | Critical | Load arithmetic/calibration context | REWRITE |
| Recommendation history/authority | Partial receipt/readout snapshots | High | Versioned evidence fingerprint patterns | REWRITE |
| Goals/constraints | Broad goal enums, schedules, injury/preference arrays | High | Explicit settings/source text | REWRITE |
| Restriction enforcement | Authoring/selection checks, no full scoped exception contract | Critical | Limitations and candidate filters | REWRITE |
| Offline durability | Expiring local field drafts, direct fetch | Critical | Restoration UX | REWRITE |
| Concurrency | Workout/draft CAS, selected-plan locks, finisher command IDs | Critical | Transaction/rollback/retry patterns | EXTRACT |
| Derived analytics | Several useful reads; some control lifecycle/generation | High | Volume math and snapshot distinction | REWRITE |
| Migration provenance | Exact/legacy-unknown seed and snapshot precedents | High | Stable row IDs, hashes, source migration history | EXTRACT |

EXTRACT in a matrix row does not mean the full requirement is implemented: it identifies the recommended treatment of existing pieces while the future owner is established anew.

## 17. Recurring architectural patterns

| Level | Pattern | Concrete evidence / implication |
| --- | --- | --- |
| Local implementation defect | Inconsistent comparison predicates | E25 load PR lacks WORK/measurement grouping; E32 numeric fingerprints omit measurement. Fixing either is useful but does not establish a complete comparability owner |
| Repeated architectural pattern | Canonical identity attached downstream | Generated placements/slot claims are correlated or promoted at save/read time. E07/E09/E17. New intent must own identities before execution |
| Repeated architectural pattern | Generic save as semantic authority hub | E09 accepts content, scheduling, status and metadata then invokes lifecycle/review. Guards accumulate because scopes were never separate |
| Repeated architectural pattern | Mutable structure plus retrospective reconciliation | E10 rewrites pending rows; E16 appends drift facts; E24 derives history from current rows. Provenance is compensating for missing start/adjustment ownership |
| Repeated architectural pattern | One inferred eligibility result reused across questions | Session semantics controls volume/history/progression; comparison keys and PRs differ. Actual evidence, suitability, completeness and progression require separate questions |
| Obsolete subsystem assumption | Future work is generated as needed | Seed + phase + selection + deficits → session. Future Plan must instead expose approved occurrence intent |
| Obsolete subsystem assumption | Finished means enough prescribed work was resolved | PARTIAL is performed but not schedule-resolved. This conflates resolution and completeness |
| Obsolete subsystem assumption | Next plan handoff and gap-fill manage closure | Closeout workflow blocks subsequent training in older paths; End Early classifies pending rows as skips |
| Foundational incompatibility | No durable action/correction history for main logging | Upsert/delete plus direct fetch cannot represent dependencies, late work and explicit conflicting versions |
| Foundational incompatibility | Plan activation governs whether old execution can mutate | E13/E05 tie mutation to selected plan; 2.0 explicitly preserves open work after conclusion/next activation |
| Foundational incompatibility | Measurement and lineage are incomplete source facts | Row-level tuple and generated labels cannot recreate missing units/setup/start targets or original corrections |

The pattern is not “the repository has no safeguards.” It has substantial safeguards protecting a different model. Reusing those owners would make legacy semantics constraints on the target, violating the task's future-state-first rule.

## 18. Recommended modernization/replacement strategy

**Use strangler/replacement boundaries as the overall strategy, with broad replacement inside the core domain.** Retain the delivery/build/verification environment where useful. Establish the finalized owners beside a source-history boundary, and extract narrow capabilities into them. This is not a mandate for microservices, event sourcing, a new language or a different database.

| Boundary | Strategy | Reason |
| --- | --- | --- |
| Planning + lifecycle + occurrence identity | Broad replacement | Seed/mesocycle/state derivation cannot incrementally become explicit occurrence/amendment authority without a prolonged dual model |
| Execution & Evidence + synchronization/corrections | Broad replacement | Start capture, durable actions, assertion versions and finish dependencies must agree from first usable logging |
| Recommendations/comparability | Replacement with algorithm extraction | Product defaults and eligibility differ; output/presentation history must be explicit |
| Goals & Constraints | Replacement with source-data import | Current fields omit scoped instructions, milestones, exceptions and approved context |
| Catalog/descriptive data/measurement helpers | Incremental extraction and extension | Stable useful data and validation exist; keep old semantics identifiable |
| UI shell and narrow controls | Incremental reuse | Infrastructure/input mechanics do not require legacy domain preservation |
| Analytics/reviews | Replace input contracts; extract calculations | Existing calculations can survive only as read-only consumers of qualified evidence |
| Historical source/migration | Dedicated replacement boundary with retained readers | Preserve old truth and uncertainty without creating live obligations |
| Operations/test infrastructure | Incremental adaptation | Existing isolation and integrity safeguards materially protect data |

Do not dual-write normal training into legacy and 2.0 runtime owners. Historical import may be staged and reconciled, but each accepted new action needs one owner. A legacy compatibility reader is acceptable; a legacy repair or generator that silently changes new intent is not.

## 19. Proposed sequencing principles

These are constraints for subsequent implementation planning, not a schema, ticket backlog or implementation plan.

1. Establish explicit identity and ownership before reusing algorithms or UI payloads. Do not rename seeds/mesocycles to Plan and call that convergence.
2. Treat the first usable loop as inseparable: valid manual intent, online authoritative start, durable continuation, truthful partial finish, corrections, restrictions and evidence-qualified progression. Offline durability/corrections are foundation obligations, not later polish.
3. Preserve source data and provenance before retiring a runtime. Do not normalize unknowns merely to satisfy new numeric fields or progression rules.
4. Distinguish new-data contract acceptance from historical evidence import. Legacy records may be honest but incomplete, and may never qualify for automation.
5. Define acceptance around exact reviewed scopes and coupled facts. Start/skip/removal, finish/closure, and undo/exclusivity cannot rely on eventual display reconciliation.
6. Extract computations behind read-only input contracts. Require explicit evidence eligibility; avoid copying legacy adapters that synthesize chronology or authority.
7. Port behavioral scenarios, not fixture parity. Final skip, zero/null, no relabeling, no silent overwrite and transactional rollback survive; handoff and partial-nonresolution expectations do not.
8. Establish one cutover write boundary and reconciliation coverage before claiming migration complete. Preserve post-cutover work before any rollback.
9. Defer optional intelligent authoring/forecasting breadth without weakening manual intent, evidence or comparability. Foundation advice is allowed to abstain.

## 20. Risks / unresolved repository questions

No unresolved product/domain contradiction prevents a responsible implementation strategy. The following remain implementation/cutover investigations, not reasons to preserve the old runtime:

| Question / limit | What is known | Why it matters later |
| --- | --- | --- |
| Deployed revision, installed migrations, rollout flags | Source commit and SQL inspected; no provider/DB inspected | Determines actual historical population and which generation paths produced it |
| Counts/quality of historical records | Schema and writers establish possible semantics, not row-level coverage | Need authorized read-only export/inventory before migration acceptance |
| Original overwritten/deleted evidence | Current log model does not retain versions | Backups or exports may recover it; without those, explicitly unrecoverable |
| Known devices and draft queues | Main UI stores expiring drafts; no general offline queue found | Cutover cannot certify unseen devices or drafts as synchronized/performed |
| Exact source time/unit conventions by era | Current writer uses server times/quantization; tuple capture varies by path | Per-era mapping may increase confidence, never invent per-record facts |
| Hidden operational/admin writes | Repository repair scripts exist; no external provider inventory performed | Cutover fence must cover all real writers, not only HTTP routes |
| Auth/account behavior | E33 uses configured OWNER_EMAIL or owner@local resolution | New account-bound local recovery must not assume this prototype owner lookup proves session/account isolation |
| Generalized custom exercises and equipment steps | Not found as complete ordinary authoring/evidence capability | Required new owner behavior; catalog completeness cannot become a logging blocker |
| Atomic retry retention policy | Main CAS lacks action outcomes; finisher commands have richer but expiring records | Future duplicate, correction and late-work semantics need explicit retention guarantees |
| Current test pass state | Assertions inspected only | Implementation work must inspect/reuse exact-tree evidence and run proportional checks; this analysis does not certify release readiness |

Negative findings are bounded to the inspected application schema, route inventory and source searches. A missing domain capability was not inferred solely from a missing filename. The decisive incompatibilities—PARTIAL resolution, start/log coupling, row replacement, overwrite/delete corrections, expiring local drafts, and seed/week/slot authority—are directly visible in owning code.

## 21. Final readiness verdict for implementation planning

The future-state model supplies coherent target behavior, and the repository investigation supplies sufficient evidence to choose replacement boundaries and identify useful extractions. Substantial rewriting is required, but it is not a missing product decision. Historical-data quality and deployed-state verification remain mandatory before migration/cutover, not blockers to implementation planning.

**READY FOR TRAINER APP 2.0 IMPLEMENTATION PLANNING**
