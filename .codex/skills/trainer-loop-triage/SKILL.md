---
name: trainer-loop-triage
description: Classify Trainer repo work into safe autonomous loops and draft bounded goal prompts. Use when the user asks what Codex should do next, wants autonomous workflow planning, daily or recurring repo triage, loop design, safe next-task selection, or a bounded `/goal` prompt for this Trainer repo.
---

# Trainer Loop Triage

Select the safest next autonomous loop for the Trainer repo. This skill is a control-plane workflow: inspect, classify, draft a bounded goal prompt, and stop at the right gate. It does not replace implementation or domain skills.

## Hard Boundary

Default to read-only. Do not edit files, mutate the database, create branches, push, open/close GitHub items, run repair/backfill scripts, or start implementation unless the user explicitly asks for that action.

This skill never overrides:

- `seam-locator`
- `architecture-guard`
- `implementation-planner`
- `test-impact-triage`
- `workout-generation-audit`
- `audit-workflow`
- `receipt-integrity`
- `seed-runtime-source-of-truth`
- `v2-planner-migration-guard`

Use this skill above those skills: decide which loop is safe, then invoke the owning skill when implementation or validation begins.

## Preflight

1. State the operating classification: `read-only audit`, `small write`, `shared seam write`, `DB/migration`, or `destructive cleanup`.
2. Read `AGENTS.md` when the current context does not already contain the active repo instructions.
3. Run `git status --short --branch`.
4. If the worktree is dirty from overlapping work, stop and ask before proposing writes.
5. Read only relevant durable memory:
   - `.codex/napkin.md` or `.Codex/napkin.md` for user preferences, patterns that work, and recent mistakes.
   - Nearby docs only when a candidate touches an app seam.

## Repository tooling

For implementation, audit, migration, release, or incident work, begin at the repository root with the inspect-only task classifier when the task name and authorized base are known:

```powershell
.\scripts\codex\Start-TrainerTask.ps1 `
  -Name <task-name> `
  -Classification <classification> `
  -BaseBranch <authorized-base>
```

Choose the policy classification by workflow: `audit` for read-only work, `application-write` for bounded app/UI work, `shared-seam-write` for shared code or skill workflows, `db-migration` for database or migration work, and `release-incident` only for explicitly requested release or incident assessment. The versioned policy owns path rules, database policy, prerequisites, and verification selection; do not reproduce those tables in a goal prompt.

- Stop on blockers. Report warnings separately and explain whether they affect the chosen loop.
- Respect allowed and forbidden paths and the reported database policy.
- Classification does not grant database, production, release, or destructive authorization.
- Phase 1 is inspect-only. It must not be described as creating a branch or worktree.

Before executing local checks that depend on tools or dependencies, run `.\scripts\codex\Invoke-TrainerDoctor.ps1`. Missing optional tools are warnings; missing required prerequisites block only affected execution. The doctor does not install, authenticate, repair, connect, migrate, or deploy. Keep its default scopes local unless an explicit, authorized need justifies a remote scope, and do not request credentials or environment values that the doctor can inspect safely.

After implementation, or when reviewing an existing diff, route to `test-impact-triage` to generate and review:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>
```

Planning is the default. Use `-Run` only for registry-approved local implementation checks after reviewing the plan. Keep unsafe, release-only, and authorization-gated commands visible but skipped and report them separately.

## Workflow routing

- Route unclear application ownership to `seam-locator`, then non-trivial edits to `implementation-planner` and `architecture-guard`.
- Route generated or projected training output to `workout-generation-audit`; route audit-mode and artifact interpretation to `audit-workflow`.
- Route receipt-backed work to `receipt-integrity`, and accepted seed/runtime work to `seed-runtime-source-of-truth` plus `v2-planner-migration-guard` when V2 is involved.
- Route database or migration work through the `db-migration` inspection policy, then to `implementation-planner`; stop before connectivity, migrations, direct SQL, backups, or writes without the exact required authorization.
- Route release or incident assessment through `release-incident` inspection only when explicitly needed. Phase 1–3 do not orchestrate a release or incident response.
- Route completed substantial work to `session-retrospective` only when its trigger gate is met.

Deployment status, GitHub control-plane state, Vercel deployment identity, Supabase project identity, migration ledger, backups, write pause, rollback, deployment, and write resumption remain outside Phase 1–3 local tooling unless separately verified and authorized.

## Candidate Discovery

Use the smallest useful inspection set. Typical read-only probes:

```powershell
git status --short --branch
git diff --stat
rg -n "TODO|FIXME|next safe|follow-up|blocked|candidate" trainer-app/docs .codex .Codex
rg --files trainer-app/src -g "*.test.ts" -g "*.test.tsx"
```

If GitHub triage is requested and `gh` is available, inspect current-repo issues and PRs only. Do not broaden to other repos unless the user explicitly asks.

## Classification Ladder

Classify every candidate into exactly one bucket.

### Read-Only Candidate

Safe to run as an autonomous loop without code edits:

- repo status summaries
- issue/PR triage
- audit artifact interpretation
- verification-stack recommendation
- docs or skill contradiction scans
- drafting a bounded `/goal` prompt

### Bounded Write Candidate

Potentially safe only after explicit user authorization:

- workflow or skill instruction edits
- narrow docs updates with no behavior claims
- focused readout wording changes
- test fixture reconciliation after proving behavior did not change
- small UI/read-model changes with a clear owner seam and nearby tests

Require an isolated worktree if the write touches shared seams or could overlap active work.

### Human-Gated Candidate

Requires owner approval before implementation:

- generation behavior
- lifecycle transitions
- receipts or receipt-derived meaning
- seed/runtime replay or accepted seed shape
- V2 production policy or materialized seed promotion
- acceptance gate behavior
- validation-backed contracts
- Prisma schema, migrations, repair scripts, or DB writes
- broad refactors across `src/lib/api`, `src/lib/engine`, or audit seams

### Do-Not-Touch Candidate

Stop instead of drafting an execution loop when:

- owner/source of truth is unclear
- worktree dirtiness overlaps the candidate
- DB mutation is possible but not explicitly requested
- runtime would consume planner metadata
- seed shape would change without explicit approval
- destructive cleanup is proposed
- verification cannot prove the intended behavior

## Choose One Next Action

Recommend one best next loop, not a backlog dump. Prefer:

1. read-only evidence loop
2. bounded write loop with explicit stop conditions
3. human decision brief
4. no action when risk is not justified

When a candidate is implementation-worthy, produce a bounded `/goal` prompt instead of starting the work unless the user explicitly asked to implement.

## Bounded Goal Prompt Requirements

Keep the prompt under 4k characters. Include:

- mission
- current context
- operating classification
- owner seam if known
- required skills
- allowed write paths
- forbidden paths
- DB policy
- process steps
- verification commands
- stop conditions
- final report format

The prompt must tell the worker to stop before DB mutation, destructive cleanup, seed shape changes, runtime planner-metadata consumption, production V2 write behavior, unclear ownership, or overlapping dirty files.

## Required Output

Return this structure:

````markdown
**Loop Classification**
- Mode:
- Repo state:
- DB policy:

**Candidate Triage**
- Read-only:
- Bounded write:
- Human-gated:
- Do not touch:

**Best Next Action**
- Recommendation:
- Why this is highest value:
- Required skills:
- Allowed paths:
- Forbidden paths:
- Verification:

**Suggested /goal Prompt**
```text
<bounded prompt, or "none">
```

**Stop Conditions**
- ...

**Residual Risk**
- ...
````

Keep the answer concise and decision-oriented. If no safe autonomous work exists, say that directly and name the exact blocker.
