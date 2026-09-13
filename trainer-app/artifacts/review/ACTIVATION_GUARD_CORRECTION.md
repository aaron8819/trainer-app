# Trainer2 activation guard correction — R1

Ready for focused independent re-review of **R1 — new registry entries break the required command-guard gate** (P2). This correction does not grant activation acceptance. Local activation review remains pending; earlier accepted reviews remain closed.

## Coordinates and scope

- Correction branch: `codex/trainer2-activation-guard-correction`.
- Isolated root: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-activation-guard-correction`.
- Parent: `codex/trainer2-local-activation`, commit `ca6743eeba01179aaf484c6e52be277dc072a0a5`, tree `ba4a1337b6d4868ccab11650c6189a11e22803e3`.
- Accepted pre-activation ancestor: `5865cb9dec901d55a9c0afdad1ea397dd1b7347e`, tree `489d23475a3a5a1c8da85a2b4cf50a1461610619`.
- Branch tips, trees, ancestry, original clean statuses, worktree registration and absent destination/branch were checked before creation. Final commit/tree and evidence hashes are recorded after commit in [FINAL_BINDING.json](FINAL_BINDING.json), avoiding a self-referential commit hash.

Only two explicit entries in `src/lib/operations/test-environment-preflight.test.ts`, five lines in `docs/06_TESTING.md`, and this report change. Registry metadata, command implementations, activation runtime, schema, persistence, concurrency, admission and browser recovery remain byte-equivalent in Git to the activation candidate.

## Root cause and entry-by-entry review

The guard test walks every registry entry classified `disposable-database-write`. It requires an explicitly approved exact-parser entrypoint, approved guard-first package command, or exact approved alias. Neither new launcher has a packageScript. Both were missing from `exactConfirmationEntrypoints`, so the first (progression-review) failed before the loop reached activation. The defect is allowlist drift; no registry classification or runtime guard defect was found.

| Registry entry | Actual implementation and classification | Required coverage and allowlist decision |
| --- | --- | --- |
| `test-trainer2-progression-review` | `scripts/test-trainer2-progression-review.ts:1-11` parses exactly the explicit argument and validates inherited targets before dynamically importing `scripts/trainer2/verify-drafts.ts`. Calls `verifyDrafts({ progressionReview: true })`, which provisions disposable PostgreSQL, performs synthetic writes and browser work via `verify-progression-review.ts`, and cleans up owned resources in `finally`. Executable command; correctly `disposable-database-write`, despite “review” in its name. | Add the exact launcher path. It must satisfy the existing canonical-parser assertion and rejection of permissive confirmation checks. Shared parser/target guard tests, registry validator and retained PostgreSQL/browser evidence cover its other boundaries. Confirmation stays operator-supplied; no package alias or exemption applies. |
| `test-trainer2-activation` | `scripts/test-trainer2-activation.ts:1-11` has the same exact argument and inherited-target guards before import. Calls `verifyDrafts({ activation: true })`, which delegates to `verify-activation.ts` and `verify-activation-upgrade.ts`, exercising disposable schema/data/browser work and owned cleanup. Executable command; correctly `disposable-database-write`. | Add the exact launcher path under the same parser assertions. Keep the existing mutation profile, confirmation escalation and cleanup contract. Reuse independently reviewed activation, upgrade, role and concurrency evidence because all those implementations are unchanged. |

These are the only new command registrations relative to the accepted base (125 to 127 commands). Imported helpers under `scripts/trainer2/` are library implementations, not newly registered commands or standalone CLI routes; they remain outside this entrypoint allowlist. No non-command was promoted, guarded command downgraded, registry ignore added, wildcard introduced, test skipped, or expectation derived from registry contents. Unknown disposable entries still hit the failing fallback.

## Why prior verification missed R1

The originating `activation-evidence/qualified-check-receipts.json` lists focused activation tests, TypeScript, lint, fast, contracts, preflight and whitespace; it does not list the environment-classification gate. The handoff separately reports 107/108 root tooling tests, then a registry-only correction rerun (1/1). The retained accepted-base `registry-base.json` proves the progression launcher was already missing from registry coverage. Adding its metadata fixed that root validator, but did not exercise the app guard allowlist.

Both the originating `verification-plan-final.json` and independent review `verification-plan.json` select `npm-test-environment-classification` without a skip reason. This demonstrates an omitted required test and insufficient registry-only post-correction verification, not a selector defect or a stale passing result for this guard. No passing environment receipt is claimed. The testing guide now explicitly requires the environment gate alongside the registry validator for disposable-command registration, including late metadata-only corrections. Selection logic is unchanged.

## Reproduction, controls and verification

Commands below ran from this correction root's `trainer-app`. Each named `.json` receipt records executable, exact argument array, cwd, timestamps, exit status, parent commit/tree, complete tracked source SHA-256 manifest (LF-normalized), diff and log hash. Matching `.log` files preserve output. `run-check.cjs` is retained as the review-owned recorder. It sets `TRAINER_CREDENTIAL_FREE_TEST=1`; the fresh worktree contains no dotenv files or configured DB targets. Dependencies are a standalone exact-lock `npm ci --offline` installation (exit 0); local Prisma Client 7.3.0 generation is filesystem-only.

| Check / exact command | Result and evidence |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run src/lib/operations/test-environment-preflight.test.ts -t "keeps operator confirmation out" --maxWorkers=1` on unchanged candidate | Exit 1, R1 reproduced; `original-r1.json`, `original-r1.log`. Source manifest binds the unchanged candidate. |
| Same command after correction | Exit 0, 1 passed / 107 unselected; `corrected-guard.json`, `corrected-guard.log`. |
| Same command with isolated test-only unexpected registry fixture | Expected exit 1, specifically `review-unexpected-disposable must use an approved mutation guard route`; `negative-unexpected.json`, `negative-unexpected.log`. |
| `npm run test:environment-classification` after fixture restoration | Exit 1: 211 passed, 1 skipped, only the retained baseline inventory-count assertion fails (402 versus 393). Preflight/guard file: 107 passed, 1 existing Windows skip; `environment.json`, `environment.log`. |
| `pwsh -NoProfile -File ../scripts/codex/Test-TrainerCommandRegistry.ps1 -Json` | Exit 0; 127 commands, 84/84 package scripts; `registry.json`, `registry.log`. |
| `pwsh -NoProfile -File ../scripts/codex/tests/Run-Tests.ps1 -Filter "registry parses and covers committed command surfaces"` | Exit 0, 1/1; `root-registry.json`, `root-registry.log`. |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false` | Exit 0; `typescript.json`, `typescript.log`. |
| `npm run lint` | Exit 0, no warnings; `lint.json`, `lint.log`. |
| `npm run test:preflight` | Exit 0; standalone dependencies and compatible Prisma; `preflight.json`, `preflight.log`. |
| `node node_modules/prisma/build/index.js generate` | Exit 0; `prisma-generate.json`, `prisma-generate.log`. |
| `git diff --check` | Exit 0; `whitespace.json`, `whitespace.log`. |

The negative control injected one `policy.commandRegistry.push({ command: "review-unexpected-disposable", entrypoint: "trainer-app/scripts/review-unexpected-disposable.ts", profile: "disposable-database-write" })` into the test's in-memory fixture immediately before `registryByPackageScript`. Production registry and launchers were never mutated. The test bytes were saved and restored in `finally` before final verification. Its receipt preserves the exact temporary diff; final source binding confirms removal.

Accepted-base control is retained read-only in the originating independent review's `base-comparison.log`: the exact guard test passed at `5865cb9d` using the same dependency tree as that review's candidate run. The separate inventory test failed at 401 versus hard-coded 393; candidate inventory is 402 versus 393. This known baseline defect is outside R1 and is not silently fixed or called a successful gate.

`correction-plan.json` records `pwsh -NoProfile -File scripts/codex/Invoke-TrainerVerification.ps1 -BaseRef ca6743eeba01179aaf484c6e52be277dc072a0a5 -Json` from repository root, exit 0, no blockers: registry validator, environment classification and whitespace are the required correction gates. No expensive full credential-free inventory is selected. Root tooling's unchanged 107 tests and qualified fast/contracts evidence are reused; the directly affected registry test is rerun above.

## Reused independent evidence and limitations

Originating review root: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-local-activation-review/trainer-app/artifacts/review/`:

- `LOCAL_ACTIVATION_REVIEW.md`: authoritative R1 finding and independent runtime assessment.
- `evidence-integrity.json`: 29 artifact hashes and 1,369 manifest entries checked, source bound to candidate, no uncovered changes, only the declared registry metadata qualification.
- `first-run-verification.json`: completed activation behavior groups and accepted-base upgrade; the whole first run remains failed due to the documented review fixture error.
- `extra-run-verification.json`, `independent-results.json`: successful independent mixed prescription, Draft omission corpus and malformed-conflict extensions.
- `recovery-final-verification.json`, `recovery-results.json`: final permission, foreign-scope, pending-switch and exact-recovery probes.
- `cleanup.json`: independent review-owned resource cleanup.

Originating implementation evidence is retained at `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-local-activation/trainer-app/artifacts/trainer2/activation-evidence/`: `FINAL_BINDING.json`, `verification.json`, `qualified-check-receipts.json`, `registry-base.json`, `registry-final.json`, `registry-correction-test.log`, and `verification-plan-final.json`. `ACTIVATION_HANDOFF.md` remains unmodified. The final correction binding hashes the referenced evidence in place; ignored originating artifacts were inspected read-only.

No runtime/SQL/browser paths change, so no PostgreSQL, concurrency, browser, migration, hosted or production checks were rerun. The source allowlist test verifies canonical parser use, not every possible semantic guard implementation; existing parser/target tests and independent runtime evidence supply the other coverage. Local activation acceptance remains pending independent re-review, and the baseline inventory-count failure remains separately qualified.

## Cleanup and disposition

The temporary negative fixture is restored. No service, container, demo URL or database was accessed or changed. The user's demo and data, original worktrees, branches and all existing evidence are preserved. Only the correction worktree, its task-owned offline dependencies and ignored review evidence are retained. No cleanup of pre-existing resources, push, merge, deployment, admission change or workout execution occurred. The final local commit is clean; final coordinates and status are in `FINAL_BINDING.json`.
