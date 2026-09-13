# Exact local plan activation

Implemented from accepted progression/review commit `5865cb9dec901d55a9c0afdad1ea397dd1b7347e` (tree `489d23475a3a5a1c8da85a2b4cf50a1461610619`). This is the bounded local activation slice from the progression correction re-review. Earlier accepted builder, review and principal assessments remain closed. Hosting is paused and Phase 0 remains incomplete.

## Ownership and command

Planning owns activation in `src/lib/api/trainer2/activation.ts`. `command.ts` is the shared account-serialized acceptance infrastructure used by Draft edits, activation and named instruction operations. `engine/trainer2/plan-review.ts` owns saved hard-validity checks; `engine/trainer2/instructions.ts` owns explicit exclusion applicability. SQL owns lifecycle, same-account references, immutable records and acceptance integrity. Routes only select the command and existing trusted request context.

`POST /api/trainer2/drafts/activate` accepts `ActivatePlan`, using the existing schema-version/action/device/account/ownership-epoch/dependency envelope, `target.planId`, `expected.planRevisionId`, and `intent.reviewed` (`trainer2-contracts/activation.ts`). The originating account is an assertion, never trusted identity. The existing server verifier/mapping authorizes before and after the account lock. Fenced ownership rejects new commands; the existing local synthetic LEGACY default remains available to this isolated demo. Hosted admission still unconditionally denies access before a write pool opens.

The complete reviewed binding names account, plan, immutable revision, the saved review digest (full intent, progression and saved-review policy), immutable instruction revision/epoch/hash, evaluated restriction issues and `trainer2-activation-v1`. The instruction document and evaluation timestamp accompany the binding for human review and runtime response verification. Digests are evidence, not permission. Acceptance loads the current saved revision and instruction state under the account lock and recomputes the binding and all applicable checks at acceptance time. A changed instruction epoch, changed prescription, changed restriction applicability or newer equal-valued revision invalidates the request. Invalid schemas fail before action receipt; well-formed semantic failures receive durable outcomes.

Prerequisites: owned untombstoned Draft, exact current revision, supported saved intent and policies, no saved readiness issues, executable work, resolved exclusions, and no other Active/Paused plan. A competing current plan is returned as `CURRENT_PLAN_CONFLICT` with its owned `currentPlanId`; the UI offers **View active plan**. Conclusion/replacement remains unavailable, so activation cannot silently resolve this conflict. Open executions are not consulted or created by activation.

## Persisted effects and concurrency

One transaction records `Draft -> Active`, `initialApprovedRevisionId = currentRevisionId`, one immutable `Trainer2PlanDecision` (`ActivatePlan`) referencing that same revision and the instruction revision, one accepted sequence increment, and the durable command/outcome. No plan document is copied or regenerated. Initial approved endpoint, progression, prescriptions, decimal spelling, occurrence/position/target identities and array order remain in the existing immutable PlanRevision.

Every planning/instruction writer acquires the account row lock before authoritative reads. A partial unique index permits at most one Active/Paused plan per account. Same-account foreign keys, approval/lifecycle checks, activation/decision seals and the extended owner-specific acceptance constraint enforce consistency at commit. The accepted historical migrations are unchanged; `20260913120000_trainer2_activation` adds the new schema and extends the existing acceptance validator to recognize all three owners while retaining historical Draft and sequence checks.

Draft edits reject every non-Draft lifecycle. SQL blocks updates of activated plan state, head and approval in this slice, and the existing revision/identity seals prevent detached or late mutable additions. An edit winning the lock makes activation stale; activation winning makes a subsequent Draft edit invalid. No active-plan editing, pause/end/resume or replacement command is added.

Exact action/envelope retries return the original durable outcome after current authorization, before current-state checks. Changed envelopes are rejected. A fresh activation action for an already Active plan returns `ALREADY_ACTIVATED`; it does not add a decision. Transaction infrastructure failures abort all effects and allow retry with the same action. Semantic failures occur before the first domain write. Historical successful outcomes do not establish current state: Workbench always reloads the authoritative read after acceptance/replay.

## Instruction boundary

`Trainer2InstructionRevision` stores immutable versioned whole-account instruction documents. The account instruction epoch selects the current document; prior versions remain provenance. `POST /api/trainer2/drafts/instructions` accepts only `ChangeInstructions` with one named operation: `AddRestriction`, `ClearRestriction`, or `AddScopedException`, and an exact expected instruction epoch. It is not a document-save endpoint. Each operation uses the same action identity, account lock, ownership checks, immutable outcome and sequence rules as planning.

The bounded restriction identifies an exact catalog exercise, an explicit instruction, account or plan scope, and start/end validity. Its current immutable restriction revision changes on clear. An exact catalog mismatch is inapplicable; authored descriptions produce an uncertainty issue for applicable exclusions. Names never establish catalog identity and free text never becomes a diagnosis or inferred exclusion.

An exception names the current restriction revision, exact plan revision, explicitly selected position IDs, validity and user-authored reason. Foreign or stale work is rejected. An exception cannot outlive its named restriction's explicit end. Even a later equal-valued PlanRevision needs new exception authority; changing exercise meaning under the same position cannot inherit old permission. Instruction/root/exception identities cannot be recycled from retained instruction history. Clearing a restriction preserves its history. Broad profile management, automatic medical interpretation and runtime restriction enforcement are later work.

The small review UI can add account/plan exclusions, clear an exclusion and deliberately allow one selected exercise occurrence with a reason. API validity supports explicit dates; the UI uses effective-now, until-cleared exclusions. Its exception inherits any explicit restriction end. Each instruction change requires fresh review.

## Read and UI contracts

`GET /api/trainer2/drafts/[planId]` now runs in a repeatable-read, read-only transaction and returns the existing validated saved review plus `state` and `activation`. Complete response validation verifies both documents/hashes, both policy bindings, instruction integrity/applicability and lifecycle/approval consistency. Readiness remains a derived result; it is not persisted as a mutable approval flag.

The populated five-week builder remains the starting screen. Save precedes explicit review. **Activate plan** appears only for the current saved review, and remains blocked for readiness/exclusion issues. Unsaved changes and uncertain saves cannot activate. The exact displayed immutable revision is submitted. Request generations and an account/plan-keyed Workbench discard delayed responses after edits, reloads or plan switches.

Before submitting activation, sessionStorage retains the complete original command under the account/plan key. A malformed, unbound or uncertain response keeps that command available for **Check again**, including after bookmark reload. Recovery sends the identical envelope. A validated accepted/replayed response clears the pending command and performs a separate current-state read. If that read fails, the UI says current state could not be loaded and offers reload. Active state renders the exact saved schedule, locks editing and explicitly says starting workouts is not available yet.

## Verification and operation

Run from `trainer-app` with installed local dependencies:

- `node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-activation.ts --confirm-disposable`
- `node node_modules/vitest/vitest.mjs run src/lib/engine/trainer2/ src/components/trainer2/ src/lib/api/trainer2/isolation.test.ts src/lib/api/trainer2/read-review.test.ts --maxWorkers=1 --testTimeout=20000`
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`
- `npm run lint`, `npm run verify:contracts`, `npm run test:preflight`, and repository-selected gates.

The activation harness uses the existing guarded disposable launcher. It applies the full migration chain to a fresh PostgreSQL 17 database, reconstructs the accepted-base migration chain in another database with populated Draft/action/identity fixtures, applies the new migration, compares all historical rows and checks restricted grants. A second deploy is a ledger no-op. All targets are newly generated loopback databases in its own disposable container; no environment-configured database is used.

Real PostgreSQL tests inspect persisted revisions, identities, decisions, actions, outcomes and counters independently. Races wait for observed PostgreSQL blocking chains, then release a controller lock in the selected order. A test-only failing decision trigger proves complete rollback. The actual Edge journey includes save/review, equal-valued remote-save conflict, activation, a dropped response after commit, exact retry after reload, active-state bookmark and stored occurrence-order comparison. Unit consumer probes distinguish malformed responses and delayed plan-switch results from actual server output. Desktop and mobile screenshots and sanitized receipts are retained under `artifacts/trainer2`.

The separate demo remains `node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable`. Wait for READY and use its printed loopback URL. Each run owns new resources; plans are deleted when that demo stops. Enter/Ctrl+C invokes the launcher's own cleanup. No hosted readiness, release, independent acceptance or Phase 0 completion is implied.
