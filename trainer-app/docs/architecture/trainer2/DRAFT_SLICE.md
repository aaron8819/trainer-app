# Trainer2 first draft slice

Status: local implementation; no hosted write admission, deployment, or cutover. This document owns the implemented slice and its targeted contract clarifications. The neighboring implementation plan describes future phases except where this document establishes current behavior.

The retained independent Draft re-review accepted F1–F3 at `aea9d489260455a6a496d103b8f80bd11a2f6bfc`; the combined local Auth/principal re-review passed at `18fa308d21d64d43381534e584c8ab184cca326e`. Their original reports remain in their originating review checkouts. [Correction report](DRAFT_CORRECTIONS.md) preserves the earlier candidate history. The local scratch editor starts from accepted `18fa308d`, tree `19224f056b6e4e0c3551c5663d1becc7336d70d7`, on `codex/trainer2-draft-editor`.

## Authority and change map

The source checkout was clean at `eb1b45e9c516d14e8857e5b028f2be13233619cd`, identical to the implementation plan's inspected revision. There was no intervening repository drift. Implementation branch: `codex/trainer2-draft-loop`.

The following local copies preserve the exact source bytes and SHA-256 values verified before implementation:

| Source | SHA-256 |
| --- | --- |
| [Final blueprint](PRODUCT_BLUEPRINT_FINAL.md), original `Trainer-App-2.0-Blueprint-FINAL (1).md` | `5FC72877DC2E1103DC8A199EBC791ED6E149B4CEBF11955CF949CD92C2023094` |
| [Domain architecture](TRAINER_APP_2_DOMAIN_ARCHITECTURE.md) | `174501628F254383389C867F2D08519D30E1A0B433CADBC922665FF7E4DFE547` |
| [Repository gap analysis](TRAINER_APP_2_REPOSITORY_GAP_ANALYSIS.md) | `07A47F6AE9F05EC3A11AF0E691516934C33AB6AEC370EF5016D1E17B3700A879` |

These are archived design authorities, not statements that all described functionality exists. The canonical [implementation plan](TRAINER_APP_2_IMPLEMENTATION_PLAN.md) includes the corrections below. No higher-authority product conflict was found: tombstones preserve deletion's ordinary visibility effect, full-envelope binding strengthens action identity, outcome cursors separate delivery from domain acceptance, and import provenance preserves unknown starting truth.

Planning owns the full document in `src/lib/engine/trainer2/planning.ts`; `src/lib/api/trainer2/planning.ts` coordinates owner-scoped persistence and acceptance. Strict transport/value schemas live in `src/lib/trainer2-contracts/draft.ts`. Routes and the developer workbench consume those interfaces. SQL owns reference integrity, immutability, and committed cursor allocation. Legacy generators, save handlers, selected-plan logic, and lifecycle services remain outside these dependencies.

## Four implementation clarifications

### Outcome synchronization

`acceptedSequence` increments only for accepted domain commands and remains the execution-freshness counter for later phases. It is **not** a delivery cursor. `AccountTrainingState.outcomeSequence` allocates an independent account-local `ActionOutcome.outcomeCursor` on every visible durable transition, including Waiting, Accepted, Rejected, Conflict, and Superseded. The append-only journal preserves each transition, including changes to old actions. `DurableAction` keeps the immutable submitted envelope; its latest status is the last journal row, not a second mutable status column.

The INSERT trigger increments the account counter under the same row lock used by acceptance, within the outcome transaction. A subsequent writer cannot allocate/commit a later cursor before this transaction completes. Rollbacks undo both cursor and row. PostgreSQL sequences or timestamps alone would not provide that commit ordering and are not used.

`readOutcomeChanges` captures a committed `through` high-water mark, selects immutable rows with `after < cursor <= through`, sorts ascending, and limits the page to 1–100 rows. Continue with the last returned cursor and the same `through`; on an empty page use `through`. Once drained, poll after that frontier with a new high-water mark. Concurrent later commits have strictly greater cursors. Pagination never orders by action creation time or acceptedSequence. No HTTP sync endpoint or dependency worker exists in this slice; dependency-bearing Create/Edit commands receive a durable `DEPENDENCIES_UNSUPPORTED` rejection.

### Complete immutable envelope binding

Hash version `trainer2-command-envelope-v1` is SHA-256 of the UTF-8 bytes of `version + LF + canonicalJson(entire submitted envelope)`. Canonical JSON recursively sorts object keys lexicographically, uses JSON string escaping, preserves array order, and preserves decimal strings byte-for-byte. Only safe integer JSON numbers are supported. Undefined, nonplain objects and unsupported number representations are rejected.

Bound fields are command type, command schema, action ID, originating account, device, ownership epoch, explicit target, expected bases, ordered dependencies, and complete intent/ordered edit operations. No envelope fields are excluded. HTTP headers, connection/arrival timing, and whitespace/object-key formatting are nonsemantic transport representation; they are not envelope fields. `submittedEnvelope` stores that canonical original envelope without dependency rewriting. Replay compares both hash and canonical envelope, after authorization and before current-head/epoch checks. A changed field is rejected (invalid-contract fields as `INVALID_COMMAND`, wrong account as authorization failure, valid changed envelopes as `ACTION_ID_COLLISION`) without altering the first action/outcome. Future dependency resolution must use separate derived resolution data.

Accepted replay returns its historical revision and original acceptedSequence; the response explicitly marks `replayed`. It does not claim that revision remains current. The workbench separately reloads the head after acceptance/replay.

The workbench retains the accepted plan bookmark before fetching the head. Non-OK or thrown read failures explain that the plan was saved but could not be reloaded, retain a GET-only reload path, and lock any earlier snapshot. Only a successful GET claims a refreshed head. Both editable fields and all request buttons are locked throughout submissions and reads; a synchronous in-flight guard prevents overlapping requests. Editing a stale snapshot requires reloading first. Delivery uncertainty remains a separate same-envelope retry case.

### Draft deletion

Ordinary deletion is a monotonic Plan tombstone. It hides the draft from normal reads while retaining the root ID, all full revisions, identity registry and action/outcome history. Retried creates/edits can return original historical results but cannot clear the tombstone, move its head or recreate the root. New commands against that root are rejected. SQL rejects hard deletion and tombstone reversal. No delete command/UI is exposed. Physical personal-data erasure is a separate, explicitly authorized workflow with coherent retry/provenance handling.

### Historical imports

Future execution captures must distinguish `VERIFIED_START` (prescription verified as presented at an accepted Start) from `HISTORICAL_IMPORT` (source artifact, source record/revision, capture confidence and unknown fields). A source prescription document alone never establishes verified start structure, what was presented, or progression eligibility. Unknown starting intent remains unknown. No import/execution tables or capture handlers are introduced here.

## Actual supported draft shape

The version-1 full document contains a name, a finite `endOfOrderedOccurrences` endpoint, ordered stages, ordered occurrences with explicit stage references, and ordered exercise positions/individually identified targets. Exercise meaning is either an explicit authored description or a Trainer2-owned versioned catalog snapshot with a stable catalog reference and captured measurement meaning. Names never imply catalog identity. Progression groups, dates, lifecycle flags and arbitrary metadata remain unsupported. The optional version-1 builder value adds only explicit recurrence/default/override relationships described below; old documents without it remain readable and are never automatically converted.

Targets distinguish requiredness and preparation/ramp-up/working/optional-finisher classification, min/max reps and total/per-side/alternating rep basis. Measurement supports external load with barbell-total/per-implement/machine-display convention, added external load, displayed assistance, or bodyweight-only. Original kg/lb and decimal spelling are retained. Zero requires its explicit meaning; zero assistance remains assistance. Missing measurement is allowed in a draft and produces an activation blocker. RIR/rest are optional decimal strings; RIR is bounded to 0–10. No load quantization, numeric coercion, inferred bodyweight addition, or live catalog reinterpretation exists.

Add/edit/remove/reorder operations address explicit lowercase UUIDs (uppercase spelling is rejected, not silently normalized). Stage reassignment preserves occurrence identity; position parent occurrence and target parent position are immutable. Removal and reintroduction require fresh IDs, including nested targets. Duplicate names and repeated same-exercise positions are valid. No current-plan or live execution state exists. Activation blockers include the unsupported activation/progression foundation as well as missing executable work/prescriptions; this is not a completed activation validator.

## Persistence and authorization

Seven new tables: AccountPrincipal, AccountTrainingState, Plan, PlanRevision, Identity, DurableAction, ActionOutcome, all prefixed `Trainer2`. Identity is one typed registry for the four supported identity kinds, with same-root parent FKs; it stores no prescription values. No unused future tables are created. Existing User is referenced but never provisioned or modified by runtime handlers.

New records use server-side Prisma. SQL migration `20260909120000_trainer2_drafts` supplies database-only composite owner/root FKs, deferred graph validation, parent revision numbering, immediate immutable UPDATE/DELETE guards and first-transaction graph seals. These deliberately supplement the scalar Prisma models. `createdTx` seals registry association to the revision's construction transaction. Canonical text is preserved alongside JSONB; PostgreSQL verifies JSON equality and SHA-256. Heads must advance to an immediate successor from the current transaction. Immutable revisions cannot be deleted/rewritten, and old revisions cannot acquire new registry rows. Application schemas enforce complete value semantics; SQL independently enforces graph references and identity continuity.

Additive correction `20260910020000_trainer2_acceptance_integrity` supplies the reverse Accepted-outcome seal. At transaction completion, each Accepted Create/Edit resolves through its account/action to the immutable revision and root, agrees with the bound command type/target/parent and exact result metadata, and carries its account's consecutive acceptance number in outcome order. The account counter equals the acceptance count; counter-only increments cannot commit. The earlier revision-to-acceptance seal remains intact. No historical acceptance check requires a live/current head, so later edits and tombstones preserve replay. These checks do not reimplement draft edits or authorize acceptance.

The correction migration locks the affected tables, creates constraints, and validates existing history within one DDL transaction. Phantom acceptance or sequence inconsistency rejects the upgrade without rewriting accepted results, fabricating revisions, or deleting records. Prisma 7 may report an aborted transaction instead of the primary SQL error; exact SQL regression checks retain `23514` with `trainer2_acceptance_revision` or `trainer2_acceptance_sequence`. Inspect the unfinished migration ledger and underlying records before separately reviewed recovery. No data repair is included or authorized.

The explicit singleton owner binding and persistent device session are checked, never guessed from email or a submitted account ID. Concurrent first writes use `INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE` on AccountTrainingState before domain reads. Owner and session state are rechecked inside acceptance. Semantic conflicts commit the unchanged submitted envelope and outcome without domain writes. Domain writes, counter increment and Accepted outcome commit atomically. SQL/infrastructure failure rolls back the entire action. Bounded serialization retries use the same envelope. No external network/provider work occurs within acceptance.

Hosted training admission requires the exact configured singleton owner and matching Preview hosted-test build/runtime configuration; [REAL_OWNER_EXECUTION.md](REAL_OWNER_EXECUTION.md) owns the current transition and authorization gates. The local developer adapter requires development mode, `TRAINER2_LOCAL_DRAFTS=enabled`, absence of hosted/CI markers, loopback HTTP Host, a valid persistent device session, exact Origin on POST, and a loopback `trainer2_disposable_*` database. The [single-user boundary](PRINCIPAL_BOUNDARY.md) supplies separate identity/read/write connections and effective role checks. This local path does not establish production admission. Serve it only on loopback as the harness does.

The migration revokes PUBLIC access and enables RLS without granting browser/runtime roles. The disposable harness creates separate owner, trusted multi-account server and read-only roles, grants only new-table access to runtime, and checks every legacy table for mutation privileges. Role grants are local fixture setup, not a production provisioning migration. Provider-default grants and real authentication still require a separately authorized environment review before hosted use.

GET authenticates and reads only; the API executes its domain read in a read-only transaction. Principal/state provisioning belongs exclusively to explicit setup/write paths. New POSTs are classified as `trainer2_draft` in the existing production write-pause gate, followed by the stricter developer gate.

## Verification and remaining work

Run from `trainer-app`, using installed local dependencies and running Docker:

```text
npm run test:db:trainer2-drafts -- --confirm-disposable
```

The command validates the exact confirmation and inherited target classifications before loading database code. It creates its own uniquely named loopback PostgreSQL 17 container, deploys the full migration chain, verifies a second deploy is an already-applied ledger no-op, and provisions disposable fixture users/roles. It also upgrades populated candidate-schema fixtures, checks rejected inconsistent upgrades, exercises real handlers and SQL constraints/concurrency, then launches the actual developer page in headless installed Edge with controlled response failures/delays. It removes only its own server/container afterward. It never loads `.env` or repoints a configured/shared target. Edge is an existing local browser dependency; the script does not download one. The page is `/trainer2/dev/drafts`; its scratch editor and revision-bound saved review are described below. It is not an offline journal or activation review.

Focused tests: `src/lib/engine/trainer2/planning.test.ts`, `src/lib/api/trainer2/isolation.test.ts`, `src/components/trainer2/DraftWorkbench.test.tsx`, and the production-write-gate suites. The disposable test entry is `scripts/trainer2/verify-drafts.ts`, with acceptance, upgrade, browser and source-manifest helpers beside it. Sanitized commands, versions, timestamps, raw/normalized source hashes and browser screenshots are retained under ignored `artifacts/trainer2/`. See [acceptance matrix](DRAFT_ACCEPTANCE.md) for current claims and evidence qualifications.

Phase 0 remains incomplete. Retained Draft/Auth acceptance and synthetic source inventory are not hosted provider/role qualification, real source/device/backup reconciliation or cutover evidence. Activation, progression, execution and the foundation release remain separate obligations. V1 remains the live training app.

## Scratch editor and saved review

The default surface is now a template-based plan builder. Planning remains canonical in `src/lib/engine/trainer2/planning.ts` and `plan-builder.ts`; owner-scoped transactions remain in `src/lib/api/trainer2/planning.ts`. No Prisma migration, alternate persistence endpoint, activation, login or hosted admission change is introduced.

`createHypertrophyPlan` copies a deterministic local template into an unsaved five-week plan: Lower A, Upper A, Lower B, Upper B in each week; four training weeks followed by one deload. No dates or weekdays are inferred. Starter version 1 populates 23 curated exercise slots across all four workouts. The picker browses a bounded, static Trainer2 catalog snapshot; custom descriptions remain secondary. See [Template builder](TEMPLATE_BUILDER.md) for provenance, prescriptions and explicit inheritance rules. Start blank requires a deliberate replacement action. No personal program is inferred.

The optional `builder` contract (version 1) stores plan-owned workout row defaults and weekly effort/deload context. Occurrences link explicitly through `workoutKey`; positions through `sourceKey`. These recipe keys are correspondence values, not executable identities. Each occurrence, position and target still has its own registry identity and owned prescription. Only initialization reads the template constants. Reload never expands or resets saved plans. Domain acceptance checks that non-overridden prescriptions agree with the plan-owned defaults.

New rows default to three working sets of 8–12 reps and unspecified weight. Weekly RIR is a single decimal in the accepted model, so the template uses 3, 3, 2, 1, 4. Rep ranges stay ranges. Deload defaults retain exercise/rep meaning, halve working sets rounded up (minimum one), and use that week's effort. No load increase, weekly set increase or readiness claim exists.

Normal workout edits explicitly expand to linked weeks, preserving occurrence/position/surviving target identities. Removing and later adding work allocates new executable IDs. New week-only edits persist explicit field masks, row override values, individual-target masks and structural choices. Unrelated shared edits continue to propagate. Existing `weekOverride: true` workouts retain their prior independent meaning without inferred provenance. Resetting an individual override restores current inheritance; restoring a whole workout requires deliberate confirmation. Supported schedule editing reorders the four workouts across all five weeks and edits weekly effort; it does not offer unimplemented week counts or template types.

`DraftWorkbench.tsx` keeps editable state separate from the loaded immutable revision. One Save plan action sends the complete initial plan via CreateDraft, or an expected-revision EditDraft batch via `draft-edits.ts`. The bounded batch now supports 1,000 operations, including `editWorkoutDefaults`, `setWeekOverride`, `setWeekEdits`, `editPositionRole`, and `editPositionTargets`. The latter preserves retained target IDs and claims only new ones under the same historical-ID checks; targets cannot move parents or resurrect. The full batch remains atomic. This bound accommodates the supported 20 exercises per workout/20 sets per row without requiring twenty separate saves.

`PlanBuilder.tsx` presents workout tabs, compact prescription rows, collapsed advanced measurement fields and a weekly view of actual prescriptions. `DraftReview.tsx` reads the saved document directly. Old non-template drafts retain their existing structural editor; no relationships are inferred to retrofit them. The demo route suppresses V1 navigation so it cannot obscure mobile Save or imply unavailable capabilities. V1 navigation elsewhere and the separate Auth surface retain their behavior.

POST/GET lock inputs with a synchronous guard. An uncertain response disables new mutations and exposes Check again, which reuses the exact submitted envelope. Confirmed acceptance plus failed GET offers only read recovery. Stale conflicts retain the submitted plan for readable comparison and require reload plus deliberate continuation; no auto-rebase or retry with a new action ID occurs. Local input/retry buffers are memory-only.

### Local disposable demo

From `trainer-app`, with installed dependencies, Docker running, the installed `postgres:17-alpine` image and no development dotenv files:

```text
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Startup first announces synthetic-data setup. After HTTP readiness, a prominent READY banner prints the complete clickable loopback URL on its own line, followed by the demo deletion warning. Open that URL. The command provisions only its uniquely named synthetic PostgreSQL 17 database, applies existing migrations/grants, creates synthetic principals and starts Next on 127.0.0.1. The app receives an allowlisted environment and three distinct restricted-role passwords, never setup credentials. No hosted login or real email is used. It stays available until Enter/Ctrl+C; stopping removes its own server/container and synthetic data. Bookmarks work while that disposable database exists. Do not use real plans or rely on demo data after stopping.

`scripts/test-trainer2-draft-editor.ts --confirm-disposable`, invoked with the same installed tsx CLI, runs the existing bundled Draft SQL/upgrade protections plus the expanded real Edge scenario and recovery checks, without rerunning the production build. `scripts/trainer2/verify-editor-browser.ts` starts with the prefilled structure, adds recurring exercises, proves week-only edits survive shared edits and reload, checks saved deload prescriptions and stable identities across five immutable revisions, and exercises mobile saves, two-client conflict and lost-response replay. Browser locators have a bounded timeout. Focused Planning/component/navigation tests cover recurrence, restore, deleted-target identity, maximum supported batch, strict relationships and input locking.

This slice ends at local Draft author/review/edit/reload. Progression intent, full activation validity/review, lifecycle/current-plan exclusivity, immutable Start capture, execution/logging/offline recovery, hosted qualification and Preview isolation, foundation release and account-specific historical reconciliation/cutover remain outstanding. No Activate/Start action, production writer or hosting is added.
