# Trainer repository guidance

## Start here

Read this policy, then the [task and verification command guide](scripts/codex/README.md#task-and-verification).
Most active code and package commands live in `trainer-app/`. Read the
[domain index](trainer-app/docs/00_START_HERE.md), owning code, nearby tests and relevant
`.codex/skills` only when the task needs them. `CLAUDE.md` and README are pointers, not extra checklists.
Current code, schema and tests establish implemented behavior; north-star and archived documents
are direction or history. Search with `rg` before editing and change the rightful owner.

## Ownership and authorization

- Keep one implementation owner through the authorized PR, CI recovery, review, merge and read-only
  deployment verification. Reviewers remain read-only. Carry bounded authorization forward;
  ask again only for materially changed scope or a required action outside it.
- Honor the requested environment. Prefer an isolated cloud checkout; no personal PC is required.
  For linked worktrees, use the primary checkout's sibling `.worktrees/trainer/<task>` and a
  `codex/<task>` branch. A task-owned standalone cloud clone is also isolated.
- Before writing, verify the exact checkout, branch, base/head, registered worktrees and dirty state.
  Preserve unrelated tracked, untracked, ignored and machine-local files. Never write over overlapping
  work or clean up someone else's branches, worktrees, sessions or resources.
- A necessary handoff includes checkout, branch, base/head/tree, dirty files, approvals, evidence and
  owned resources. The outgoing owner stops writing; the incoming owner verifies the checkpoint.
- Database inspection is read-only by default and needs task scope. Migrations, SQL, seeds, repairs,
  backfills and fixture database writes need authorization for the exact environment and action.
  Deployment, provider writes and destructive cleanup remain bounded by the user's authorization and
  [operations safety](trainer-app/docs/07_OPERATIONS.md). Tooling never creates authority.

## Canonical boundaries

Keep routes thin, DB orchestration/read models in `src/lib/api`, pure domain logic in `src/lib/engine`,
shared session meaning in `src/lib/session-semantics`, and persistence in `prisma`.
Do not duplicate domain truth or turn diagnostics/audit artifacts into runtime policy.
[Architecture](trainer-app/docs/01_ARCHITECTURE.md) owns the detailed identity, receipt, accepted-seed,
lifecycle and runtime boundaries. Use the five retained specialist skills when their stated triggers
apply; do not add another orchestration layer. Repository memory is optional context, not policy.

## Verification and completion

- Use exact lockfile dependencies and repository-local scripts. Choose explicit owning-test paths for
  focused feedback; legacy `test:fast` is not general Trainer2 coverage. The command guide owns selection.
- Publish an authorized draft after focused checks so hosted acceptance starts early. Final affected
  browser/visual acceptance and independent review belong before merge, not before draft publication.
  Freeze the source for the final affected browser run and capture the full requested changed surface.
- Keep the full parallel hosted inventory, production build/admission, browser/recovery and cleanup
  gates. Coverage selection remains advisory. A proposed or skipped check is never a passed check.
- Reuse valid exact-tree evidence with equivalent definitions and environments. Rerun evidence invalidated
  by source, dependency, configuration, base or relevant environment changes; do not repeat an unchanged
  full local suite just to duplicate hosted evidence. Compare failures with the base by test identity.
- Before merge, verify a current integrated candidate, successful applicable CI, independent review and
  any requested visual approval. Merge only the qualified head within approved scope. Verify merged-tree
  correspondence and deployment identity/availability read-only; a merge does not prove deployment.
- Keep the PR summary concise: exact source/tree, checks actually passed, CI, review, production target,
  elapsed work/waiting, reused evidence and gaps. Update the owning docs with executable contracts.
  Never replay migrations as part of a code-only release.
