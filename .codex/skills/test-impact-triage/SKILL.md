---
name: test-impact-triage
description: Select and interpret the minimum sufficient Trainer verification plan for a proposed or completed diff. Use after the owning seam is known to review repository-selected checks, decide whether local implementation checks may run, and report release-only or authorization-gated follow-up without duplicating policy rules.
---

# Test Impact Triage

Use the repository verification planner as the deterministic source of check selection. This skill supplies judgment: confirm the owning seam, review why checks were selected, decide whether eligible local checks should run, and state what the plan does not prove.

## Use this skill

Use it after implementation or while reviewing an existing diff. If ownership is unclear, route to `seam-locator`; if edits still need planning, route to `implementation-planner`; if generated or projected training output is affected, pair it with `workout-generation-audit`.

Do not copy path-to-test mappings, prerequisite definitions, side-effect tables, mutation flags, or executable eligibility into this skill. `scripts/codex/trainer-policy.v1.json` and the command registry own those facts.

## Generate the plan

From the repository root, run:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>
```

Use explicit changed paths or a valid Phase 1 JSON manifest only when the workflow genuinely needs a machine-readable handoff. Planning is the default and must execute nothing.

Review the plan before execution:

- confirm the base is the authorized comparison point
- confirm changed-path provenance matches the intended diff
- explain why each implementation and release check was selected
- distinguish warnings from blockers
- treat a missing prerequisite as a blocker for the affected check
- leave unsafe, release-only, and authorization-gated commands visible but skipped
- never override policy or registry eligibility through prose

## Environment readiness

Before using `-Run`, invoke:

```powershell
.\scripts\codex\Invoke-TrainerDoctor.ps1
```

The default local-only doctor is the norm. Missing optional tools are warnings. Missing required prerequisites block affected execution. The doctor does not install, authenticate, repair, connect, migrate, deploy, or request environment values; remote scopes require an explicit need and authorization.

Use `-Run` only when all of the following are true:

- the user-authorized workflow allows local implementation checks
- the plan marks the command executable in implementation mode
- required local prerequisites are present
- the command does not require separate database, network, production, release, or destructive authorization

Do not use `-Run` merely because the plan exists. Do not make GitHub, Vercel, or database scopes automatic. Invoke `Invoke-TrainerRemoteStatus.ps1 -Deployment` only when live Vercel state is needed and explicitly authorized; stop on expected/observed identity mismatch.

## Domain and release follow-up

The planner selects registered checks; it does not replace domain judgment. Route audit-mode selection to `audit-workflow`, generation-facing QA to `workout-generation-audit`, receipt checks to `receipt-integrity`, and seed/runtime checks to `seed-runtime-source-of-truth`.

For database or migration diffs, report the task's database policy and relevant local checks, but keep connectivity, migration execution, backups, production reads, and all writes separately authorized. For release or incident work, the explicit `-Deployment` scope may establish read-only active Vercel deployment truth after exact identity validation; GitHub deployment records remain distinct, and a reported rollback candidate is not an authorized or proven-safe rollback. Do not imply that local Phase 1–3 checks or Vercel status can verify Supabase identity, the migration ledger, backups, write pause, rollback safety, deployment authorization, or write resumption.

## Required output

Return:

1. **Change classification and owning seam**
2. **Authorized base and changed-path provenance**
3. **Selected implementation checks and reasons**
4. **Selected release checks and reasons**
5. **Doctor warnings and prerequisite blockers**
6. **Checks executed, skipped, or still operator-authorized**
7. **Whether contract, broad verification, or domain audit coverage is selected**
8. **Residual risk / what the plan does not prove**

For every executed command, include its exit code, result, and side-effect classification. Say `none` explicitly when a category is empty.
