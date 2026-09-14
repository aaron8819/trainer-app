# Trainer2 required test-inventory correction

Ready for focused independent verification of this inventory correction; this report does not grant independent activation acceptance.

## Coordinates and root cause

Branch: `codex/trainer2-test-inventory-correction`. Base: `codex/trainer2-activation-guard-correction`, commit `e7c89280a36e94f84c8c7406b19246a0ba1b28dc`, tree `22e9ae7ef48a8571baaacb2f6dcd8f7a3282bbe7`. Exact coordinates, clean source worktrees, destination absence and branch absence were checked before creating this isolated worktree. Final commit/tree are recorded after commit in [FINAL_BINDING.json](FINAL_BINDING.json).

The fixed expectations in `src/lib/operations/test-suite-environment-classification.test.ts` were last updated by `3dc23f5978ec27af8cb1f76a8c400a589bc0f20b` (editable Draft template). Its Git tree contains exactly 393 Vitest files, including 354 default credential-free files. Subsequent commits added nine legitimate tests without updating either expectation. No discovery or environment-classification defect was found. The unchanged requested base reproduces the exact 393/402 assertion failure: [initial receipt](initial-inventory.json), [log](initial-inventory.log). This expected failure is not a passing verification receipt.

## File reconciliation and execution ownership

[Exact inventory](inventory.json) retains both complete Git inventories, the filesystem inventory, all 402 file classifications and introducing commits, and intervening addition/removal history. A rename-aware endpoint diff and intervening history show **nine additions, zero removals, zero renames**. Existing test edits do not affect the count. Five existing files changed: `DraftEditor.test.tsx`, `DraftWorkbench.test.tsx`, `isolation.test.ts`, `plan-builder.test.ts`, and the command-guard `test-environment-preflight.test.ts`; their classifications and routing remain unchanged. The explicit exception manifest is byte-identical across the historical and requested bases.

All paths below are relative to `trainer-app/`. Every row is credential-free by the existing default selection rule, and every row is selected by `npm run test:inventory:credential-free` and its CI shard counterpart. The required CI aggregate proves exact union and DB exclusion. `npm test -- <path>` is the direct runner. These are Vitest suites, not disposable browser/PostgreSQL harnesses.

| Added file | Introducing commit | Purpose and actual environment |
| --- | --- | --- |
| `src/components/trainer2/DraftReview.test.tsx` | `5865cb9d` | Saved occurrence order, duplicate names, invalid identity/stage; React Testing Library and jsdom, fixture documents, no browser service. |
| `src/components/trainer2/ExercisePicker.test.tsx` | `33506396` | Focus restoration for connected/removed/disabled controls; jsdom with dialog method stubs, no browser service. |
| `src/lib/api/trainer2/read-review.test.ts` | `5865cb9d` | Complete revision/hash/document HTTP read boundary; in-process Request/Response and mocked access/principal/transaction objects, no HTTP listener or DB. |
| `src/lib/engine/trainer2/builder-corrections.test.ts` | `33506396` | Count reset/reduction, override relationships, repair, independent additions and summaries; pure authored-document fixtures. |
| `src/lib/engine/trainer2/instructions.test.ts` | `ca6743ee` | Exact instruction identity, plan/time scope, restrictions and exceptions; pure fixtures and explicit timestamps. |
| `src/lib/engine/trainer2/plan-review.test.ts` | `dc1648ff` | Versioned progression, historical absence, effective prescriptions and review issues; pure document fixtures. |
| `src/lib/engine/trainer2/review-response.test.ts` | `5865cb9d` | Complete runtime response bindings, missing fields, wrong context and content; fixture hashes and Node WebCrypto, no credential provider. |
| `src/lib/engine/trainer2/template-builder.test.ts` | `fe737412` | Populated template, inheritance, reset, destructive edits and catalog swaps; local catalog/document fixtures. |
| `src/lib/engine/trainer2/week-only-set-reduction.test.ts` | `b352dad6` | Independent authored set reduction, confirmation and stable surviving identity; pure edit/serialization fixtures. |

All nine executed successfully without DB targets or dotenv: **9 files / 132 tests passed, no skips** ([command receipt](added-tests.json)). Source imports/mocks and actual execution support the classification; names alone were not used. No new manifest exception is necessary.

The manifest's 34 import-only files retain their individual reasons and run in the guarded TEST-NET placeholder phase. Five DB suites retain explicit authorized routing: `active-plan-context.db.test.ts` to `test:db:multi-plan`; `save-workout/persistence.db.test.ts`, `workout-mutation.db.test.ts`, `finisher-service.db.test.ts`, and `finisher-library-service.db.test.ts` to `test:db:workout-mutations`. Both harness source file lists include their assigned files (`test-multi-plan-foundation-postgres.ts:430` and `test-workout-mutations-postgres.ts:563`). None is executed or counted as credential-free coverage here.

[Selection](selected-inventory.json) invokes the actual production validator and selector: no errors, **363 credential-free + 34 import-only + 5 DB-required = 402**. [Vitest files-only listing](vitest-list.log) independently matches all 402 filesystem/Git paths exactly. [Integrity checks](reconciliation-integrity.json) prove exact disjoint classification partition, all additions selected, zero normalized duplicates, no untracked/generated contamination, and no missing disk files. Discovery in the test and typed runner both walks `src` for `.test.ts`/`.test.tsx`, normalizes backslashes and sorts; Vitest's two include patterns match that scope. No legitimate file was omitted from its intended runner.

## Correction and retained controls

Only the two fixed literals change: total **393 to 402**, credential-free **354 to 363**. Import-only and DB counts, explicit membership assertions, validation, command reachability, discovery, registry, sanitizer, and runners are unchanged. The expected values remain independent fixed assertions, not lengths calculated from discovery. Testing guidance adds a short requirement to reconcile file deltas and environments before updating these counts.

[Negative controls](negative-controls.json) used only this task's isolated worktree, restoring original bytes in `finally` before final verification. Each command targets the real inventory test; each expected failure is separately retained with argv, source manifest, temporary tracked diff and log:

| Control | Expected result (all exit 1) | Evidence |
| --- | --- | --- |
| Add unexpected `src/inventory-negative.test.ts` | 403 versus 402 fixed total | [receipt](negative-unexpected.json) |
| Temporarily remove `instructions.test.ts` | 401 versus 402 fixed total | [receipt](negative-missing.json) |
| Set one exception environment to `unknown` | `registry-environment-invalid` | [receipt](negative-classification.json) |
| Add unregistered `src/inventory-negative.db.test.ts` | `unregistered-db-required-suite` before count comparison | [receipt](negative-unclassified-db.json) |

The count contract detects net additions/removals; it does not promise to identify arbitrary equal-count replacements. Existing explicit membership checks and CI released-base identity/union checks supply additional protections. No broader inventory redesign is introduced. The existing fixture tests also exercise stale manifest entries, conflicting classes, and missing/unauthorized DB command routes.

## Skip and applicable rule

The remaining Windows skip is **`classifies signal termination without exposing a stack`**, guarded by existing `it.skipIf(process.platform === "win32")` in `test-environment-preflight.test.ts:1060`. It requires POSIX-style child SIGTERM reporting; Windows self-termination does not provide the same signal/status contract. Its launcher branch treats signal or absent status as `typed-runner-terminated` and fails closed.

The package gate uses ordinary Vitest exit semantics, permitting explicit test skips while rejecting failures; there is no repository rule requiring zero individual skipped tests. `credential-free-inventory-sharding.ts` reconciles skipped counts and rejects failures/selection mismatches, rather than rejecting every individual skip. The testing guide's rejection of skipped CI inputs concerns whole component jobs, not this test. CI uses `ubuntu-latest`, where this predicate is false. Portable runner tests also exercise signal termination and missing reporter classification; they are rerun here. Thus no relevant new coverage gap is hidden, no skip was added or removed, and no POSIX signal subprocess execution is claimed on Windows.

## Final verification and evidence binding

All commands run from this worktree's `trainer-app` through [run.cjs](run.cjs), except its caller resides at repository root. Receipts retain exact argv/cwd, timestamps, exit statuses, HEAD/tree, LF-normalized SHA-256 tracked-source manifests, tracked diff and log hash. The recorder strips DB-target/credential/confirmation variables and sets `TRAINER_CREDENTIAL_FREE_TEST=1`. Standalone dependencies were installed with `npm ci --offline --ignore-scripts --no-audit --no-fund` (exit 0, 693 packages); local Prisma generation (exit 0) only generated client files. Node 24.12.0, Vitest 4.0.18, Prisma 7.3.0. No dotenv was copied.

| Final command | Result | Receipt |
| --- | --- | --- |
| `npm run test:environment-classification` | Exit 0; 5 files, 212 passed / 1 expected Windows skip; accepted command guard included | [environment-final.json](environment-final.json) |
| `vitest run src/lib/operations/credential-free-inventory-runner.test.ts --maxWorkers=1` | Exit 0; 25 passed, no skips | [runner-checks.json](runner-checks.json) |
| `tsc --noEmit --pretty false` | Exit 0 | [typescript.json](typescript.json) |
| `npm run lint` | Exit 0; no warnings | [lint.json](lint.json) |
| `pwsh -NoProfile -File ../scripts/codex/Test-TrainerCommandRegistry.ps1 -Json` | Exit 0; 127 commands, 84/84 package scripts | [registry.json](registry.json) |
| `pwsh -NoProfile -File ../scripts/codex/tests/Run-Tests.ps1 -Filter "registry parses and covers committed command surfaces"` | Exit 0; 1/1 passed | [root-registry.json](root-registry.json) |
| `npm run test:preflight` | Exit 0; standalone exact-lock dependencies, compatible generated client, DB targets absent | [preflight.json](preflight.json) |
| `pwsh -NoProfile -File ../scripts/codex/Invoke-TrainerVerification.ps1 -BaseRef e7c89280a36e94f84c8c7406b19246a0ba1b28dc -Json` | Exit 0, planning only; no blockers; classification, registry and whitespace required | [plan.json](plan.json) |
| `git diff --check e7c89280` | Exit 0 | [whitespace.json](whitespace.json) |

The final binding compares passing receipt source hashes with committed files; the new report is the only added source after those checks. The added-tests run precedes the two count/documentation edits; its nine test files and application dependencies remain identical. Selection was rerun after fixture restoration. The initial evidence helper reused a receipt/output filename and was corrected to write `selected-inventory.json`; the successful final selection and integrity outputs are the authoritative reconciliation artifacts. Initial and negative-control failures remain separate. Files excluded by `-t` are unselected tests, not additional platform skips. The full credential-free PR/release inventory and disposable suites are not claimed as executed; policy selects the focused environment-classification gate for this change, plus registry and whitespace. TypeScript, lint, affected runner tests and preflight are additionally rerun as requested.

## Reused independent evidence and scope

[Reconciliation integrity](reconciliation-integrity.json) re-hashes all 19 originating evidence references from the guard correction's `FINAL_BINDING.json`: zero mismatches. That binding hash equals the rereview's independently verified `7a3d1729f55450a99067a6a03ddcd353749cfe01d80f0eb02e4d1efd63511138`. The originating rereview integrity reports and their current hashes are retained, including its 47-artifact/10,969-source comparison and runtime 29-artifact comparison. Evidence was inspected in its originating worktree read-only.

Reuse the original `trainer2-local-activation-review/trainer-app/artifacts/review/` PostgreSQL/browser evidence: `extra-run-verification.json`, `independent-results.json`, `recovery-final-verification.json`, `recovery-results.json`, and `cleanup.json`, with the completed groups in the explicitly failed `first-run-verification.json`. The initial invalid-fixture and browser setup failures remain failures. The prior passed activation, lock/concurrency, immutable persistence, permission, upgrade and response-loss recovery assessments are not reopened or rewritten.

Git equality to the requested base confirms unchanged activation runtime, API, components, engine, contracts, schema/migrations, command registry, launchers and accepted guard tests. Only the inventory assertions, testing guidance and this new report change. No PostgreSQL/browser service was required or restarted. These results establish a corrected implementation gate ready for focused independent verification, not independent activation acceptance.

## Cleanup

All negative fixtures are restored or removed; no pre-existing worktree, branch, artifact, user demo or data was changed. Task-owned dependencies and ignored evidence remain in this worktree for review. No push, merge, deployment, hosted access, production action, admission change or workout execution occurred. V1 remains live, hosting paused, Phase 0 incomplete. Final local commit and clean status are recorded in `FINAL_BINDING.json`.
