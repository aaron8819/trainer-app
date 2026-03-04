# 10 Workout Audit Harness Design

Owner: Aaron
Last reviewed: 2026-03-04
Purpose: Design proposal for a repeatable workout audit harness that can inspect and validate workout generation without ad hoc shell or database forensics.

This doc covers:
- Proposed design decisions and rationale
- The proposed harness architecture for `trainer-app`
- Canonical input and output contracts
- Supported audit modes, simulation strategy, testing strategy, and rollout
- Open questions and assumptions

Sources of truth:
- `trainer-app/src/app/api/workouts/generate-from-intent/route.ts`
- `trainer-app/src/lib/api/template-session.ts`
- `trainer-app/src/lib/api/template-session/context-loader.ts`
- `trainer-app/src/lib/api/template-session/finalize-session.ts`
- `trainer-app/src/lib/api/program.ts`
- `trainer-app/src/lib/api/mesocycle-lifecycle.ts`
- `trainer-app/src/lib/api/workout-context.ts`
- `trainer-app/src/lib/evidence/session-decision-receipt.ts`
- `trainer-app/src/app/api/workouts/save/route.ts`
- `trainer-app/src/lib/api/template-session.test.ts`
- `trainer-app/src/lib/api/template-session.push-week3.regression.test.ts`
- `trainer-app/src/lib/api/template-session.pull-week2.integration.test.ts`
- `trainer-app/src/lib/api/mesocycle-lifecycle.test.ts`
- `trainer-app/src/lib/api/explainability.volume-compliance.test.ts`
- `trainer-app/src/lib/engine/apply-loads.correctness.test.ts`
- `trainer-app/src/app/api/workouts/receipt-pipeline.integration.test.ts`

## Why this design exists

Recent workout audits exposed the same avoidable friction repeatedly:
- next-session derivation and generation are split across different runtime paths
- generation simulation requires multiple manual steps
- inspection depends on direct DB queries and ad hoc scripts
- exact inputs and decision points are hard to reconstruct cleanly
- audit output is not a first-class artifact

This design proposes a long-term internal audit harness that makes workout generation review repeatable for:
- the true next session
- an explicit intent such as `push` or `pull`
- a specific week/session scenario
- lifecycle and deload correctness
- continuity, weekly volume budget, and progression interactions
- regression checks after engine or lifecycle changes

Current interim audit UX note:
- The existing `/workout/[id]/audit` route is still a page-level debugging surface, not the proposed harness.
- Its route boundary is documented canonically in `docs/01_ARCHITECTURE.md`.
- It now reads in two passes:
  - session-level scan first (evidence quality, missing signals, cycle/progression/volume context)
  - exercise drill-down second for per-lift rationale and prescription inspection
- That layout improves review speed, but it does not replace the need for the structured audit artifact proposed in this doc.

## Scope and goals

Problems this harness should solve:
- Provide one canonical path to audit the true next workout from runtime state.
- Make intent-driven generation callable directly without relying on UI state.
- Replace shell-level DB forensics with application-module-driven audit runs.
- Persist structured audit artifacts that explain both inputs and decisions.
- Support deterministic fixture scenarios for repeatable regression review.

Audits this harness should support:
- True next-session audit from current live state
- Explicit intent preview audit
- Historical workout contract audit
- Deterministic fixture regression audit
- Lifecycle transition and deload audit
- Continuity, volume-budget, and progression/load-anchor audit

Out of scope:
- This is not a user-facing feature.
- This is not a replacement for the workout generation engine.
- This is not a generic observability platform for all routes.
- This is not a persistence-heavy analytics system; audit artifacts should be generated on demand unless a later phase justifies storage.

Phase 1 non-goals:
- Do not redesign generation, progression, lifecycle, or receipt ownership.
- Do not broaden the existing `/workout/[id]/audit` page into the harness.
- Do not build fixture-regression infrastructure yet beyond minimal type/composition seams.
- Do not attempt multi-step `generate -> save -> next-session` simulation in Phase 1.

## Proposed design decisions and rationale

### 1. Reuse production derivation and generation paths

The harness should call the same application modules production already uses for:
- next-session derivation
- lifecycle week and deload derivation
- generation
- load application
- canonical receipt parsing

Rationale:
- The current split between `program.ts` and `template-session.ts` is the main source of audit drift.
- A separate audit-only implementation would become untrustworthy immediately.

### 2. Introduce a canonical next-session derivation service

The current next-session logic now lives in `loadHomeProgramSupport()` in `src/lib/api/program.ts`. The harness should force that logic into an explicit shared service consumed by both the dashboard and audit code.

Rationale:
- The most important audit question is often "what is the actual next workout right now?"
- That answer must come from one canonical derivation path.

### 3. Define a normalized audit scenario contract

The harness should normalize all audit entrypoints into a single scenario model, whether the source is:
- live runtime state
- a persisted historical workout
- a deterministic fixture
- an explicit overridden intent

Rationale:
- The key design boundary is live versus deterministic state, not CLI versus route.
- One normalized scenario contract keeps the pipeline simple and diffable.

### 4. JSON-first artifact, summary-second renderer

The canonical audit output should be structured JSON first. Markdown or text output should render from that JSON.

Rationale:
- The codebase already moved toward receipt-first explainability.
- JSON is the only practical format for regression testing, diffing, and machine-readable contract checks.

### 5. Keep derivation/generation shared and analysis/reporting isolated

Shared:
- lifecycle derivation
- next-session derivation
- generation
- load anchoring
- canonical decision receipt generation

Audit-only:
- report assembly
- contract checks
- warning/anomaly classification
- artifact serialization
- diffing

Rationale:
- Shared logic preserves correctness.
- Isolated reporting prevents audit concerns from leaking into runtime behavior.

### 6. Support privacy-aware artifact modes

The harness should support at least:
- `live`: full internal engineering artifact
- `pii-safe`: redacted artifact for broader sharing
- `fixture`: deterministic artifact with no live user data

Rationale:
- Live workout audits can include owner email, readiness, notes, and historical training context.

## Canonical audit use cases

### Audit the true next workout from current runtime state

Expected flow:
- Resolve owner
- Derive canonical next-session context
- Load mapped generation context
- Run generation through the production path
- Emit a full audit receipt including derivation trace

Primary question answered:
- What workout would the app actually generate right now, and why?

### Audit a specific intent without relying on UI state

Expected flow:
- Resolve owner or fixture
- Skip next-session rotation logic
- Call `generateSessionFromIntent` directly
- Emit the same full audit shape, but mark source as explicit intent

Primary question answered:
- What does the current engine produce for `push`, `pull`, `legs`, or another intent in current conditions?

### Audit a saved historical workout against current contracts

Expected flow:
- Load persisted workout
- Parse persisted `selectionMetadata.sessionDecisionReceipt`
- Recompute current contract checks
- Optionally re-run generation for comparison

Primary question answered:
- Does this historical workout still satisfy current receipt, lifecycle, progression, and volume-accounting contracts?

### Audit a deterministic fixture scenario

Expected flow:
- Load prebuilt fixture scenario
- Build mapped generation context without live DB lookups
- Run the normal generation path
- Emit stable JSON for snapshots and diffs

Primary question answered:
- Did an engine change alter a protected scenario?

### Audit lifecycle transitions and deload cases

Expected flow:
- Build either live or fixture scenario around lifecycle counters and mesocycle state
- Run derivation checks
- Optionally simulate pre-save and post-save transition points

Primary question answered:
- Are week/session counters, deload thresholds, and state transitions behaving correctly?

### Audit continuity / volume-budget / progression interactions

Expected flow:
- Load same-intent prior performed history
- Load lifecycle weekly targets
- Run generation
- Analyze continuity floors, projected volume, and load anchors per exercise

Primary question answered:
- Why were these exercises and set counts selected, and how did continuity, weekly volume budget, and progression evidence interact?

## Proposed architecture

The harness should be implemented as a first-class internal capability under a dedicated server-only namespace, for example:

- `src/lib/audit/workout-audit/`

### Canonical next-session derivation service

Proposed module:
- `src/lib/api/next-session.ts`

Responsibilities:
- Resolve the true next workout context
- Reuse current incomplete-workout priority logic
- Reuse weekly schedule rotation logic
- Emit a derivation trace, not just an intent string

Inputs:
- `userId`
- optional `asOfDate`
- optional overrides for deterministic simulation

Outputs:
- `intent`
- `existingWorkoutId`
- `isExisting`
- `source`
- `weekInMeso`
- `sessionInWeek`
- `derivationTrace`

Should be shared with:
- `src/lib/api/program.ts`
- audit harness

Recommended minimum Phase 1 contract:

```ts
type NextWorkoutContext = {
  intent: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
  existingWorkoutId: string | null;
  isExisting: boolean;
  source: "existing_incomplete" | "rotation";
  weekInMeso: number | null;
  sessionInWeek: number | null;
  derivationTrace: string[];
};
```

Phase 1 boundary:
- Extract only the shared derivation seam needed by `loadHomeProgramSupport()` and the audit harness.
- Do not move unrelated `program.ts` dashboard-read-model logic into this module.

### Audit context builder

Proposed module:
- `src/lib/audit/workout-audit/context-builder.ts`

Responsibilities:
- Normalize live, historical, fixture, and explicit-intent requests into one `WorkoutAuditContext`
- Load mapped generation context
- Attach runtime scheduling and lifecycle context
- Attach historical/persisted receipt context when relevant

Should reuse:
- `loadMappedGenerationContext`
- `loadActiveMesocycle`
- canonical next-session service

### Session generation runner

Proposed module:
- `src/lib/audit/workout-audit/generation-runner.ts`

Responsibilities:
- Call production generation entrypoints
- Support:
  - `derive next -> generate`
  - `explicit intent -> generate`
  - `historical compare -> optional regenerate`
- Keep all generation logic outside the audit layer

Should reuse:
- `generateSessionFromIntent`
- `generateDeloadSessionFromIntent`
- future canonical next-session generation wrapper

### Post-generation analyzer

Proposed module:
- `src/lib/audit/workout-audit/analyzer.ts`

Responsibilities:
- Compute audit-specific evidence and validations
- Summarize current mesocycle week volume accounting
- Summarize continuity and role-fixture state
- Summarize load-anchor and progression evidence
- Surface contract violations, anomalies, and warnings

Should reuse current semantics from:
- lifecycle tests
- progression/load tests
- volume-compliance tests
- receipt pipeline tests

### Structured audit result serializer

Proposed module:
- `src/lib/audit/workout-audit/serializer.ts`

Responsibilities:
- Produce versioned JSON output
- Normalize ordering for diffability
- Redact PII when configured

### Human-readable renderers

Proposed modules:
- `src/lib/audit/workout-audit/render-markdown.ts`
- `src/lib/audit/workout-audit/render-text.ts`

Responsibilities:
- Render summaries from the canonical JSON artifact
- Avoid owning business logic

### CLI entrypoint

Proposed file:
- `scripts/workout-audit.ts`

Responsibilities:
- Parse CLI flags
- Resolve request
- Run audit
- Write artifact files
- Print concise terminal summary

Phase 1 command surface:
- support `next-session`
- support `intent-preview`
- write JSON by default
- treat markdown/text rendering as optional follow-up work, not a blocker

### Optional internal debug endpoint

Proposed route:
- `src/app/api/debug/workout-audit/route.ts`

Responsibilities:
- Provide a server-only wrapper around the same audit service
- Remain internal-only and disabled outside local/dev/admin contexts

### Fixture adapters

Proposed directory:
- `src/lib/audit/workout-audit/fixtures/`

Responsibilities:
- Adapt existing deterministic regression scenarios into named harness fixtures
- Build `MappedGenerationContext` directly where needed

Likely first fixtures:
- `push-w3s1-regression`
- `pull-w2-continuity`
- `mesocycle-deload-threshold`
- `new-meso-core-carryover`

## Canonical inputs and outputs

### Input contract

Proposed top-level request shape:

```ts
type WorkoutAuditRequest = {
  mode:
    | "next-session"
    | "intent-preview"
    | "historical-compare"
    | "fixture-regression"
    | "lifecycle-check"
    | "explainability-dump";
  userId?: string;
  ownerEmail?: string;
  workoutId?: string;
  intent?: "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
  targetMuscles?: string[];
  deriveNext?: boolean;
  mesocycleId?: string;
  asOfDate?: string;
  scenarioFixture?: string;
  includeAutoregulation?: boolean;
  autoregulationMode?: "as-recorded" | "forced-on" | "forced-off";
  strictMode?: boolean;
  includeHistoryWindow?: number;
  sanitizationLevel?: "none" | "pii-safe";
  persistArtifact?: boolean;
  outputFormat?: "json" | "markdown" | "both";
  diffAgainstArtifact?: string;
  diffAgainstFixture?: string;
  contractChecks?: string[];
  overrides?: {
    weeklySchedule?: string[];
    completedSessions?: number;
    accumulationSessionsCompleted?: number;
    deloadSessionsCompleted?: number;
    activeMesocycleState?: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED";
    lifecycleWeek?: number;
    readinessSignal?: Record<string, unknown>;
    roleListIncomplete?: boolean;
    pinnedExerciseIds?: string[];
  };
};
```

Key fields from the current audit need:
- `userId`
- `ownerEmail`
- `intent`
- `deriveNext`
- `mesocycleId`
- `asOfDate`
- `scenarioFixture`
- `includeAutoregulation`
- `strictMode`

Resolution rules:
- `next-session` requires `userId` or `ownerEmail`
- `intent-preview` requires `intent`
- `historical-compare` requires `workoutId`
- `fixture-regression` requires `scenarioFixture`
- any override must be clearly marked in the output artifact

### Output contract

The structured result should be JSON first and human-readable summary second.

Proposed result shape:

```ts
type WorkoutAuditResult = {
  version: 1;
  runId: string;
  generatedAt: string;
  mode: WorkoutAuditRequest["mode"];
  source: "live" | "historical" | "fixture";
  identity: {
    userId?: string;
    ownerEmail?: string;
    workoutId?: string;
    mesocycleId?: string | null;
    artifactPath?: string;
  };
  request: WorkoutAuditRequest;
  context: {
    activeMesocycleState?: string | null;
    mesocycleLength?: number | null;
    sessionsPerWeek?: number | null;
    daysPerWeek?: number | null;
    currentCounters?: Record<string, number | null>;
    schedule?: string[];
    scheduleSource?: string;
    asOfDate?: string;
  };
  nextSession?: {
    resolved: boolean;
    source: "existing_incomplete" | "rotation" | "explicit_intent" | "historical" | "fixture";
    existingWorkoutId?: string | null;
    intent?: string | null;
    weekInMeso?: number | null;
    sessionInWeek?: number | null;
    derivationTrace: string[];
  };
  lifecycle: {
    currentWeekDerivation: Record<string, unknown>;
    currentSessionDerivation?: Record<string, unknown>;
    rirTarget?: { min: number; max: number } | null;
    weeklyVolumeTargets?: Record<string, number>;
    deloadDecision?: Record<string, unknown>;
    phase?: string | null;
    blockType?: string | null;
  };
  readiness: {
    signalSummary?: Record<string, unknown>;
    sorenessFlags?: Record<string, unknown>;
    autoregulationMode: string;
    appliedModifications?: Record<string, unknown>[];
  };
  continuity: {
    priorSameIntentSessions: Record<string, unknown>[];
    roleFixtures: Record<string, unknown>[];
    continuityFloorsByExercise: Record<string, number>;
  };
  volumeAccounting: {
    currentWeekWindow?: Record<string, unknown>;
    countedPerformedWorkouts?: Record<string, unknown>[];
    directSetsBeforeSession?: Record<string, number>;
    projectedTotalsAfterSession?: Record<string, number>;
    weeklyTargets?: Record<string, number>;
    landmarkComparisons?: Record<string, unknown>[];
  };
  selection: {
    selectionMode?: string;
    selectedExercises: Record<string, unknown>[];
    filteredExercises: Record<string, unknown>[];
    perExerciseSetTargets: Record<string, number>;
    rationale?: Record<string, unknown>;
    roleFixtureAlignment?: Record<string, unknown>[];
  };
  progression: {
    perExerciseAnchors: Record<string, unknown>[];
    sourceHistoryRows: Record<string, unknown>[];
    receipts?: Record<string, unknown>[];
  };
  prescription: {
    finalWorkout: Record<string, unknown>;
    estimatedMinutes?: number | null;
    notes?: string | null;
  };
  receipt: {
    sessionDecisionReceipt?: Record<string, unknown>;
    decisionReceiptExtensions?: Record<string, unknown>;
  };
  contracts: {
    checks: Record<string, { pass: boolean; details?: string[] }>;
    warnings: string[];
    anomalies: string[];
    violations: string[];
  };
  summary: {
    headline: string;
    bullets: string[];
  };
  diff?: {
    against: string;
    changes: Record<string, unknown>[];
  };
};
```

The output must include, at minimum:
- identity/context
- active mesocycle state
- derived next-session context
- current week/session derivation details
- schedule source and logic used
- lifecycle RIR target
- lifecycle weekly volume targets
- actual performed volume counted for the current mesocycle week
- readiness/autoregulation inputs
- role fixtures / continuity state
- selected exercises
- rejected/filtered exercises
- per-exercise set targets
- progression/load-anchor evidence
- final workout prescription
- deload decision
- decision receipt
- warnings / anomalies / contract violations

## Audit modes

### `next-session`

Runs:
- canonical next-session derivation
- live context load
- production generation
- audit analysis

Returns:
- full live-state audit artifact for the true next session

### `intent-preview`

Runs:
- live context load
- direct intent generation
- audit analysis

Returns:
- full audit artifact for an explicit intent, independent of UI state

### `historical-compare`

Runs:
- persisted workout load
- persisted receipt parse
- current contract checks
- optional regenerate path

Returns:
- persisted versus recomputed comparison
- contract drift summary

### `fixture-regression`

Runs:
- named fixture adapter
- deterministic generation
- normalized serializer

Returns:
- stable regression artifact suitable for snapshots and diffs

### `lifecycle-check`

Runs:
- lifecycle derivation checks
- optional transition simulation
- optional save-path contract checks

Returns:
- lifecycle-focused artifact with threshold and counter analysis

### `explainability-dump`

Runs:
- production generation
- full receipt and evidence extraction
- expanded selection, volume, and progression analysis

Returns:
- rich internal explainability artifact for debugging and review

## Simulation strategy

### Use application modules directly

The harness should call application modules directly instead of using shell-level DB probing as the primary audit mechanism.

Why:
- shell probing is slow, inconsistent, and hard to repeat
- module-level calls preserve production semantics

### Avoid duplicate logic

The harness should not reimplement:
- next-session logic
- lifecycle week derivation
- generation
- load progression
- receipt construction

Instead it should compose:
- canonical next-session resolver
- `loadMappedGenerationContext`
- `generateSessionFromIntent` and deload equivalent
- canonical receipt readers/builders

### Make both derive-next and generate-session directly callable

The harness should support both:
- `resolveNextWorkoutContext()`
- `generateSessionFromIntent()`

And add a small shared wrapper for:
- `generateResolvedNextWorkout()`

That is the core design change needed to remove current audit friction.

### Support audits with and without autoregulation

Recommended modes:
- `as-recorded`
- `forced-off`
- `forced-on`

This allows:
- isolating base generation behavior
- validating readiness adjustments explicitly
- running deterministic readiness regressions

### Handle current runtime state versus deterministic fixtures cleanly

Live mode:
- uses real application loaders
- reflects current DB state
- may include PII

Fixture mode:
- builds context from deterministic inputs
- avoids DB dependency where possible
- produces stable artifacts for regression tests

## Test strategy

The harness should support repeatable tests at two levels:
- fixture-backed audit snapshots
- narrow contract tests around critical derivations

### Fixture users and seeded scenarios

Use named fixtures for scenarios already protected by tests, such as:
- push week 3 regression
- pull week 2 continuity
- lifecycle threshold transitions
- carried core roles across mesocycles

### Regression snapshots for high-value scenarios

Add snapshot coverage for:
- `fixture-regression` JSON artifacts
- normalized, timestamp-redacted output only

Avoid:
- snapshotting live-state artifacts in CI

### Contract tests for week/session derivation

Protect:
- current mesocycle week derivation
- session-in-week derivation
- next-session source selection
- incomplete-workout priority rules

### Contract tests for volume-accounting scope

Protect:
- current mesocycle week filtering
- performed-status inclusion rules
- current workout exclusion from prior-session counts
- projected total calculations

### Contract tests for continuity-budget decisions

Protect:
- continuity floors by role exercise
- weekly target caps
- W4 continuity hold behavior

### Contract tests for progression/load anchoring

Protect:
- same-intent history preference
- top-set versus back-off anchor handling
- modal load semantics
- bodyweight continuity handling
- deload-history exclusion at new mesocycle start

## Operational and debug UX

Recommended primary interface:
- CLI

Recommended command patterns:
- `npm run audit:workout -- --mode next-session --owner owner@local`
- `npm run audit:workout -- --mode intent-preview --owner owner@local --intent push`
- `npm run audit:workout -- --mode historical-compare --workout-id <id>`
- `npm run audit:workout -- --mode fixture-regression --fixture push-w3s1-regression`
- `npm run audit:workout -- --mode next-session --owner owner@local --diff-against artifacts/audits/<prior>.json`

Recommended artifact outputs:
- `artifacts/audits/<timestamp>-<slug>.json`
- optional `.md` summary alongside the JSON artifact

Optional internal debug route:
- should use the same underlying audit service
- should remain internal-only
- should not be the primary supported interface in Phase 1

Diff mode should compare at least:
- selected exercises
- filtered exercises
- set targets
- lifecycle targets
- progression/load anchors
- deload decision
- warnings and violations

## Risks and design decisions

### Coupling to live DB state

Tradeoff:
- required for true next-session audits
- should be isolated to context building only

### Privacy and safety of debug output

Tradeoff:
- live artifacts may contain owner identity, readiness, notes, and training history
- redactable output should be built in from the start

### Brittleness of full snapshots

Tradeoff:
- full live snapshots will be noisy and unstable
- fixture snapshots should be the main CI target

### Explainability persistence versus on-demand computation

Recommendation:
- persist canonical session decision receipt in the normal runtime path
- generate richer audit explainability on demand rather than storing every audit artifact

### Internal-only exposure

Recommendation:
- expose the harness only to internal engineering surfaces
- CLI first, optional internal route second

## Proposed phased rollout

### Phase 1 - Core audit module, shared derivation seam, CLI, structured JSON
Status: NOT STARTED

Goal:
- Establish the minimum first-class audit capability without changing runtime generation behavior.

Focus:
- Extract canonical next-session derivation from `program.ts`
- Build normalized audit request/context/result types
- Implement audit context builder and generation runner
- Add CLI entrypoint
- Emit versioned JSON artifacts

Recommended implementation order:
1. Extract `src/lib/api/next-session.ts` from the current `loadHomeProgramSupport()` logic and switch `program.ts` to consume it without behavior change.
2. Add audit request/result types under `src/lib/audit/workout-audit/types.ts`.
3. Implement a minimal `context-builder.ts` that supports only `next-session` and `intent-preview`.
4. Implement a minimal `generation-runner.ts` that composes existing production generation entrypoints rather than wrapping new business logic around them.
5. Implement `serializer.ts` for stable JSON ordering.
6. Add `scripts/workout-audit.ts`.
7. Add focused tests for next-session derivation ownership and one smoke path for each supported mode.

Exit criteria:
- engineers can run repeatable `next-session` and `intent-preview` audits without shell/database forensics

Suggested Phase 1 file set:
- `src/lib/api/next-session.ts`
- `src/lib/api/next-session.test.ts`
- `src/lib/audit/workout-audit/types.ts`
- `src/lib/audit/workout-audit/context-builder.ts`
- `src/lib/audit/workout-audit/generation-runner.ts`
- `src/lib/audit/workout-audit/serializer.ts`
- `scripts/workout-audit.ts`

Suggested Phase 1 validation:
- focused unit tests for `next-session.ts`
- one direct module smoke test for `next-session`
- one direct module smoke test for `intent-preview`
- `npx tsc --noEmit`
- targeted lint on touched files

### Phase 2 - Deterministic fixtures and regression tests
Status: NOT STARTED

Goal:
- Turn the highest-value audit scenarios into stable regression fixtures.

Focus:
- Add fixture adapters
- Add snapshot artifacts for protected scenarios
- Add contract checks for lifecycle, volume-accounting, continuity, and progression

Exit criteria:
- fixture regressions catch drift in push/pull/lifecycle/progression scenarios

### Phase 3 - Richer explainability, diff mode, optional internal debug UI
Status: NOT STARTED

Goal:
- Make audits easier to compare and review over time.

Focus:
- Add diff mode between two artifacts or fixture runs
- Add richer explainability dump renderer
- Add optional internal route or server-only debug UI wrapper

Exit criteria:
- audit output is easy to compare and review during future engine changes

## Decisions, open questions, and assumptions

Assumptions:
- `loadHomeProgramSupport()` now contains the de facto next-session derivation logic and should be the extraction source for a canonical next-session service.
- deterministic fixture mode can build `MappedGenerationContext` directly, because current regression tests already prove that seam works.
- this harness remains an internal engineering capability, not a user-facing feature.

Phase 1 readiness note:
- This design is ready to start as long as implementation stays scoped to the shared next-session seam plus a JSON-first CLI for `next-session` and `intent-preview`.

Decision:
- `historical-compare` should use current exercise-library and current contracts by default.

Why:
- The main value of historical compare is checking whether an older persisted workout still satisfies the current generation, lifecycle, receipt, and explainability contracts.
- That is the most actionable review mode during refactors.
- Historical snapshot replay would require a larger versioning system for exercise-library state, lifecycle logic, and possibly schema-era normalization. That should be treated as a later expansion, not a Phase 1 requirement.

Follow-up:
- If needed later, add an optional comparison basis such as `current-contracts` versus `historical-snapshot`.

Decision:
- Audit artifacts should remain generated in local runs and CI by default, with only a very small curated deterministic fixture set eligible for committed snapshots.

Why:
- Broad artifact commits will create repository noise and brittle diffs.
- Live-state artifacts are especially unstable and may contain sensitive context.
- A small committed snapshot set is still useful for a few protected fixture scenarios where structured diffs are high signal.

Recommended initial committed fixture candidates:
- push week 3 regression
- pull week 2 continuity
- lifecycle threshold transition

Decision:
- Phase 1 should remain generation-focused, but the harness should be designed so multi-step flow audits can be added cleanly in a later phase.

Why:
- The immediate audit pain is around derivation, generation, lifecycle context, continuity, volume accounting, and progression evidence.
- A full `generate -> save -> lifecycle transition -> next-session` scenario expands scope into persistence and state-mutation simulation.
- That end-to-end scenario is valuable, but it should follow the core harness once the canonical audit request, context, and result contracts exist.

Planned future extension:
- add a multi-step scenario mode after Phase 1 for `generate -> save -> lifecycle transition -> next-session` validation
