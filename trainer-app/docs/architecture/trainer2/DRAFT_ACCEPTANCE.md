# Draft slice acceptance evidence

Scope: local isolated branch `codex/trainer2-draft-loop`, based on `eb1b45e9c516d14e8857e5b028f2be13233619cd`. No source drift. No persistent/provider database changes, deployment, merge, activation or execution implementation.

## Traceable matrix

`DB` below means the executable assertions in [`scripts/trainer2/verify-drafts.ts`](../../../scripts/trainer2/verify-drafts.ts), invoked by `npm run test:db:trainer2-drafts -- --confirm-disposable`. These use real PostgreSQL 17, the complete checked-in migration chain, a restricted runtime role, a read-only role, and actual application handlers; no database mocks. Numbered PASS labels in that script correspond to this matrix.

| # | Required claim | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Exact create → reload intent/IDs | DB concurrent create plus deep equality through read role, including `20.00`/`120.00` decimals | Pass |
| 2 | New full revision; earlier content unchanged | DB retains and deep-compares all first-revision fields after edit | Pass |
| 3 | Reorder preserves identity; remove/reintroduce allocates fresh IDs | DB reverse/remove/rejected old ID/fresh equivalent nested IDs; pure same-command reuse test | Pass |
| 4 | Same action has one effect | DB simultaneous first writes with same envelope; exactly one replay and one Plan | Pass |
| 5 | Every hash-bound field category protected | DB changed type/schema/account/device/epoch/target/base/dependencies/intent rejected; original action and outcome unchanged; action-ID hash sensitivity; pure ordered-array and decimal sensitivity | Pass |
| 6 | Earlier accepted edit replay cannot regress head | DB accepts N+1, replays N, compares original outcome and reads unchanged N+1 head | Pass |
| 7 | Competing edits preserve losing intent | DB same-base race has one Accepted and one Conflict; losing canonical envelope retained | Pass |
| 8 | Cross-account objects and foreign heads rejected | DB foreign reads/edits/identity reuse; direct foreign-root head insertion/update rejected | Pass |
| 9 | Malformed references/duplicate identity rejected | Strict schema tests plus direct revision transactions attacking stage refs, duplicates and foreign identities | Pass |
| 10 | Failure cannot partially accept | DB trigger fails head write after revision/registry insertion; counts, account counters and head remain unchanged | Pass |
| 11 | Immutable revision and graph protection | DB privileged UPDATE/DELETE attempts hit triggers; runtime late identity association rejected | Pass |
| 12 | Cursor discovers subsequent old-action changes without skips | DB Waiting→Superseded on an older action; one-row fixed-frontier pagination; uncommitted cursor invisible; second writer lock timeout and rollback | Pass |
| 13 | GET writes nothing | DB read-only role cannot provision state; actual GET before/after table/counter equality; HTTP read uses READ ONLY transaction | Pass |
| 14 | New runtime cannot mutate legacy tables | DB UPDATE User denied and INSERT/UPDATE/DELETE/TRUNCATE privilege checks on every legacy table | Pass |
| 15 | No activation/execution path | Transitive import-boundary test and exact route inventory; actual lifecycle POSTs receive method-not-allowed | Pass |
| 16 | Browser loop works | Installed Edge against actual local Next server: create, explicit reorder, full-page reload by plan ID, competing server edit, clear stale browser error; no page errors | Pass |

Additional DB assertions cover monotonic tombstones, original retry outcomes after tombstoning, no resurrection, unsupported dependencies, migration reapplication, and independent account state. Additional policy tests cover finite but incomplete drafts, strict measurement combinations and zero meaning, stage reassignment, exact reorders, same-action remove/reintroduce rejection, and development/hosted gating.

## Repository checks

- Prisma generation: passed using the worktree's own local dependency copy.
- Focused Trainer2 and write-pause tests: 21 passed (four files).
- `npm run test:verify-gate`: passed, including full lint, TypeScript, 86 fast tests, 55 completed-review tests, 13 version tests, catalog invariants, contracts and static mutation/write-pause checks.
- Environment/command classification: passed via the canonical npm package command, 212 passed and one platform-conditional skip across five files.
- `git diff --cached --check`: passed; all three archived source hashes still match their supplied authorities.
- Production build: passed in the final disposable-harness run. The initial credential-free build compiled and type-checked, then stopped at the existing legacy history route's required `DATABASE_URL`; the harness supplied only its own disposable runtime target.
- Full credential-free inventory and release/provider checks were not required or run. The focused new suites are explicitly included in the credential-free inventory classification; the mutating harness is a separately confirmed registered command.

The hardcoded inventory counts and write-route count were updated for the two new test files and two classified POSTs. A direct Vitest invocation of the existing preflight suite lacked npm's `npm_execpath`; the canonical npm package command is used for the final run. No baseline failure is claimed from that invocation mistake.

Final PostgreSQL/browser/build run completed at `2026-09-10T00:22:13.663Z` (September 9 local time). Tested migration SHA-256: `d0bc8731ea9ed8fc8d145774429e604d1fe827db1ee553b3c7d82b55258a677b`. The harness retained its sanitized result at `artifacts/trainer2/verification.json` and screenshot at `artifacts/trainer2/draft-loop.png`; these local artifacts are intentionally ignored by Git.

## Limits and next work

All 16 draft claims are exercised locally. This does not verify actual hosted authentication, provider grants/RLS defaults, production rollout or full offline recovery. Hosted access remains disabled. Historical import capture semantics are documented only; execution/import tables do not exist.

Remaining Phase 0 work is listed in [DRAFT_SLICE.md](DRAFT_SLICE.md#verification-and-remaining-work): hosted identity qualification, source artifact inventory/era classification, read-only legacy adapter and discrepancy dry-run fixtures. Recommended next bounded slice is that read-only source/provenance foundation. This draft slice does not complete Phase 0 or authorize execution work.
