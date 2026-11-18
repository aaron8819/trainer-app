# Pending exercise amendments

Implemented scope: change `t2:bodyweight-45-degree-back-extension` to the generic
`t2:45-degree-back-extension` for explicit never-started, unskipped positions in an
active program. This is not a general accepted-program editor.

## Ownership and boundaries

`api/trainer2/plan-exercise-amendment.ts` owns command orchestration;
`engine/trainer2/plan-exercise-amendment.ts` owns the pure transformation.
`Trainer2PlanExerciseAmendment` is an append-only, accepted-action-sealed batch.
The original accepted revision, original identities, completed results, previous
START snapshots, skips and progression policy are never rewritten.

The replacement retains occurrence/position/target IDs, target order, reps,
classification, required status, RIR and rest. Incompatible bodyweight-only load
is cleared to unspecified, never converted into an invented weight. Generic
logging uses 0 lb for bodyweight and positive weight for total external weight
held. Existing bodyweight-only history retains its original meaning.

## Command and concurrency

POST `/api/trainer2/plans/amend-exercise-preview` derives a canonical replacement
snapshot from explicit `{occurrenceId,positionId}` selections and the fixed
replacement catalog ID. POST `/api/trainer2/plans/amend-exercise` accepts the
`AmendPendingExercise` durable envelope. Bindings include original revision,
plan amendment version, instruction epoch and replacement content hash.
The account-first command lock serializes with START, skip and finish. All
selected positions are validated before the first domain write. Any previously
started execution, including a discarded one, disqualifies that occurrence.
SQL checks source identity, immutable snapshot, preserved targets, uniqueness,
account, accepted outcome and concurrency independently of application code.

START requires the current amendment version (old clients mean version zero)
and captures optional exact amendment provenance alongside its original source
revision hash. Readback of prior START remains snapshot-only. Prospective Program
and next-workout previews resolve the persisted overlays; saved draft/revision
reads continue exposing the original accepted document.

## UI and recovery

A scoped panel previews matching pending back extensions and asks for deliberate
confirmation. The durable envelope is retained in session storage before send.
Unknown outcomes retain the exact envelope for retry. START, skip and advancement
remain locked until accepted readback has at least the outcome sequence and
amendment version; matching version also requires exact action and hash.
An account/plan-keyed component and generation guard reject late async responses.

## Release and verification

This feature requires additive migration `20261118010000_trainer2_pending_exercise_amendment`
and matching runtime grants **before** application deployment. It is not a
code-only release. Verify exact production target and backup/rollback policy
before separately authorized migration execution. Never replay migrations as a
side effect of deploying source. After an amendment is accepted, an older runtime
without the resolver must not serve START: schema additivity is not semantic
rollback compatibility. Recovery must retain a tested forward-compatible
application and guards. A destructive down migration or dropping overlays would
lose accepted intent and is not a rollback strategy. Follow `07_OPERATIONS.md`
for write pause, fresh verified backup, explicit database identity, direct
connectivity and migration-integrity gates before applying migration and the
incremental `prisma/trainer2-plan-amendment-grants.sql`.

Focused engine/UI tests cover selection, immutable transformation, legacy START
contracts and retained request recovery. Disposable PostgreSQL acceptance must
cover batch atomicity, stale bindings, exact retry/collision, both START race
orders, SQL bypass/permissions, upgraded historical reads and browser
preview→confirm→reload→START→0/positive added-load entry.
