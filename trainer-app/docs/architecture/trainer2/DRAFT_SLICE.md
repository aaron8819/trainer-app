# Trainer2 first draft slice

Status: local implementation; no hosted write admission, deployment, or cutover. This document owns the implemented slice and its targeted contract clarifications. The neighboring implementation plan describes future phases except where this document establishes current behavior.

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

### Draft deletion

Ordinary deletion is a monotonic Plan tombstone. It hides the draft from normal reads while retaining the root ID, all full revisions, identity registry and action/outcome history. Retried creates/edits can return original historical results but cannot clear the tombstone, move its head or recreate the root. New commands against that root are rejected. SQL rejects hard deletion and tombstone reversal. No delete command/UI is exposed. Physical personal-data erasure is a separate, explicitly authorized workflow with coherent retry/provenance handling.

### Historical imports

Future execution captures must distinguish `VERIFIED_START` (prescription verified as presented at an accepted Start) from `HISTORICAL_IMPORT` (source artifact, source record/revision, capture confidence and unknown fields). A source prescription document alone never establishes verified start structure, what was presented, or progression eligibility. Unknown starting intent remains unknown. No import/execution tables or capture handlers are introduced here.

## Actual supported draft shape

The version-1 full document contains a name, a finite `endOfOrderedOccurrences` endpoint, ordered stages, ordered occurrences with explicit stage references, and ordered exercise positions/individually identified targets. Exercise meaning is an explicit authored description, not an unverified catalog reference. No catalog lookup or inferred identity is performed. Unsupported catalog IDs, counterparts, progression groups, dates, lifecycle flags and arbitrary metadata fail strict parsing; later slices must introduce explicit versioned contracts.

Targets distinguish requiredness and preparation/ramp-up/working/optional-finisher classification, min/max reps and total/per-side/alternating rep basis. Measurement supports external load with barbell-total/per-implement/machine-display convention, added external load, displayed assistance, or bodyweight-only. Original kg/lb and decimal spelling are retained. Zero requires its explicit meaning; zero assistance remains assistance. Missing measurement is allowed in a draft and produces an activation blocker. RIR/rest are optional decimal strings; RIR is bounded to 0–10. No load quantization, numeric coercion, inferred bodyweight addition, or catalog authority exists.

Add/edit/remove/reorder operations address explicit lowercase UUIDs (uppercase spelling is rejected, not silently normalized). Stage reassignment preserves occurrence identity; position parent occurrence and target parent position are immutable. Removal and reintroduction require fresh IDs, including nested targets. Duplicate names and repeated same-exercise positions are valid. No current-plan or live execution state exists. Activation blockers include the unsupported activation/progression foundation as well as missing executable work/prescriptions; this is not a completed activation validator.

## Persistence and authorization

Seven new tables: AccountPrincipal, AccountTrainingState, Plan, PlanRevision, Identity, DurableAction, ActionOutcome, all prefixed `Trainer2`. Identity is one typed registry for the four supported identity kinds, with same-root parent FKs; it stores no prescription values. No unused future tables are created. Existing User is referenced but never provisioned or modified by runtime handlers.

New records use server-side Prisma. SQL migration `20260909120000_trainer2_drafts` supplies database-only composite owner/root FKs, deferred graph validation, parent revision numbering, immediate immutable UPDATE/DELETE guards and first-transaction graph seals. These deliberately supplement the scalar Prisma models. `createdTx` seals registry association to the revision's construction transaction. Canonical text is preserved alongside JSONB; PostgreSQL verifies JSON equality and SHA-256. Heads must advance to an immediate successor from the current transaction. Immutable revisions cannot be deleted/rewritten, and old revisions cannot acquire new registry rows. Application schemas enforce complete value semantics; SQL independently enforces graph references and identity continuity.

An authenticated issuer/subject mapping is read, never guessed from email or a submitted account ID. Concurrent first writes use `INSERT ... ON CONFLICT DO NOTHING` then `SELECT ... FOR UPDATE` on AccountTrainingState before domain reads. The mapping is rechecked inside acceptance. Semantic conflicts commit the unchanged submitted envelope and outcome without domain writes. Domain writes, counter increment and Accepted outcome commit atomically. SQL/infrastructure failure rolls back the entire action. Bounded serialization retries use the same envelope. No external network/provider work occurs within acceptance.

No verified hosted auth adapter exists in this repository, so all Trainer2 hosted/production access fails closed. The local developer adapter requires development mode, `TRAINER2_LOCAL_DRAFTS=enabled`, absence of hosted/CI markers, loopback HTTP Host plus same-origin POST, and a loopback `trainer2_disposable_*` database using the exact restricted `trainer2_draft_runtime` role. The runtime verifies its actual database role and reads a preprovisioned `trainer2-local-disposable/developer` principal. This test adapter does not establish production authentication. Serve it only on `127.0.0.1` as the harness does.

The migration revokes PUBLIC access and enables RLS without granting browser/runtime roles. The disposable harness creates separate owner, trusted multi-account server and read-only roles, grants only new-table access to runtime, and checks every legacy table for mutation privileges. Role grants are local fixture setup, not a production provisioning migration. Provider-default grants and real authentication still require a separately authorized environment review before hosted use.

GET authenticates and reads only; the API executes its domain read in a read-only transaction. Principal/state provisioning belongs exclusively to explicit setup/write paths. New POSTs are classified as `trainer2_draft` in the existing production write-pause gate, followed by the stricter developer gate.

## Verification and remaining work

Run from `trainer-app`, using installed local dependencies and running Docker:

```text
npm run test:db:trainer2-drafts -- --confirm-disposable
```

The command validates the exact confirmation and inherited target classifications before loading database code. It creates its own uniquely named loopback PostgreSQL 17 container, applies the entire migration chain twice, provisions only disposable fixture users/roles, exercises real handlers and SQL constraints/concurrency, then launches the actual developer page in headless installed Edge. It removes only its own server/container afterward. It never loads `.env` or repoints a configured/shared target. Edge is an existing local browser dependency; the script does not download one. The page is `/trainer2/dev/drafts`; buttons create a finite sample, rename, reorder, remove/add distinct positions, reload by saved plan ID and retry the last action. It is intentionally a developer workbench, not the full editor or offline journal.

Focused tests: `src/lib/engine/trainer2/planning.test.ts`, `src/lib/api/trainer2/isolation.test.ts`, and the production-write-gate suites. The disposable test implementation and browser assertions are in `scripts/trainer2/verify-drafts.ts`. Sanitized runtime evidence and a screenshot are written under ignored `artifacts/trainer2/`. See [acceptance matrix](DRAFT_ACCEPTANCE.md) for each requested claim and final run status.

Remaining Phase 0: verified hosted identity/provider wiring and role inventory, source-export/era classification and read-only legacy source adapter, mapping/discrepancy dry-run fixtures. This first slice does not complete Phase 0. Recommended next bounded slice: a read-only source artifact inventory and historical-import provenance/dry-run fixtures; do not enable execution or cutover yet.
