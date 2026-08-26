# 06 Testing

Owner: Aaron
Last reviewed: 2026-07-26
Purpose: Canonical testing reference for Vitest-based coverage of engine, API helpers, and UI components, plus the Playwright UI audit harness.

This doc covers:
- Test runner configuration
- Standard test commands
- Contract drift checks included in verification

Invariants:
- `npm test` must run `vitest run` (non-watch).
- API/engine contract changes must include tests or updated assertions.
- Contract drift check must pass when enum contracts change.

Sources of truth:
- `trainer-app/package.json`
- `.github/workflows/credential-free-inventory.yml`
- `trainer-app/vitest.config.ts`
- `trainer-app/src/**/*.test.ts`
- `trainer-app/src/**/*.test.tsx`
- `trainer-app/scripts/check-doc-runtime-contracts.ts`

## Commands

- `npm run test:db:multi-plan -- --confirm-disposable`: provisions an isolated PostgreSQL 16 container; applies the full prior migration chain; verifies the active-plan foundation plus plan-management metadata migration, ambiguity rollback, deterministic name backfill, target schema objects, and the old-app handoff ordering risk; then runs partial-unique, READY-only selection, in-progress-workout blocking, finalization-without-selection, optimistic rename/archive, history preservation, and concurrent compare-and-swap coverage. It is database-mutating and must only run with the exact disposable-target confirmation.
- Focused credential-free plan-management coverage: `npm run test -- src/lib/api/plan-management.test.ts src/lib/validation.plan-management.test.ts src/lib/api/active-plan-context.test.ts src/app/api/plans/[id]/activate/route.test.ts src/components/plans/PlanManagementClient.test.tsx src/components/navigation/AppNavigation.test.tsx src/lib/api/workout-mutation.test.ts src/lib/workout-workflow.test.ts src/lib/ui/workout-list-items.test.ts`.
- Focused Strength coverage: `npm run test -- src/lib/plan-types.test.ts src/lib/engine/strength-plan-policy.test.ts src/lib/engine/strength-session-timing.test.ts src/lib/engine/prescription.correctness.test.ts src/lib/engine/periodization.correctness.test.ts src/lib/engine/apply-loads.correctness.test.ts src/lib/api/plan-management.test.ts src/lib/api/active-plan-context.test.ts src/lib/api/mesocycle-lifecycle.test.ts src/lib/api/template-session/context-loader.test.ts src/lib/api/template-session.test.ts src/lib/validation.plan-management.test.ts src/components/plans/PlanManagementClient.test.tsx src/components/HistoryClient.test.tsx`. This protects deterministic policy output, controlled limitation canonicalization/fail-closed behavior, the full duration/frequency/experience/emphasis/equipment matrix, shared planner/runtime timing and five-minute rounding boundaries, immutable executable seed normalization, exact review set counts, plan-type generation and terminal dispatch, lower-rep/longer-rest prescriptions, conservative shared progression, selected-plan enforcement, review/finalization, and Hypertrophy compatibility.
- `npm run test:preflight`: sanitized, dependency-free launcher plus typed capability report.
  It performs no database connection or Docker daemon probe. It reports the dependency
  arrangement, resolved-install validation, generated Prisma Client compatibility, every
  registered DB-target variable, Docker CLI presence through `docker --version`, and
  runnable/blocked/separate groups. It never prints environment values, URLs, credentials, query
  parameters, database names, or hostnames.
- `npm run test:verify-gate`: the selective repository verification matrix currently implemented
  by `npm run verify`. It strips every recognized DB-target variable and prevents Vitest from
  loading `.env.local`/`.env`. It is a useful local gate, but it is not a comprehensive inventory
  of all credential-free Vitest files.
- `npm test`: raw `vitest run` inventory and focused-test entrypoint. It intentionally preserves
  ordinary Vitest environment behavior, including `.env.local`/`.env` loading, so it may expose
  environment-coupled collection failures. It is diagnostic, not the authoritative
  credential-free gate. Direct collection of mutation-capable DB test files suppresses dotenv
  loading and runs the disposable-target guard before importing Prisma, `pg`, database helpers, or
  mutation implementations. With no target the workout-mutation suite fails with the deliberate
  infrastructure classification while the persistence-only suite safely skips; unsafe or
  unconfirmed targets fail before database-dependent imports.
- `npm run test:inventory:credential-free`: classified full Vitest inventory with `DATABASE_URL`,
  `TEST_DATABASE_URL`, `DIRECT_URL`, `SHADOW_DATABASE_URL`, and `SHADOW_URL` removed from child
  environments case-insensitively, mutation confirmation removed, and dotenv loading disabled.
  Credential-free files must collect, import, and execute with no DB target. Registered
  import-only placeholder files run in a separate phase with the exact reserved TEST-NET URL and
  a socket connection guard. Registered DB-required suites are excluded before Vitest collection,
  listed with their owner, reason, and separate authorized command, and are never reported as
  credential-free coverage. Any unregistered import or collection failure remains fatal. Each
  phase uses one worker and emits Vitest's concise native dot progress plus phase/total elapsed time. The built-in
  JSON reporter shares the captured stdout pipe; the parent extracts its final record after streaming redaction
  and persists only that redacted record as the retained reporter. The dependency-free launcher identifies
  recognized sensitive parent values, sends those values to the typed orchestrator through stdin for redaction,
  and does not persist them or place them in the child environment. Inventory subprocesses, including Vitest children, receive
  an explicit allowlist of platform, temporary-directory, locale, terminal, Node test-mode, and CI context
  variables rather than the arbitrary parent environment. Database/mutation authorization, tokens, cookies,
  authorization values, deployment credentials, and common secret-bearing variables are excluded
  case-insensitively. Known sensitive values from the parent environment are also redacted from streamed output,
  retained captures, reporter-derived messages, metadata, and terminal summaries before those outputs are kept.
- `npm run test:inventory:credential-free -- --base-ref <git-ref>`: runs the same inventory and
  reports added, removed, and changed environment classifications relative to the named base.
  Equal branch/base failures are not accepted; only explicit classifications can compare cleanly.
- `npm run test:environment-classification`: focused manifest, sanitizer, placeholder-guard,
  subprocess-boundary, exact-lock integrity, summary-count, and branch/base-delta coverage. The
  recursive database-target source inventory test alone has a
  60-second timeout because the demonstrated Windows filesystem traversal exceeded Vitest's
  inherited default; the global Vitest timeout is unchanged.
- `src/lib/operations/credential-free-inventory-runner.test.ts`: focused success cleanup, failure
  retention, reporter parsing, subprocess classification, unique/path-safe naming, complete redacted
  capture, and concise failure-summary coverage.
- `npm run test:seed-revision-concurrency -- --confirm-disposable`: against a local disposable PostgreSQL database, verifies one-winner concurrent correction, generation/correction revision preservation, and full rollback after a failed correction. The command refuses non-local or unconfirmed targets.
- `npm run test:db:workout-mutations -- --confirm-disposable`: explicitly mutating integration
  coverage. Its effective argument list must be exactly `["--confirm-disposable"]`; unknown,
  duplicate, misspelled, positional, conflicting, and embedded variants exit `2` before Docker or
  database work. The valid command creates its own disposable PostgreSQL 17 target,
  strips inherited DB-target variables before supplying the generated target, validates the
  canonical target inventory, applies the checked-in migration chain, and verifies main-save CAS,
  runtime mutation races, exact stimulus snapshot persistence, and immutable review-snapshot
  storage without `db push` or `.env.local`. Finisher coverage first injects a
  failure after partial target-migration work and proves full transaction
  rollback; then it verifies fresh-database curated provisioning without the
  broad seed, a safe second `migrate deploy`, transactionally sealed catalog
  definitions, rejection of post-seal child insert/update/delete/reassignment
  (including bulk operations), relationally finalized offers and exact
  cross-version-safe execution prescriptions, exact composite
  execution/offer/item/workout/owner binding, rejection of mismatched and
  concurrent direct/Prisma construction, historical owner-transfer and
  parent-deletion protection, a migrated-database-to-Prisma SQL diff that fails
  on destructive protected relationship changes while naming the three
  supported database-only simple foreign keys, conventional migration and
  runtime database identity, absence of custom Finisher roles, database-clock
  creation with deliberately skewed application clocks, direct-database rejection of
  post-finalization append/reorder/reassignment/delete, durable
  offer/decline/dismissal history,
  receipt-safe retries for every existing-execution command, exact
  command-response HTTP replay after later state, exact-boundary receipt
  expiration, permanent command update/delete tombstones, constrained
  before/at/after-expiry cleanup, deferred terminal parent/child outcome
  coherence from both mutation paths, original all-pending completion,
  partial/skip/dismissal contradiction, mixed transaction, direct SQL, bulk,
  rollback-preservation, and parent/child race attacks, bounded concurrent payload cleanup,
  execution-identity ABA isolation, and projected-versus-persisted completed,
  mixed, all-skipped, preparation-only, retained-work, and substitution
  outcomes, plus workout-deletion protection. After the DB suites, it runs the
  ordinary development seed and proves pure numeric step and alternative order
  drift fails without rewriting immutable catalog rows.
- The same disposable PostgreSQL 17 command applies
  `20260803120000_add_finisher_management`, runs
  `src/lib/api/finisher-library-service.db.test.ts`, and covers default-active
  materialization, personal ordering/picker integration, owner isolation, CAS,
  immutable N+1/frozen-history behavior, system/active-execution delete guards,
  displayed-version-bound duplication, database owner-aligned overlay identity,
  rejected reorder rollback, completed-history rendering after logical deletion,
  and finalized zero-item offers. It remains unavailable unless the local Docker
  daemon is running.
- Focused credential-free Finisher management coverage:
  `npm run test -- src/lib/validation.finisher-library.test.ts src/app/api/finishers/route.test.ts src/app/settings/page.test.tsx src/components/finishers/FinisherLibraryClient.test.tsx src/components/finishers/FinisherRoutineEditor.test.tsx src/components/finishers/FinisherExperience.test.tsx`.
- `npm run test:db:historical-snapshots -- --confirm-disposable`: explicit schema-dependent
  historical-evidence alias for the same consolidated disposable harness.
- `npm run test:db:readiness-snapshots -- --confirm-disposable`: starts an isolated Docker PostgreSQL 16 container, applies all checked-in migrations without reading `.env.local`, verifies legacy-unknown migration behavior, partial unique enforcement, identical concurrent activation, conflicting payload rejection, forced replacement rollback, stale-evidence rejection, and owner isolation, then removes the container. Package scripts never supply disposable confirmation: the operator must type it for every mutating invocation, and aliases or wrappers must not embed it. Strict argument and inherited-target validation complete before `pg` or any other database-dependent module loads and before Docker work begins.
- `npm run test:db:rollout-tooling -- --confirm-disposable`: runs generic migration-integrity integration coverage against a harness-created disposable PostgreSQL target. Its effective argument list must be exactly `["--confirm-disposable"]`; additional, duplicate, positional, misspelled, embedded, or malformed arguments are rejected before Docker or database-dependent loading. It verifies clean pending and fully applied migration chains plus ledger, checksum, ordering, schema, and uniqueness drift without loading a configured environment or authorizing execution.
- `npm run verify:finisher-schema-drift`: read-only Prisma SQL diff from an
  explicitly supplied fully migrated disposable PostgreSQL database to the
  canonical Prisma schema. Its normalized statement-level allowlist accepts and
  reports only the exact three overlapping simple foreign-key drops retained as
  supported database-only extensions. Every other executable statement fails
  closed, including unrelated additive/destructive drift, missing protected
  relationships proposed as restrictive additions, supporting-uniqueness
  changes, and malformed or unrecognized SQL. Credential-free CI exercises the
  pure normalized-diff contract tests; the disposable workout-mutation harness
  exercises the live migrated database comparison.
- Immutable seed changes require focused revision/receipt/save/runtime/audit tests, `npm run verify:contracts`, `npm run verify`, and a real `prisma migrate deploy` on disposable PostgreSQL.
- `npm run lint`: ESLint with cache at `.eslintcache`; generated/local-only outputs such as `artifacts/`, `.tmp/`, `.vercel/`, `output/`, `playwright-report/`, and `test-results/` are ignored by ESLint
- `npm run test:ui-audit`: Playwright core-route UI audit plus lightweight fixture-backed interaction checks against mobile and desktop projects
- `npm run test:ui-audit:update`: update Playwright baseline screenshots after an intentional visual/UI baseline change
- `npm run test:watch`: watch mode
- `npm run test:fast`: focused fast subset
- `npm run test:slow`: slow simulation suite opt-in
- `npm run test:audit:matrix`: workout-audit diagnostics matrix regression sweep across canonical `future-week` flows (`derived next-session context` + `explicit intent`)
- `npm run test -- src/lib/audit/workout-audit/bundle.test.ts`: focused split-sanity audit summary/verdict coverage
- `npm run test -- src/lib/audit/workout-audit/scenario-audits.test.ts`: focused sequencing/accounting audit coverage
- `npm run test -- src/lib/audit/workout-audit/week-close-handoff.test.ts`: focused week-close handoff and historical mixed-contract detector coverage
- `npm run verify`: lint + type-check (`tsc --noEmit`) + `test:fast` + contract verification + completed-review matrix + version endpoint/verification tests + static mutation/write-gate checks
- `npm run verify:completed-review`: canonical DTO/loader + immediate API/component + shared card + reopened workout-page matrix; this is included in `npm run verify`
- `npm run verify:version`: deployment-version resolver + `/api/version` route + mocked-network production-verifier tests; this is included in `npm run verify`
- `npm run verify:production-version -- --base-url <https-origin> --expected-sha <full-git-sha>`: explicit read-only live production evidence; never included in local `npm run verify`
- `npm run verify:contracts`: docs/runtime enum drift check
- Owner-scoped audit commands accept `--env-file .env.local --owner owner@local` so local audit scripts can load the intended runtime environment explicitly

## Pull-request credential-free gate

Every pull request targeting `master` runs the `credential-free-inventory` GitHub Actions check
from `.github/workflows/credential-free-inventory.yml`. The workflow checks out full Git history,
uses Node.js 22, fixes `TZ` to `America/Chicago` for the repository's local-week test semantics,
installs the exact lockfile with `npm ci`, and delegates all classification and execution behavior
to the canonical command. The check remains required by the active `Protect master` ruleset and
runs the full inventory once per PR candidate tree. The runner keeps each Vitest phase at one worker so the full
jsdom/happy-dom inventory stays within hosted-runner memory. It streams Vitest's native dot reporter
for basic progress while extracting the built-in JSON reporter from the redacted stdout pipe, reports phase and total
elapsed time, emits a structured final summary, and always writes
`artifacts/credential-free-inventory/evidence/credential-free-inventory-evidence.json`.
The GitHub job summary exposes the tested tree, commit/PR/merge-ref distinction, counts, timing,
import-safety result, definition/classification/lockfile hashes, qualification, and run URL. CI
uploads the small JSON artifact for 30 days under an unambiguous name containing the exact tree,
run ID, and attempt. Successful phases still remove large disposable captures. Failed phases retain
complete redacted stdout, stderr, reporter output when present, and failure metadata under
`artifacts/credential-free-inventory/<unique-run>/`; CI uploads that diagnostic bundle separately
for seven days.

```text
npm run test:inventory:credential-free -- --base-ref origin/master
```

The gate proves that every unclassified suite runs credential-free, every registered import-only
suite runs with the exact guarded TEST-NET placeholder and no socket attempt, every registered
DB-required suite is excluded before Vitest collection, the manifest is valid, and unexpected
collection, setup, import, test, subprocess, or result-parsing failures remain fatal. It prints the
selected and passed file/test counts, skipped counts, both DB exclusions and their authorized
  command, placeholder safeguards, the manifest delta against `origin/master`, and the failing
  file/test whenever Vitest reports that identity. Missing or malformed reporter output, test
  timeouts, signals/worker termination, dependency-readiness failures, and generic nonzero exits
  remain distinct failure classes; no failed-test identity is invented when the reporter omits it.

Failure bundles are restricted diagnostic material. The runner blocks arbitrary inherited credentials and
redacts exact sensitive parent-environment values of at least eight characters, but it cannot identify every
possible application secret embedded independently in test fixtures or generated output. Review and share a
bundle accordingly. The runner does not give Vitest an output-file path: reporter output crosses the subprocess
pipe, is value-redacted in the parent, and only then is written to captures or the retained reporter file.
Artifact creation, capture, reporter-read, metadata-write, and cleanup errors are
reported as secondary diagnostics without replacing a primary assertion, timeout, signal, safety-guard, or
subprocess failure. When artifact I/O fails, the runner retains whatever safe partial evidence exists and prints
a fallback terminal summary; a cleanup failure turns an otherwise successful phase into an explicit artifact
failure. Recovery is to inspect the primary failure first, then correct the named local filesystem/permission
problem and rerun the same command. Do not repair dependencies or broaden timeouts as an artifact workaround.

Worker benchmarking, worker tuning, change-aware selection, dependency sharing, classification-only
preflight, and broader verification optimization remain deferred. Reopen them only if normal workflow
evidence continues to demonstrate material pain.

The gate does not run or claim disposable PostgreSQL coverage. These suites remain separately
authorized:

- `src/lib/api/workout-mutation.db.test.ts`
- `src/lib/api/save-workout/persistence.db.test.ts`

Run them only with `npm run test:db:workout-mutations -- --confirm-disposable` against the
harness-created disposable target. Pull-request CI has no database secrets, does not invoke that
command, and does not represent the exclusion as a successful DB test.

Manifest changes are reviewed as contract changes. The CI command validates current entries first,
then reports additions, removals, and changes relative to `origin/master`; an unavailable or
malformed base manifest fails closed. Reproduce a different comparison locally by replacing
`origin/master` with another existing Git ref. Classification errors identify the invalid path or
command; Vitest output identifies collection, setup, import, and test failures; the final summary
separately identifies nonzero phases and malformed results.

The workflow creates the stable `credential-free-inventory` check. The active `Protect master`
ruleset requires that exact status check for pull requests targeting `master`.

### Exact-tree evidence reuse

`scripts/codex/trainer-policy.v1.json` owns the stage, invalidation, reuse, and qualification policy.
`src/lib/operations/exact-tree-verification-evidence.ts` implements the evidence schema, deterministic
hashes, job summary, repository-state inspection, untrusted-artifact validation, and reuse decision.
Repository-owned definition inputs, `package-lock.json`, and the classification source are read from `HEAD:<path>` Git blobs;
checkout line-ending conversion never changes their hashes, and missing Git metadata or required
blobs fails closed. Definition input paths are normalized, sorted, and unique. Classification hashing canonicalizes the semantic
contents of `scripts/test-suite-environments.json`; incidental suite ordering does not change it.
The verification-definition hash covers the policy-selected workflow, package-script composition,
launcher/orchestrator, runner, preflight/classifier, Vitest config and setup/guard files, relevant
command-registry entries, Node major, worker count, and lockfile identity.

The dependency-free launcher keeps an explicit environment allowlist. For evidence publication it
passes only `GITHUB_ACTIONS`, `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_JOB`, `GITHUB_REF`,
`GITHUB_REPOSITORY`, `GITHUB_RUN_ATTEMPT`, `GITHUB_RUN_ID`, `GITHUB_SERVER_URL`, `GITHUB_SHA`,
`GITHUB_STEP_SUMMARY`, and `GITHUB_WORKFLOW` in addition to the pre-existing platform/runtime
essentials. It does not pass `GITHUB_TOKEN`, `GH_TOKEN`, GitHub API endpoints, head/base branch-name
convenience variables, arbitrary `GITHUB_*` values, database targets, deployment tokens, or the
arbitrary parent environment. The event payload is read only for pull-request head SHA, base SHA,
and base ref; SHA formats and Git resolvability are checked, and Git `HEAD`/`HEAD^{tree}` remain the
tested-content authority. `baseSha` means the pull request's base-tip commit from the GitHub event,
not the base branch name, merge base, or a local `origin/master` guess. The run URL is derived only
from a validated HTTPS `GITHUB_SERVER_URL` origin, `GITHUB_REPOSITORY`, and numeric `GITHUB_RUN_ID`.
GitHub Actions PR evidence fails closed when required run/PR context is incomplete, and publication
also fails when the Actions job-summary destination is unavailable. Local evidence may omit GitHub
identity and the summary destination, but it cannot satisfy durable PR evidence reuse.

Before running an expensive hermetic check, derive the current consumer commit, `HEAD^{tree}`, and
cleanliness with Git, then compare the tree with the artifact's `treeSha`. Reuse requires both the
historical producer checkout and current consumer checkout to be clean, durable CI run identity,
schema/coherence-valid evidence, compatible Node/Vitest/worker semantics, matching definition,
classification, and lockfile hashes, plus an allowed successful status. Consumer cleanliness uses
porcelain status with untracked files included and ignored files excluded: tracked, staged, and
untracked source/config/test changes invalidate reuse; ignored caches and artifacts do not. A different commit SHA does not invalidate evidence when its tree is exactly
equal; PR head, merge ref, and released commit remain separately recorded and tree equality is never
inferred from ancestry. A new agent/reviewer session, stale local refs, or elapsed time do not
invalidate immutable-tree evidence. A dirty producer or consumer checkout, malformed or contradictory
evidence, missing CI identity, missing/incomplete evidence, an incompatible toolchain, a different tree
or hash, a failed run, a disallowed qualification, or a non-hermetic check does. Producer OS,
architecture, runner image, and timezone remain descriptive and do not require an equal consumer OS.

Reusable checks include credential-free inventory, import-only safety, TypeScript, lint, contracts,
static invariants, and deterministic credential-free unit/integration suites when their exact
definition is represented. Tree evidence alone never satisfies production `/api/version`, public
health, Vercel deployment state, live external APIs, remote database state, live audits, or deployment
mechanics.

To discover credential-free evidence for tree `T`, inspect the PR check summary or list workflow-run
artifacts whose name begins `credential-free-inventory-evidence-tree-T-`; the job summary prints the
exact uploaded artifact name. Validate the downloaded JSON
with the policy rules before reuse. If the approved PR tree, released tree, and evidence tree are all
`T` and every definition input remains equal, release review consumes the CI evidence instead of
rerunning the inventory locally. Release still independently verifies exact tree equality, merge and
deployment state, production version/availability, and other external-state gates.

### Isolated timeout qualification

One timeout in exactly one file/test is eligible for one targeted retry only when both reporters are
complete enough to prove every other selected file ran, the process did not terminate abnormally,
no credential/import-socket/classification safety failure occurred, and the tree is unchanged. Retry
that exact file/test once under the same credential-free environment and verification definition. A
passing retry can be represented as `qualified_pass` while retaining the original timeout and retry evidence;
it does not require a second full inventory. A failed retry blocks. Assertions, incomplete reporters,
worker crashes, and safety failures are never qualified. The same test qualifying twice (including
two consecutive candidate runs) blocks and requires a flake fix. Retry eligibility and the evidence
schema are implemented policy; automatic targeted retry orchestration and recurrence storage are not.
Until that orchestration exists, `qualified_pass` may be produced only through the documented/manual
CI process when supported, with the original failure and unchanged-tree retry evidence supplied explicitly.

## Test-environment safety contract

- Test-suite environment ownership is declared once in
  `scripts/test-suite-environments.json`. Files not listed there are credential-free by default.
  A credential-free suite must collect, import, and execute with every registered DB target
  absent; importing the real DB composition root is therefore a hard failure.
- A `.db.test.ts(x)` file is DB-required and must have one manifest entry naming an existing
  `disposable-database-write` command from the command registry. Missing files, duplicate or
  conflicting classes, non-test paths, unregistered `.db` suites, missing commands, and
  unauthorized command profiles fail before Vitest starts. DB-required suites excluded from the
  inventory remain reachable through the command printed from the registry; the credential-free
  summary never claims that coverage ran.
- Import-only placeholder is a narrow exception for a suite whose assertions are credential-free
  but whose current composition-root import needs a syntactically valid URL. It must be registered
  individually with a reason. The runner supplies only the exact reserved TEST-NET placeholder,
  keeps all other DB targets and disposable confirmation absent, and loads
  `vitest.import-only-placeholder.setup.ts`. That setup rejects any other URL and replaces socket
  connection startup with a fatal `IMPORT_ONLY_PLACEHOLDER_CONNECTION_ATTEMPT`. It also records
  the attempt in a temporary marker checked and removed by the parent runner, so even code that
  catches the thrown error cannot make the phase pass.
- Exclusions are path-based and occur before Vitest collection. The harness never filters by
  `DATABASE_URL` error text, so unrelated import, setup, collection, and test failures remain
  unexpected and fatal. To classify a new suite, first decide whether it is truly DB-required or
  only import-coupled, add one manifest entry when required, confirm its separate command profile,
  then run `npm run test:environment-classification`. The final PR candidate receives one new full
  credential-free CI run; do not repeatedly run it locally during implementation.

- Canonical DB-target inventory: `DATABASE_URL`, `TEST_DATABASE_URL`, `DIRECT_URL`,
  `SHADOW_DATABASE_URL`, and `SHADOW_URL`. A repository guard scans test workflow sources for
  database-like target variable names and fails when a reference is not registered.
- Only structurally valid `postgres:` and `postgresql:` URLs are classified. A hostname and
  database path are required. Malformed encoding, invalid ports, unsupported protocols, private
  IPs, remote DNS, Supabase/pooler hosts, `host.docker.internal`, and names merely containing
  `local` are rejected for disposable mutation coverage. Query parameters use an explicit
  non-routing allowlist; routing or identity overrides such as `host`, `hostaddr`, `port`,
  `database`, `dbname`, `service`, `servicefile`, and `sslhost`, duplicate keys, unknown keys,
  encoded key variants, and ambiguous multiple-`@` authorities are rejected.
- Loopback (`localhost`, `127.0.0.1`, or `[::1]`) is not proof that a database is disposable.
  Local tunnels, SSH forwards, proxies, and port forwards can terminate at a remote database.
  Mutation coverage additionally requires matching `DATABASE_URL` and `TEST_DATABASE_URL` plus
  exact `--confirm-disposable` operator attestation. Use that attestation only for a database the
  operator has independently established is disposable. Preflight validates without connecting.
- Every mutation command uses exact argument matching or an explicitly approved guard-first
  route. Additional or malformed confirmation arguments are rejected before Docker or
  database-dependent loading.
- Credential-free subprocesses enumerate actual environment keys and remove every casing variant
  and duplicate of the canonical DB-target names. They also remove
  `TRAINER_DISPOSABLE_DB_CONFIRMED`; inherited authorization can never make credential-free
  collection mutation-capable. The inventory subprocess additionally uses the restricted allowlist and
  value-redaction policy described above; arbitrary unrelated variables are not inherited.
- The dependency-free `.mjs` launcher exits `0` when requested checks pass, `1` for an
  environment/installation blocker, and `2` for an invalid invocation or malformed user
  configuration. Unknown flags are invalid. Repository/package metadata, lockfile, typed helper,
  dependency state, and the `tsx` launcher are checked before spawn; spawn errors, loader failure,
  signal termination, and null status produce stable sanitized diagnostics rather than raw loader
  stacks.
- Dependency arrangements are reported as standalone, Windows junction, Linux symlink, missing,
  or unresolved. A link is allowed only when it resolves to `node_modules` under a registered Git
  worktree and that worktree has the exact current lockfile hash; policy-external, stale,
  lock-incompatible, chained-outside-policy, and unresolved links are blocked. Installation
  validation runs from the resolved exact-lock project root, so npm traversal of the link itself
  is not treated as incompatibility proof. No machine-local path is committed. Dependency
  readiness does not treat a successful `npm ls --all` as exact-lock proof: it also compares the
  root lock, installed package metadata, and hidden `node_modules/.package-lock.json` entries for
  Vitest, coverage, Vite and its React plugin, tsx, happy-dom, Prisma CLI/client/adapter packages.
  Missing, malformed, or version-drifted critical metadata fails closed with package name, locked
  and installed versions, the failed integrity check, and trusted-runtime `npm ci` recovery
  guidance. Preflight never installs or repairs dependencies automatically.
- Prisma readiness is reported distinctly as dependencies missing, Prisma packages missing,
  generated client missing, generated client partial/corrupt, generated client stale, or
  compatible. “Compatible” means required package metadata, forwarders, declarations,
  runtime/query-compiler artifacts, and the complete minimum generated client are present; the
  checked-in/generated schemas match after formatting/comment normalization; and a non-connecting
  import exposes `PrismaClient` plus every expected model in Prisma DMMF metadata. Installed
  package versions or forwarder files alone are insufficient. Informational preflight never runs
  `prisma generate`.
- Docker capability means CLI presence only (`docker --version`). Daemon readiness belongs to an
  explicit disposable harness and is never probed by preflight.
- Reports distinguish runnable/passed work from blocked infrastructure and explicitly separate
  suites. A skipped DB test in credential-free inventory is not reported as passed DB coverage;
  commands not invoked must be reported as not run.

## Scope
- Engine tests: `src/lib/engine/**/*.test.ts`
- API helper tests: `src/lib/api/**/*.test.ts`
- UI tests: component tests under `src/components/**`
- Playwright UI audit tests: `tests/ui-audit/**/*.spec.ts`, with flat baseline screenshots named `<route>.<viewport>.<state>.png` under `tests/ui-audit/__screenshots__/`; the same harness also includes minimal fixture-backed interaction checks for the log screen and swap sheet.
- Workout log UI regressions are covered in `src/components/LogWorkoutClient.test.tsx`, including all-skipped completion routing, timer resume/remount behavior, queue-chip targeting, queue-row scroll neutrality, skipped terminal state copy/actions, and reduced mobile edit-state chrome.
- Timer/session-layout hook coverage lives in `src/components/log-workout/useRestTimerState.test.tsx` and `src/components/log-workout/useWorkoutSessionLayout.test.tsx`, covering visibility-return timer re-sync and explicit-only scroll correction.
- UI session summary-model coverage: `src/lib/ui/session-summary.test.ts` (receipt-first summary text/tags/items, including deload, soreness hold, and readiness-scaling cases).
- Mutation-aware summary truth-label coverage: `src/lib/ui/session-summary.test.ts` also asserts that drifted workouts are relabeled as `Original plan context` and expose a truth-boundary note.
- Save-route terminal transition coverage (including status-machine behavior through route boundary): `src/app/api/workouts/save/route.integration.test.ts`
- Planned alternative-session coverage spans `src/lib/api/next-session.test.ts`, `src/lib/api/program.test.ts`, `src/lib/api/template-session.test.ts`, `src/app/api/workouts/generate-from-intent/route.test.ts`, `src/app/api/workouts/save/route.integration.test.ts`, and `src/components/IntentWorkoutCard.test.tsx`. Combined Strength cases protect ordered eligible discovery, exact off-order `slotId` submission, accepted-revision exercise/role/set replay, Strength prescription and exact receipt provenance, stale/completed/incomplete exclusion, unchanged schedule order, idempotent single-slot completion, next-slot recommendation, and the compact Home chooser interaction. Existing Hypertrophy cases remain in the same suite.
- Validation/status coverage: `src/lib/validation.workout-save.test.ts`, `src/lib/validation.test.ts`, `src/lib/api/exercise-history.test.ts`, `src/lib/api/readiness.test.ts`
- Exercise-history coverage: `src/lib/api/exercise-history.test.ts` protects exact-ID performed-work qualification, lifetime records outside the recent display limit, incomplete-exposure context, deload exclusion, and bodyweight/assistance suppression; `src/app/api/exercises/[id]/history/route.test.ts` protects owner-scoped delegation and bounds; `src/components/library/PersonalHistorySection.test.tsx` protects the shared history presentation and non-blocking error state; `src/components/LogWorkoutClient.test.tsx` protects one-tap access from the active log card.
- Exercise-measurement coverage: `src/lib/exercise-measurement/semantics.test.ts`, `src/lib/engine/hypertrophy-plan-authoring.test.ts`, `src/lib/api/mesocycle-seed-revision.test.ts`, `src/lib/api/save-workout/persistence.measurement.test.ts`, and `src/lib/logging/setValidity.test.ts` protect tuple validity, the exact eight-entry pilot, V3 hashing/projection, seed-to-workout copying, legacy null behavior, and profile-aware logging.
- Performed-history progression coverage: `src/lib/engine/apply-loads.correctness.test.ts` and `src/lib/engine/history.test.ts` (includes `PARTIAL` and malformed legacy-status handling; also covers uniform main-lift working loads, representative working-set anchoring, accumulation-anchored scheduled deload load-down with canonical fallback/history exclusion, and bodyweight early-exit behavior).
- Load calibration coverage: `src/lib/engine/load-calibration.test.ts`, `src/lib/engine/apply-loads.correctness.test.ts`, `src/lib/api/workout-context.test.ts`, `src/lib/api/template-session/finalize-session.test.ts`, `src/lib/progression/canonical-progression-input.test.ts`, and `src/lib/audit/workout-audit/progression-anchor.test.ts` cover equipment reliability tiers, mixed cable/machine resolution, estimate-only scaling, early-exposure confidence scaling, and the separate runtime-added exact same-exercise calibration lane.
- Double-progression decision coverage: `src/lib/engine/progression.correctness.test.ts` (covers `computeDoubleProgressionDecision` paths, bodyweight rep-only progression, high-variance trimming, confidence scaling, and `workingSetLoad` pass-through).
- Shared progression-input seam coverage: `src/lib/progression/canonical-progression-input.test.ts` asserts the canonical assembly of `priorSessionCount`, mixed-history `historyConfidenceScale`, and deduped `confidenceReasons` before either generation or explainability calls `computeDoubleProgressionDecision()`.
- Live workout cue coverage: `src/lib/progression/load-coaching.test.ts` (covers prescribed-load hold, above-prescribed-load hold messaging, rising-effort hold messaging, and standard increase/decrease paths without changing canonical progression math).
- Mesocycle lifecycle coverage: `src/lib/api/mesocycle-lifecycle.test.ts` (facade + math/state split behavior, duration-aware week derivation, accumulation/deload thresholds, volume ramping, default RIR bands for 4-, 5-, and 6-week mesocycles, and the canonical `mesocycle.blocks -> getWeeklyVolumeTarget()` seam).
- V4 custom-plan acceptance/replay coverage: `src/lib/engine/hypertrophy-plan-authoring-v4.test.ts`, `src/lib/engine/hypertrophy-prescription-patterns.test.ts`, `src/lib/api/v4-prescription-normalization.test.ts`, `src/lib/api/hypertrophy-plan-drafts.test.ts`, `src/lib/api/mesocycle-seed-revision.test.ts`, `src/lib/api/slot-plan-seed-parser.test.ts`, `src/lib/api/template-session/slot-plan-seed.test.ts`, `src/lib/api/template-session.test.ts`, `src/lib/api/template-session-v4-revised.test.ts`, the plan-finalize and workout-generation route tests, `src/components/plans/WeeklyHypertrophyPlanEditor.test.tsx`, and `src/components/ui/SlideUpSheet.test.tsx`. These pin strict V4 parsing/hashing, deterministic pattern recognition/materialization without input mutation, exact reference-plan expansion, compact/advanced authoring, custom-overwrite safety, one-edit bulk behavior, focus restoration, stale-CAS retention, exact authoritative warning-scope binding and zero-write stale rejection, context-prop/request/navigation freshness, confirmed-preview CAS acceptance, rollback, revision 1 authority, server-controlled copied-measurement provenance, fail-closed unrecognized limitations, above-reference volume neutrality and V4/hash non-mutation, exact-replay-only autoregulation isolation, rollout/write gates, UI handoff, and unchanged V1–V3 fixtures. The released original proof in `template-session.test.ts` compares all 20 distinct 25-placement reference-plan week/session combinations with `template-session-v4-reference.expected.ts`; the revised 26-placement proof and mutation sentinels run independently in `template-session-v4-revised.test.ts` against only `template-session-v4-revised-reference.expected.ts`. The neutral `template-session-v4-reference.test-helper.ts` contains actual-output projection only and imports neither fixture nor expected module. Original and revised proof independence is maintained through separate module ownership, independently authored data, direct comparisons, and review. No expected prescription is resolved or normalized through production code. The matrices cover prescribed and omitted placement identity, exercise count/identity/order, every materialized set and rep range, explicit RPE, complete measurement tuples, exact revision provenance, and absence of warm-ups, hip-flexor preparation, finisher composition, and selection fallback. Their mutation sentinels exercise the same comparison boundary. Separately, one real disposable PostgreSQL lifecycle in `scripts/test-v4-custom-plan-postgres.ts --confirm-disposable` proves revision-bound Health/scope, coaching-only reference classification, blocker rejection/restoration, persistence, transaction, activation, scheduling, and one scheduled materialization. Its expected runtime side is the separately authored Week 1 Lower A literal; a test-owned mapper replaces only exercise-name placeholders with disposable UUIDs. The saved preview supplies the first actual bound hash, which must remain exactly equal through reload, finalization confirmation, immutable revision, active revision, and runtime receipt. Production hashing is used only on a fresh clone of actual preview output for the material-mutation negative control. It does not run 20 separate database lifecycles; the independent production-materializer matrices supply the exhaustive prescription coverage.
- Weekly target-profile coverage: `src/lib/engine/volume-targets.test.ts` (block-aware target-profile construction, compatibility fallback to duration-only interpolation, preserved default 5-week behavior, and non-default realization-week target reduction).
- Block-prescription intent coverage: `src/lib/engine/periodization/block-prescription-intent.test.ts` asserts that block-aware RIR targets, lifecycle set targets, set multipliers, and legacy `getPrescriptionModifiers()` all read from one shared seam instead of separate block-policy implementations.
- Generation phase/block bridge coverage: `src/lib/api/generation-phase-block-context.test.ts` verifies that generation resolves real block-relative context when `TrainingBlock` rows exist and falls back cleanly when they do not.
- Context-loader phase/block propagation coverage: `src/lib/api/template-session/context-loader.test.ts` asserts that generation now receives real phase/block context rather than dropping `blockContext` to `null`, that lifecycle weekly volume targets are materialized through the same block-aware path, and that anchored gap-fill requests keep anchored `weekInMeso` while deriving block-relative `weekInBlock`.
- Periodization bridge coverage: `src/lib/engine/periodization.correctness.test.ts` asserts that longer accumulation phases continue progressing before deload rather than hard-stopping at week 4.
- Template-session regression coverage: `src/lib/api/template-session.push-week3.regression.test.ts` (W3S1 Push scenario covering role-budgeting/closure seams, CORE_COMPOUND set-count cap <=5, bodyweight Dip `targetLoad=0`, and uniform main-lift working loads anchored to the representative legacy working-load signal across 0-based and 1-based `setIndex` history).
- Volume landmark coverage: `src/lib/engine/volume-landmarks.test.ts` (MEV/MAV/MRV values for all muscles; shared target interpolation correctness through the canonical volume-target helper).
- Weekly-volume read-model coverage: `src/lib/api/program.test.ts`, `src/lib/api/mesocycle-week-close.test.ts`, `src/lib/api/muscle-outcome-review.test.ts`, and `src/lib/api/explainability.volume-compliance.test.ts` assert that dashboard rows, week-close deficits, analytics muscle outcomes, and explainability compliance read weighted effective weekly volume from the canonical shared adapter in `src/lib/api/weekly-volume.ts` and read weekly target shape through the shared lifecycle target seam rather than ad hoc duration-only interpolation.
- Dashboard RIR/cue sync coverage: `src/lib/api/program.test.ts` asserts that the dashboard's `rirTarget` and accumulation coaching cue use the same block-aware lifecycle RIR seam as generation instead of a separate dashboard-only week mapping.
- Explainability volume compliance coverage: `src/lib/api/explainability.volume-compliance.test.ts` (query/assembly split surfaced through explainability facade; meso-week scoped muscle volume, compliance status classification, and `UNDER_MEV`/`OVER_MAV` boundary assertions).
- Workout generation route contract coverage: `src/app/api/workouts/generate-from-intent/route.test.ts` and `src/app/api/workouts/generate-from-template/route.test.ts` assert receipt-first `selectionMetadata` responses, absence of top-level generation autoregulation payloads, and pending-week-close `optionalGapFillContext` pinning for optional gap-fill requests.
- Slot-semantics ownership coverage now centers on `src/lib/api/mesocycle-handoff-projection.test.ts`, `src/lib/api/mesocycle-handoff.test.ts`, `src/lib/planning/session-slot-profile.test.ts`, `src/lib/api/template-session/selection-adapter.test.ts`, `src/lib/api/next-session.test.ts`, and `src/lib/audit/workout-audit/generation-runner.test.ts`, covering authored slot-semantics persistence, canonical contract normalization, explicit legacy fallback for pre-authored mesocycles, resolved continuity consumption, and generation/audit forwarding of canonical advancing slot context.
- Supplemental deficit route/UI contract coverage: `src/lib/validation.generate-workout.test.ts`, `src/app/api/workouts/generate-from-intent/route.test.ts`, and `src/components/IntentWorkoutCard.test.tsx` assert BODY_PART-only request validation, backend-owned supplemental receipt stamping, unchanged client persistence of returned metadata, and non-advancing save payloads for strict supplemental sessions.
- Derived session-semantics coverage: `src/lib/session-semantics/derive-session-semantics.test.ts` asserts canonical derived kinds plus compatibility behavior for `advancing`, strict `gap_fill`, strict `supplemental`, scheduled `deload`, `non_advancing_generic`, and `null`/`undefined` `advancesSplit` inputs.
- Scheduled deload contract coverage: `src/lib/api/template-session/deload-session.test.ts`, `src/lib/engine/apply-loads.correctness.test.ts`, `src/lib/progression/progression-eligibility.test.ts`, `src/lib/api/exercise-history.test.ts`, `src/lib/api/exercise-exposure.test.ts`, and `src/lib/api/explainability.progression-receipt.test.ts` assert that scheduled deload keeps exercise continuity, cuts sets, applies lighter canonical loads anchored to performed accumulation work when available, falls back cleanly when accumulation history is missing, stays out of progression anchors, and does not contaminate canonical performance-history/trend/explainability reads.
- Explainability progression receipt coverage: `src/lib/api/explainability.progression-receipt.test.ts` (includes recency-window guard and `PARTIAL` + `COMPLETED` performed-status query assertions).
- Explainability next-exposure alignment coverage also lives in `src/lib/api/explainability.progression-receipt.test.ts`, including the audited Week 4 Pull hold case, discounted `MANUAL` history collapsing a would-be increment to hold, a standard non-discounted increment case, representative-working-load main-lift cases, and downward/upward recalibrated hold cases where review copy must name the performed anchor rather than implying the written target should be repeated. The discounted-history regression now builds its canonical comparison input through `buildCanonicalProgressionEvaluationInput()` so the read-side parity assertion uses the same seam as production.
- Golden-path completed-workout regression coverage now also lives in `src/lib/regression/golden-path-workout-review.test.ts` and `src/lib/regression/golden-path-workout-increase.test.ts`, asserting complementary audited Week 4 Pull-style main-lift scenarios across performed semantics, live load-coaching cues, canonical progression via `buildCanonicalProgressionEvaluationInput()`, explainability `nextExposureDecisions`, and the shared post-workout review model used by both immediate completion review and `/workout/[id]`. The paired regressions protect both the "above prescription but still hold" path and the true earned-increase path.
- Placement-correlation hardening coverage lives in `src/lib/session-semantics/placement-correlation.test.ts`, `src/lib/evidence/session-audit-snapshot.test.ts`, `src/lib/api/pre-session-readiness-contract-builder.load-calibration.test.ts`, and `src/lib/api/log-workout-execution-guidance.test.ts`. The matrix covers exact/reordered pairs, resolver-owned unique legacy fallback, ambiguous legacy duplicates, malformed and unknown records, duplicate explicit sources/targets, distinct-canonical many-to-one, duplicate generated/persisted occurrence IDs before map construction, fail-closed audit comparison, and persisted-placement-only readiness/log guidance.
- Main-path completed-workout UX coverage spans `src/lib/api/post-session-review-display.test.ts`, `src/components/post-workout/PostSessionReviewCard.test.tsx`, `src/components/log-workout/CompletedWorkoutReview.test.tsx`, and `src/app/workout/[id]/page.test.tsx`. It asserts that immediate and reopened reviews use the same snapshot-backed DTO, render one default conclusion, keep evidence/set logs behind disclosures, and do not reinstate explanation or client-derived summary paths.
- Run `npm run verify:completed-review` whenever completed-workout review DTOs or display semantics change. The matrix groups `src/lib/api/post-session-review-display.test.ts`, `src/lib/api/completed-workout-review.test.ts`, `src/app/api/workouts/[id]/post-session-review/route.test.ts`, `src/components/post-workout/PostSessionReviewCard.test.tsx`, `src/components/log-workout/CompletedWorkoutReview.test.tsx`, and `src/app/workout/[id]/page.test.tsx`; also search exact expected copy across all consumers before full verification.
- Canonical session receipt coverage: `src/lib/evidence/session-decision-receipt.test.ts` (receipt build/parse/read behavior and canonical-only extraction from `selectionMetadata.sessionDecisionReceipt`).
- Selection metadata sanitization coverage: `src/lib/ui/selection-metadata.test.ts` (save-safe metadata keeps canonical `sessionDecisionReceipt`, drops legacy top-level session mirrors, and keeps generation readiness context inside the receipt).
- Mutation reconciliation metadata coverage: `src/lib/ui/selection-metadata.test.ts` also asserts canonical `workoutStructureState` persistence, current saved structure summaries, and generated-vs-saved reconciliation retention.
- Add-exercise mutation coverage: `src/app/api/workouts/[id]/add-exercise/route.test.ts` asserts reconciliation persistence, revision increment, returned log-row capabilities, and duplicate same-exercise guards for unresolved planned work, resolved extra-work confirmation, and already-added rows.
- Save optimistic-concurrency coverage: `src/app/api/workouts/save/route.integration.test.ts` asserts request/error mapping and that stale saves stop before child/lifecycle mutations. `src/lib/api/save-workout/persistence.db.test.ts` runs against an explicitly supplied disposable PostgreSQL `TEST_DATABASE_URL` and proves successful CAS, stale rejection, same-revision concurrency, child-state isolation, rollback, ownership classification, and revision-1 creation using the real Prisma transaction boundary.
- Runtime mutation OCC coverage: `src/lib/api/workout-mutation.test.ts` covers claim/classification contracts; focused route/service tests cover command validation and reconciliation; `npm run test:db:workout-mutations` provisions PostgreSQL 17 and proves same-revision structural races, log-versus-structure serialization, rollback, owner isolation, and the main-save CAS boundary. `npm run verify:workout-mutations` guards canonical ownership and rejects local unconditional revision increments.
- Persisted mesocycle snapshot normalization coverage: `src/lib/api/workout-mesocycle-snapshot.test.ts` and `src/lib/ui/workout-list-items.test.ts` cover the shared normalized snapshot helper and list-surface summary builder used by history/recent-workout UI.
- Supplemental list-label coverage: `src/lib/ui/workout-list-items.test.ts`, `src/components/RecentWorkouts.test.tsx`, and `src/components/HistoryClient.test.tsx` assert strict supplemental badge rendering while preserving existing gap-fill labeling.
- Explainability session-context correctness coverage: `src/lib/engine/explainability/session-context.correctness.test.ts` (readiness availability labels, fallback cycle-source behavior, receipt block-horizon milestones, and cautious fallback when receipt block duration is absent).
- End-to-end-ish receipt pipeline coverage: `src/app/api/workouts/receipt-pipeline.integration.test.ts` (generate -> save -> explainability with canonical `sessionDecisionReceipt` and no legacy fallback).
- UI session overview copy guards: `src/lib/ui/session-overview.test.ts` (`PARTIAL`/`COMPLETED` performed basis and load-provenance wording).
- Explainability panel UI coverage: `src/components/explainability/ExplainabilityPanel.test.tsx` now also asserts the scan-first audit labels (`Session scan`, `Exercise drill-down`, `Missing or weak signals`, `Why this lift stayed in`, `Top factors`) instead of the older disclosure/jargon-heavy copy.
- Truth-boundary UI coverage: `src/components/explainability/SessionContextCard.test.tsx` and `src/components/explainability/ExplainabilityPanel.test.tsx` cover mutation-aware truth messaging and original-plan relabeling on summary/explainability surfaces.
- UI program volume presentation coverage: `src/components/ProgramStatusCard.render.test.tsx` now asserts that weighted effective sets are shown as the primary weekly value while raw direct/indirect counts remain contextual, that weekly status labels/descriptions/badges come from server-shaped row fields, that historical week views suppress `Today:` entirely, that the breakdown sheet explains raw-to-weighted math per contributor, and that fetched historical browsing does not mix current-week chrome with past-week volume rows.
- Log capability coverage: `src/components/LogWorkoutClient.test.tsx` asserts add-set/remove/swap/add-exercise/finish/weekly-check controls are gated by `LogWorkoutCapabilities` and per-exercise `LogExerciseCapabilities`.
- Receipt block-week semantics coverage: `src/lib/ui/session-summary.test.ts` and `src/lib/evidence/session-decision-receipt.test.ts` assert receipt-backed block-week tags and round-trip parsing of `cycleContext.blockDurationWeeks`.
- UI program-card copy guard: `src/components/ProgramStatusCard.render.test.tsx` covers the rendered `rirTarget` value, while timeline pill copy intentionally stays generic so phase tooltips do not encode a second hardcoded RIR policy.
- Dashboard opportunity model coverage: `src/lib/api/opportunity.test.ts` (weekly pressure, covered-vs-deprioritize rules, downward-only readiness modulation, and rationale text) plus `src/lib/api/recent-muscle-stimulus.test.ts` (recent weighted local stimulus uses the canonical weighted stimulus engine rather than analytics recovery percent).
- Save-route canonical receipt enforcement coverage: `src/app/api/workouts/save/route.integration.test.ts`.
- Audit harness context/generation/serialization coverage: `src/lib/audit/workout-audit/context-builder.test.ts`, `src/lib/audit/workout-audit/generation-runner.test.ts`, `src/lib/audit/workout-audit/serializer.test.ts`, `src/lib/audit/workout-audit/mesocycle-explain.test.ts`, `src/lib/audit/workout-audit/weekly-retro.test.ts`, and `src/lib/audit/workout-audit/workout-audit-cli.test.ts`.
- Focused audit semantics coverage: `src/lib/audit/workout-audit/scenario-audits.test.ts` and `src/lib/api/template-session/remaining-week-planner.test.ts` assert off-order sequencing behavior and the `advancesSplit=false` accounting split between weekly accounting and split advancement.
- Read-side session-semantics regression coverage: `src/lib/progression/progression-eligibility.test.ts`, `src/lib/api/workout-context.test.ts`, `src/lib/api/template-session/remaining-week-planner.test.ts`, and `src/lib/api/next-session.test.ts` assert that the derived helper preserves existing progression, history, remaining-week, and next-session behavior.
- Bundled split-sanity audit coverage: `src/lib/audit/workout-audit/bundle.test.ts` verifies compact summary emission, optional rich-artifact emission, and automatic failure when unresolved same-intent deficits remain with `futureCapacity=0`.
- Week-close handoff audit coverage: `src/lib/audit/workout-audit/week-close-handoff.test.ts` verifies boundary-aware conclusions for final advancing-session ownership handoff, legacy optional gap-fill evidence, and `historical_mixed_contract_state` detection only when a strict optional gap-fill workout exists without a persisted week-close owner.
- Audit diagnostics matrix coverage:
  - `src/lib/audit/workout-audit/future-week-explicit-intent-matrix.test.ts`
  - `src/lib/audit/workout-audit/future-week-derived-intent-matrix.test.ts`
  - Matrix assertions keep standard/debug selection parity while verifying diagnostics gating for closure candidate trace persistence.

## Audit commands

- Exercise rotation-history ownership: `npm run test -- src/lib/api/exercise-rotation-history.test.ts src/lib/api/exercise-rotation-history-ownership.test.ts src/lib/engine/selection-v2/scoring.rotation-history.test.ts`. These tests protect exact-ID rename stability, performed-set semantics, and the absence of legacy aggregate access.
- `npm run audit:workout -- --env-file .env.local --mode future-week --owner owner@local`: canonical owner-scoped future-week artifact with preflight and conclusion blocks
- `npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com`: canonical mesocycle preview vs accepted-seed vs runtime-drift artifact for the real runtime owner
- `npm run audit:sequencing`: emits the focused sequencing audit artifact under `artifacts/audits/sequencing/`
- `npm run audit:accounting -- --env-file .env.local --owner owner@local --selection-mode MANUAL --status COMPLETED --advances-split false --optional-gap-fill true`: emits the focused accounting semantics artifact under `artifacts/audits/accounting/`
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: emits the boundary-aware week-close handoff artifact for one concrete owner/week

## Gap-fill regression
- Key invariants:
  - normal scheduled week close auto-resolves target deficits as review evidence and does not create blocking optional work
  - lifecycle counters/state do not advance for strict optional gap-fill (`advancesSplit=false`)
  - persisted non-advancing workouts cannot be flipped advancing via request payload
  - strict classifier triplet is enforced (`optional_gap_fill` + `INTENT` + `BODY_PART`)
  - anchor week is pinned in both persisted snapshot and receipt cycle context
  - program week-volume queries are week-bounded and snapshot-aware (no cross-week leak)
- Fixture location:
  - `src/lib/audit/workout-audit/fixtures/optional-gap-fill-body-part.future-week-explicit-intent.json`
- Focused test files:
  - `src/app/api/workouts/save/route.integration.test.ts`
  - `src/lib/api/mesocycle-week-close.test.ts`
  - `src/app/api/workouts/save/lifecycle-contract.test.ts`
  - `src/lib/ui/gap-fill.test.ts`
  - `src/app/api/workouts/generate-from-intent/route.test.ts`
  - `src/lib/ui/selection-metadata.test.ts`
  - `src/lib/audit/workout-audit/optional-gap-fill.fixture-regression.test.ts`
  - `src/lib/api/program.test.ts`
  - `src/lib/api/program-page.test.ts`
  - `src/app/api/mesocycles/week-close/[id]/closeout/route.integration.test.ts`
- Recommended focused command:
  - `npm run test -- src/lib/api/mesocycle-week-close.test.ts src/app/api/workouts/save/route.integration.test.ts src/lib/api/program.test.ts src/lib/api/program-page.test.ts src/app/api/mesocycles/week-close/[id]/closeout/route.integration.test.ts src/app/api/workouts/generate-from-intent/route.test.ts src/app/api/workouts/save/lifecycle-contract.test.ts src/lib/ui/gap-fill.test.ts src/lib/ui/selection-metadata.test.ts src/lib/audit/workout-audit/optional-gap-fill.fixture-regression.test.ts`

## Post-session review snapshot verification

Run the focused snapshot, producer, loader, save-route, and audit tests before broad verification:

```powershell
npm run test -- src/lib/api/post-session-review-contract.test.ts src/lib/api/post-session-review-producer.test.ts src/lib/api/post-session-review-snapshot.test.ts src/lib/api/completed-workout-review.test.ts src/lib/api/post-session-review-audit.test.ts src/app/api/workouts/save/route.integration.test.ts
```

Disposable PostgreSQL verification must cover migration apply, unique one-to-one insertion, update/delete trigger rejection, transaction rollback, concurrent completion, and dry-run/write/idempotent backfill. Never use the configured application database for these tests.

## Configuration
- Vitest include patterns: `src/**/*.test.ts` and `src/**/*.test.tsx`
- Environment: `jsdom`
- Reporter: `dot`
- Setup: `vitest.setup.ts`
- `npm run test:inventory:credential-free` intentionally prevents database execution. Disposable
  DB and Playwright coverage remain explicit separate commands and must be reported separately.
- Playwright config: `playwright.config.ts`; by default the database-scrubbing runner starts a managed local Next dev server on port `3217` with `UI_AUDIT_FIXTURE_MODE=1`, then global setup probes the dedicated `/ui-audit-fixture/ready` route with the required fixture header. It uses the isolated `.next-ui-audit/managed` output directory and runs the core-route audit at mobile (`390x844`) and desktop (`1366x768`) viewport sizes.
- The UI audit fixture harness is development-only. `scripts/run-ui-audit.mjs` removes `DATABASE_URL` and `DIRECT_URL` from the Playwright and managed-server environments. Fixture access requires `UI_AUDIT_FIXTURE_MODE=1`, non-production `NODE_ENV`, and an exact recognized `x-ui-audit-fixture` request header on every fixture route, readiness, resolver, and API request. The proxy redirects gated page requests to the dedicated fixture route without copying the scenario into the URL and rejects unhandled gated API requests before production route modules can load. The dedicated route is proxy-exempt to remain authentication- and database-independent, so it repeats the complete server-side request gate. Query parameters and `UI_AUDIT_FIXTURE_SCENARIO` never substitute for the header, and production mode remains inert.
- Current UI audit fixture scenarios:
  - `active`: fixture-backed Home, Program, History, Analytics, Settings, Plan Management (including Strength configuration and review), and lightweight log-workout interaction state with populated representative data.
  - `empty`: fixture-backed Home and Program empty-ish setup state.
  - `handoff`: fixture-backed Home pending-handoff state.
  - `timer-visible`: fixture-backed log-workout state with one logged set and an active rest timer for direct layout audit coverage.
- Static boundary tests recursively inspect the fixture runtime import graph for database/Prisma imports, prove the production review route and fixture adapter both import `PlanReviewView`, and assert that fixture data remains typed by the shared review/read-model contract. Proxy, access, server-resolver, readiness-route, and Playwright tests separately protect the exact non-production header gate, direct-route denial, API firewall, and production-inert behavior.
- Use `npm run test:ui-audit:update` only after an intentional baseline change, then review screenshots under `tests/ui-audit/__screenshots__/`.
- If `PLAYWRIGHT_BASE_URL` is set, Playwright targets that server instead of starting the managed fixture server. Start that server with `UI_AUDIT_FIXTURE_MODE=1` when the fixture-backed scenarios should be active.

## Stimulus accounting verification

- Run `src/lib/engine/stimulus.test.ts` with the custom hypertrophy authoring suite to prove direct/indirect coefficients, unrounded working-set scaling, deterministic aggregation, and Plan Health/runtime equivalence.
- Run focused contract tests: `npm run test -- src/lib/stimulus-accounting/`.
- Run save/add/swap tests for atomic snapshot creation and runtime-edit evidence.
- Run historical reader tests to prove policy/catalog edits do not change snapshotted results.
- Run `src/lib/api/persisted-incomplete-workout-projection.test.ts` for exact performed/remaining partitioning, optional-session behavior, runtime add/swap/remove attribution, corrupt/duplicate evidence fail-closed behavior, deterministic ordering, and Prisma relation query shape.
- Run projected-week and closure tests together to verify explicit completed/incomplete/future categories, immutable current-session evidence, transition-race identity exclusion, the `0.5` meaningful-later threshold, and unreliable-evidence suppression.
- Validate the additive migration and both dry-run/write backfill modes only against disposable Postgres before rollout; do not execute migrations or `--write` against the configured shared database without explicit approval.
# Production write-pause verification

Run the static ownership guard after adding or changing an API mutation method or rollout write
script:

```powershell
npm run verify:production-write-gate
```

The guard inventories every exported route method, fails closed on unsupported route-export
syntax, and requires every classified mutation to use a directly dominating gate before request
parsing, Prisma access, or owner provisioning. It keeps the two read-only POST previews explicit,
protects the non-provisioning owner lookup boundary, rejects direct production-environment checks
outside the owner module, and derives production-capable database commands from the canonical
command registry before checking their target-aware entrypoints. It intentionally does not claim
general TypeScript call-graph soundness. Its isolated fixture suite proves unsupported route
syntax, an unguarded seed command, pre-gate parsing/provisioning, and stale evidence-contract
versions are rejected. It is included in `npm run verify`.

Focused behavior coverage lives in:

- `src/lib/operations/production-write-gate.test.ts`
- `src/lib/operations/production-write-gate-http.test.ts`
- `src/lib/operations/production-write-status-command.test.ts`
- `src/lib/operations/production-write-gate-verifier.test.ts`
- `src/lib/operations/rollout-environment.test.ts`
- representative mesocycle acceptance, workout materialization/save/structural edit, set logging,
  readiness preparation, and readiness submission route tests

Paused route tests must assert the stable 503 contract and zero calls to owner provisioning,
Prisma, workout revision CAS/transactions, and the relevant receipt/readiness/snapshot producer.
Existing route success tests prove the missing/disabled pause preserves response and revision
behavior.

## Inspecting a proposed Codex task

`scripts/codex/Start-TrainerTask.ps1` inspects a proposed task against the versioned
`scripts/codex/trainer-policy.v1.json` policy. It reports repository and worktree state, path
and database policy, conflicts, and proposed verification. Phase 1 is strictly inspect-only: it
does not create worktrees or branches, install packages, execute proposed checks, access a
database, or contact release services.

Human-readable inspection:

```powershell
.\scripts\codex\Start-TrainerTask.ps1 `
  -Name freeze-effective-set-accounting `
  -Classification shared-seam-write `
  -BaseBranch master
```

JSON inspection:

```powershell
.\scripts\codex\Start-TrainerTask.ps1 `
  -Name freeze-effective-set-accounting `
  -Classification shared-seam-write `
  -BaseBranch master `
  -ChangedPath trainer-app/src/lib/engine/example.ts `
  -Json
```

JSON uses the stable `trainer-task-manifest` version 1 structure. Repeatable `-ChangedPath`
values add matching path-based checks in policy order; commands are deterministically
deduplicated. Supported classifications are `audit`, `application-write`, `shared-seam-write`,
`db-migration`, and `release-incident`.

Exit codes are `0` for a successful inspection without blockers, `1` for a valid inspection
with blockers or conflicts, `2` for an invalid invocation or requested policy value, and `3`
for a policy-loading or unexpected execution failure. Warnings do not change a successful exit
code. Proposed verification is planning output only and is never executed by this script.

Run the focused temporary-fixture tests with:

```powershell
pwsh -NoProfile -File .\scripts\codex\tests\Run-Tests.ps1
```

## Local environment doctor

`scripts/codex/Invoke-TrainerDoctor.ps1` reports whether the local checkout has the repository,
runtime, tool, dependency, Prisma, migration, and environment-file capabilities needed for
Trainer work. Its default scope is local and inspect-only:

```powershell
.\scripts\codex\Invoke-TrainerDoctor.ps1
.\scripts\codex\Invoke-TrainerDoctor.ps1 -Json
```

JSON uses the stable `trainer-doctor-report` version 1 structure. Capability statuses are
`available`, `missing`, `warning`, `not-checked`, or `invalid`. Missing optional tools produce
warnings, not a global failure. Environment files are listed by filename only; values, URLs,
tokens, and credentials are never printed.

`-Database`, `-GitHub`, `-Deployment`, and `-All` explicitly select additional reporting
scopes. Phase 2 still reports those scopes as `not-checked`: database selection inventories
local prerequisites without connecting, while GitHub and deployment selection inventory CLI
presence without authentication, project lookup, or remote access. Returning `not-checked`
is preferred whenever an inspect-only guarantee cannot be proven.

Doctor exit codes are `0` when inspection completes without blockers, `1` when required local
project or policy prerequisites block the requested work, `2` for an invalid scope/invocation,
and `3` for policy-loading or unexpected failures. Warnings do not change exit code `0`.

The doctor reports capabilities and risks. It does not install, authenticate, repair, connect,
migrate, deploy, or execute recommended commands.

## Command side-effect registry

`scripts/codex/trainer-policy.v1.json` contains the authoritative Phase 2 command registry.
Each entry identifies its package script or operational entrypoint, resolved side-effect
profile, network/database/local/tracked-file behavior, production-mutation potential,
authorization requirement, mutation-flag escalations, and naming caveats. Commands named
`audit`, `verify`, `preflight`, `refresh`, or `repair` must be judged by this metadata and their
implementation, not by their names.

Run deterministic offline registry coverage validation with:

```powershell
.\scripts\codex\Test-TrainerCommandRegistry.ps1
.\scripts\codex\Test-TrainerCommandRegistry.ps1 -Json
```

The validator requires every `trainer-app/package.json` script and designated operational
entrypoint to be registered or explicitly ignored, verifies referenced files, rejects duplicate
IDs and invalid side-effect classes, and checks known mutation flags for escalation metadata.
The ignore list is limited to documented internal helpers and data modules; the full registry is
not duplicated in this document.

## Offline remote identity status

`scripts/codex/trainer-remote.v1.json` is the versioned, non-secret expected-identity contract
for Trainer's production integrations. It may contain provider owner/project identifiers,
display names, production aliases, project references, environment labels, default branches,
and connection-class names. Unknown values stay explicitly `null` until an operator verifies
them.

Never place tokens, passwords, API keys, database URLs, connection strings, environment-variable
values, credential-bearing Git remotes, or other secrets in this file. Immutable provider IDs
are preferred over display names. Expected identity in this committed contract is distinct from
observed local linkage and from live provider state.

Run the Phase 1 offline inspection in human or JSON mode:

```powershell
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1 -Json
```

The stable JSON output uses `trainer-remote-status` version 1. It reports contract completeness,
sanitized local Git comparison, committed/local Vercel linkage-file presence, committed Supabase
configuration presence, Prisma migration count, exact operator identity gaps, and an explicitly
offline traceability chain. Ignored `.vercel/project.json` values are not read. Raw Git remotes,
credential-bearing URLs, environment values, and secret-like contract values are never emitted.

GitHub HTTPS and SSH remotes are normalized before comparing owner/repository. A configured
GitHub owner, repository, or cached default-branch mismatch is a blocker and is never downgraded
to a warning. Unknown Supabase identity remains unknown rather than being treated as a match.
The explicit `-GitHub` and `-Deployment` scopes run deterministic fake-provider coverage for
pre-provider zero-call gates, authentication/access failures, exact identity mismatches, paginated
GET-only reads, stable human/JSON output, and repository-state immutability. `-Database` and `-All`
remain unsupported and exit `2`.

Vercel fixtures inject a registered HTTP dispatcher directly into the private provider. They never
contact Vercel and never require a Vercel CLI. Coverage validates the eight official REST endpoint
shapes, HTTPS/host/GET/query restrictions, redirect refusal, finite-timeout handling, process-only
`VERCEL_TOKEN` gating, token redaction, alias-to-deployment production truth, and conservative
rollback-candidate reporting. The public command's missing-token fixture requires zero HTTP calls
and null live evidence.

Exit codes are `0` when offline inspection completes without blockers, `1` for a valid report
with blockers or identity mismatch, `2` for an invalid or unsupported scope, and `3` for
identity/policy loading or unexpected failure. Registry validation requires both the identity
contract and the read-only/offline command registration.

Offline remote status validates expected identity and local linkage only. It does not
authenticate, contact providers, inspect deployments, connect to databases, or prove production
state.

## Diff-aware verification planning and execution

`scripts/codex/Invoke-TrainerVerification.ps1` reads the same versioned policy, task-manifest
contract, command registry, and local capability discovery used by Phases 1 and 2. It combines
committed, staged, unstaged, and untracked Git paths with any explicit or manifest paths,
normalizes separators, matches every applicable path rule, retains every selection reason,
deduplicates commands in policy order, and keeps implementation checks separate from release
checks.

Planning is the default. Verification commands run only with explicit `-Run` authorization,
and only registry-approved local implementation checks are eligible.

Plan the current branch/worktree delta from a Git base:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef origin/master
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef origin/master -Json
```

Plan paths without requiring them to exist, or combine them deterministically with a Git base:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 `
  -ChangedPath trainer-app/src/lib/example.ts `
  -ChangedPath trainer-app/prisma/schema.prisma

.\scripts\codex\Invoke-TrainerVerification.ps1 `
  -BaseRef origin/master `
  -ChangedPath trainer-app/src/lib/example.ts
```

Consume an unchanged `trainer-task-manifest` version 1 contract:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 `
  -ManifestPath C:\path\to\trainer-task-manifest.json
```

The manifest classification, allowed/forbidden path policy, changed paths, and proposed checks
are applied alongside current policy rules. An unsupported schema/version or unknown
classification is invalid rather than silently upgraded.

Execute eligible local implementation checks only after reviewing the complete plan:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef origin/master -Run
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef origin/master -Run -ContinueOnFailure
```

Execution is sequential and stops on the first failed required check by default. Results retain
the child exit code, duration, stdout, and stderr. `-ContinueOnFailure` runs remaining eligible
checks but does not turn a failed result into success. In `-Json -Run` mode the pre-execution
plan is printed to stderr and the completed `trainer-verification-plan` version 1 report is
printed to stdout.

Policy and registry metadata decide execution eligibility. Phase 3 refuses release-only,
production-write, deploy, destructive, database, network, separately authorized,
mutation-escalated, install/download, and unresolved-side-effect commands. Unsafe or unsupported
commands remain visible in the plan with skip reasons and are never attempted. Current full
`verify` and Prisma generation selections are plan-only; focused commands explicitly approved by
policy may run when their local prerequisites are available.

Prerequisites are reported per selected command: PowerShell, Git-owned comparison state,
Node/npm, the existing dependency installation, Prisma, Docker, clean-worktree, database, and
network requirements. `-Run` reuses the doctor report for capability discovery. Missing
prerequisites block only affected eligible execution; planning remains available and never
installs, links, repairs, authenticates, connects, or remediates.

Exit codes are `0` for a valid plan or successful authorized execution, `1` for a valid plan
with blockers or any failed executed check, `2` for an invalid invocation, manifest, base, or
option combination, and `3` for policy-loading or unexpected failures. `-ContinueOnFailure`
without `-Run` exits `2`.

Phase 3 does not create an evidence bundle, create or clean a worktree, execute a release stage,
connect to services, authenticate, install packages, remediate prerequisites, or clean artifacts
created by an approved local check. Those boundaries are intentional and are not hidden behind
command names.

## Short-today verification

Focused coverage must exercise manifest authoring for preferred/moderate/minimal capacity, parser compatibility, concrete row hashing, protected roles/exposures, deterministic transformation, readiness-before-reduction ordering, route request strictness, save recomputation/OCC/idempotency, reconciliation suppression, reduced incomplete projection, post-session omission interpretation, closure non-redistribution, UI preview/cancel/lock copy, and source-boundary scans. Normal seed replay tests must continue to prove accepted explanatory metadata is runtime-inert.
## Custom hypertrophy plan verification

Focused coverage lives in `hypertrophy-plan-authoring.test.ts`, `hypertrophy-plan-health.test.ts`, `hypertrophy-plan-drafts.test.ts`, `HypertrophyPlanEditor.test.tsx`, `PlanHealthPanel.test.tsx`, `WeeklyHypertrophyPlanEditor.test.tsx`, the draft/finalize route tests, the accepted-revision/parser suites, runtime-swap suites, strength-policy suites, plan-management/activation suites, and the rollout test. It proves manual/V2 draft convergence, strict minimal intent with the bounded low-axial exercise-class semantic, exhaustive stable-code severity mapping and conservative unknown handling, muscle-aware V2 finding identity, shipped-catalog consistency across generated rows/picker/Health/runtime, exact saved-revision load/save Health, evaluator failure degradation, current-fact limitation handling, separate display-assessment freshness and important-warning authority, unchanged-scope installation of coaching/informational/session-estimate refreshes, and exact warning-scope acceptance/rejection across independently changed policy, identity, revision, warning material presentation, equipment, limitations, prescription, and preview boundaries. It also proves blockers remain independently transactional, neutral volume cannot invalidate acknowledgment, ordering is locale-independent code-unit ordering, and unused aliases/raw stimulus/V1 measurement/unselected catalog drift remain semantically stable. V1 regeneration coverage directly invokes the real plan/session/exercise/intent/set handlers under deferred locks, proves the fully-saved precondition, independently isolates session move-up and move-down under fresh locks, exact authoritative replacement with duplicate placements and no synthesis, pre-lock delayed-autosave suppression, in-flight/queued/failed CAS handling, service-level exact persist/return and zero-write conflicts, context drift, exact failure preservation/unlock, network-after-commit CAS/refresh recovery without replay, subsequent autosave from the returned revision, draft navigation, and unmount. The same set also covers returned-current-Health rollback behavior, explicit stale-client rejection before service calls, client-authority rejection, draft-ID isolation, focus-stable accessible tier presentation, neutral above-reference volume wording and non-mutation, current accepted-revision precedence over compatibility seed metadata, semantic Plan Health blockers, explicit no-intent legacy swap behavior, atomic draft consumption/rollback, lossless editable copy, projection alignment, version-dispatched hashing, exact legacy Strength equipment compatibility, role-aware runtime substitution, separate activation, and default-off rollout behavior.

The finalization evidence keeps its proof boundaries explicit. `hypertrophy-plan-drafts.test.ts` drives the real finalization owner for coaching, neutral-volume, and session-estimate refreshes under one captured scope, plus a paired blocker control and independently reachable raw-warning changes to code, explanation, affected session, exercise, and muscle. Those rejection cases assert both zero committed state and zero attempted finalization mutations, including nested block creation and accepted-seed pointer promotion through their owning calls; a rollback negative control proves attempted writes cannot hide behind restored state. Tier, title, action, blocking state, and acknowledgment state are canonical policy projections of the finding code (and, for unknown findings, the blocker/warning source lane) and therefore cannot be changed independently; real code/blocker changes and direct projector assertions bind the derived fields to those raw facts. Warning presentation has no independent placement field, while V2 placement identity is bound through the draft/confirmed-preview context. The V1 editor uses one stateful fake server to prove commit-before-response-loss, stale compare-and-swap, exact authoritative refresh, one regeneration write, and no replay. Both editors rerender with display-equivalent Health whose warning scope alone changes and prove the real finalization request submits only the latest canonical scope, once. These are deterministic service/component proofs, not browser or production evidence. The independent 20-case V4 materializer matrix and the single disposable PostgreSQL lifecycle remain separate evidence categories as described above; the PostgreSQL harness is not an exhaustive 20-lifecycle matrix.

The V4 reference proofs keep the original PR #59 and revised plans in separate
modules. `template-session.test.ts` owns the released 25-placement proof and its
independently authored expected matrix; `template-session-v4-revised.test.ts`
owns the revised 26-placement proof and its independent accepted, preview, and
runtime expectations. Submitted fixtures do not own expected values, and
expected prescriptions remain comparison-only data rather than actual-side
inputs.

The neutral runtime helper structurally projects one caller-selected week and
slot from the actual accepted V4 payload. It fails closed on missing or duplicate
week, slot, prescription, placement, and runtime-order identity, rejects duplicate
placement IDs, and handles weekly status exhaustively as `PRESCRIBE` or `OMIT`.
It does not call production normalization, resolution, hashing, conversion,
materialization, or fallback owners.

The disposable PostgreSQL lifecycle binds submitted and expected exercise names
to fresh database IDs independently, then compares actual preview, persistence,
finalization, immutable revision, active revision, receipt, and Week 1 Lower A
runtime output with separately authored literals. Proof independence is
maintained through explicit module ownership, separate authored data, direct
comparisons, and review; there is no AST, import-graph, or dataflow enforcement
test. This one disposable lifecycle supplements rather than replaces the two
exhaustive 20-case unit matrices.

The stable-identity unit proof pins the original hash
`3d4e807cbafdb89bd52dc0fb475842b8c18761e2212967614e41acf5e22913b9` and the
revised hash
`48d34eb7e950a6d0fa564a234ed7e257a8d30681519ba52c019fe47a6066dfef`.
Those hashes are deterministic because the fixture exercise identities are fixed.
They are not expected hashes for the disposable PostgreSQL lifecycle: fresh database
exercise UUIDs make that bound hash vary between runs. Within one disposable run,
saved preview, reload, finalization confirmation, immutable revision, active revision,
and runtime receipt must all retain one exact bound hash.

`npm run verify:exercise-catalog-invariants` is the credential-free catalog structure check. It validates canonical and alias uniqueness, alias targets/collisions, muscle-role consistency, existing vocabularies, measurement tuple compatibility, and the main-lift/compound relationship without requiring measurement completion or database access. `verify:fast` runs it before the focused engine suite.

The read-only V0 compiler proof is covered by `src/lib/api/plan-specification-preview-v0.test.ts`. It verifies the exact minimal input boundary, equality with the existing custom executable projection, stable ordering and exact role/set mapping, identifier-only normalization, rejected deferred fields, current accepted-seed validation/hash behavior, explicit Plan Health omission, no persistence or lifecycle dependencies, and non-consumption by targeted acceptance/runtime owners. Run the developer preview with `npm run preview:plan-specification-v0`; it is credential-free and performs no database reads or writes.

Migration verification must use the repository migration-integrity suite and disposable/local PostgreSQL only. Do not enable the feature in a shared Development, Preview, or Production environment for browser testing; local manual testing requires an explicitly disposable database and a process-local rollout variable.
