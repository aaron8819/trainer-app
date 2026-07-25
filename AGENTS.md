# Trainer Repository Guidance

## Scope and entry points

- Most active code lives in `trainer-app/`; run app, test, Prisma, and audit commands there.
- Start documentation discovery at `trainer-app/docs/00_START_HERE.md`.
- Keep routes and pages thin. Put DB-backed orchestration and read models in `trainer-app/src/lib/api`, pure domain logic in `trainer-app/src/lib/engine`, shared session meaning in `trainer-app/src/lib/session-semantics`, and persistence work in `trainer-app/prisma`.
- Route detail to the owning document: `02_DOMAIN_ENGINE.md` for engine behavior, `03_DATA_SCHEMA.md` for persistence, `04_API_CONTRACTS.md` for routes/contracts, `05_UI_FLOWS.md` for UI flows, `06_TESTING.md` for verification, `07_OPERATIONS.md` for operational safety, and `09_AUDIT_PLAYBOOK.md` for audit usage, all under `trainer-app/docs/`.

## Startup model

1. Understand the user request together with the applicable instruction hierarchy.
2. Classify the task type, scope, authorization, and risk.
3. Load only skills relevant to that task.
4. Read `.codex/napkin.md` only when repository instructions require memory or prior repository failure patterns are materially relevant.
5. Inspect the actual ownership seams, current implementation, nearby tests, and other repository evidence needed for the task.
6. Plan or implement only within the authorized scope.
7. Apply verification proportional to the affected seams and risk.
8. Record a retrospective or memory lesson only when writing is authorized and a genuinely new durable lesson exists.

Optional unavailable skills are a normal fallback condition. Stop only when the task truly depends on the missing capability; otherwise continue with the best safe repository-native workflow.

## Authority and design direction

- Current code, schema, and tests are authoritative for confirmed present behavior.
- Explicitly labeled north-star documents describe intended architectural direction.
- North-star direction may guide design, but do not report it as implemented behavior without repository evidence.
- When intended direction and implementation differ, state the distinction and identify the owning seam instead of silently choosing one.
- Prefer changing the rightful owner over patching downstream consumers. If ownership or the source of truth remains unclear after investigation, stop before writing.

## Authorization and worktrees

- Respect the user’s requested scope and preserve unrelated tracked, untracked, ignored, and machine-local files.
- Use an isolated Trainer worktree for implementation work, normally under `C:\Users\aabloch\claude\vibe-coding\.worktrees\trainer\<task>` on a `codex/<task>` branch.
- Before creating or reusing a worktree, verify the exact path and branch, base revision, worktree registration, and dirty state. Do not write in a worktree containing overlapping changes.
- Keep writes inside the authorized worktree. Do not clean up worktrees or branches unless that destructive action is explicitly authorized.
- Scale preflight and reporting to the task. Do not apply release-grade ceremony to a read-only inspection or small isolated edit unless its risk requires it.

## Safety boundaries

- Database inspection is read-only by default. Migrations, direct SQL, seeds, repairs, backfills, acceptance commands, or any other database mutation require explicit authorization for the exact environment and action.
- Destructive cleanup, deployment, release, remote-provider writes, and production actions require their specialized safety gates and explicit scope. See `trainer-app/docs/07_OPERATIONS.md` and repository-owned tooling under `scripts/`.
- Never let audit tooling, diagnostics, previews, or debug artifacts mutate planning, generation, replay, persistence, or production behavior as a side effect.

## Planning and runtime truth

Keep these layers distinct:

```text
Planner authors intent.
Materializer translates intent.
Acceptance judges a candidate.
Accepted seed stores executable truth.
Runtime executes accepted truth.
Logs capture performed reality.
Audit and review provide evidence.
Repair is a safety net, not a plan author.
```

- When an immutable `MesocycleSeedRevision` exists, its `seedPayload` is the authoritative accepted executable truth.
- `slotPlanSeedJson` is compatibility or historical data in that case, not a competing runtime authority.
- Planner metadata, diagnostics, accepted intent, provenance, audit sidecars, and readouts are explanatory evidence unless a reviewed production seam explicitly promotes them.
- Runtime edits are session-local deviations unless an authorized canonical acceptance or reseed path promotes them.

## Tooling and verification

- Search before editing. Use `rg` for symbols and `rg --files` for file discovery; inspect the current surface, owning implementation, nearby tests, and callsites before changing behavior.
- Use repository-local dependencies, package scripts, and deterministic tooling. Do not recommend routine ad hoc `npx` execution or silently fall back to global or network-fetched tools.
- Prefer the smallest focused verification that exercises the owning seam. Expand to TypeScript, integration, contract, audit, or full verification only when shared shapes, cross-layer behavior, persistence, or release risk justify it.
- Compare branch failures with the base revision by test identity and environment before classifying them as regressions or baseline failures.
- When detailed command selection matters, use repository-owned verification policy and scripts rather than copying long command recipes into this file.
- Update canonical documentation only when behavior or contracts change, and only after code and tests establish the final behavior.

## Durable memory and retrospectives

- `.codex/napkin.md` is concise repository memory, not a second policy manual or project-status log.
- Read it only when prior failure patterns are relevant. Add or consolidate a lesson only when it is new, durable, repository-specific, non-obvious, and not better enforced by policy, documentation, a skill, or tooling.
- Retrospectives are conditional and concise. Use observable evidence from the completed work and include an actionable workflow improvement only when the session produced a reusable lesson.
