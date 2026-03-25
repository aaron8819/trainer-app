---
name: audit-workflow
description: Standardize Trainer audit-harness routing and artifact interpretation. Use when running or reading workout-audit artifacts, choosing between `future-week` and `projected-week-volume`, checking audit CLI runtime targeting or owner resolution, or improving audit/reporting workflows without changing generation policy.
---

# Audit Workflow

Route audit questions to the correct harness mode before proposing fixes. Preserve the difference between next-session projection, full current-week projection, runtime targeting, and real engine defects.

## Read only what you need

1. Read `AGENTS.md`.
2. Read `trainer-app/docs/09_AUDIT_PLAYBOOK.md` for mode semantics and artifact fields.
3. Read `trainer-app/docs/07_OPERATIONS.md` only when runtime targeting or owner resolution matters.

## Hard rules

- Do not use `future-week` to answer full-week coverage questions.
- Do not use `projected-week-volume` to explain a single next-session routing anomaly.
- Do not infer structural underdosing from a mid-week `future-week` snapshot.
- Do not change generation logic when the issue is only audit CLI, serializer, reporting, or interpretation.
- Do not use manual workout edits as the fix for an audit or reporting problem.
- Do not expand into architecture redesign when the issue is readout or tooling only.

## Choose the mode

Start by restating the exact audit question.

- Use `future-week` for next-session preview, midstream projection, explicit-intent preview, warning review, or standard-vs-deload routing checks.
- Use `projected-week-volume` for full current-week projected muscle volume, completed-plus-remaining slot coverage, and weekly target / MEV / MAV attainment.
- If the task mixes both questions, run or interpret both modes separately and keep the conclusions separate.

## Check runtime targeting first

Before trusting the artifact, confirm the runtime target.

- If the task names a concrete owner, pass `--user-id` or `--owner`.
- If neither flag is provided, remember the audit CLI follows app-default owner resolution: `OWNER_EMAIL` when present, otherwise `owner@local`.
- If the artifact owner, week, or phase is not the intended runtime, stop and correct targeting before interpreting semantics.

## Interpret truthfully

For `future-week`, read these first:

- `generationPath`
- `warningSummary`
- `sessionSnapshot.generated.semantics`
- relevant progression or deload traces

Interpretation frame:

- This is next-session truth, not full-week truth.
- It can show routing, warnings, and generated session semantics.
- It cannot prove weekly underdosing by itself.

For `projected-week-volume`, read these first:

- `projectedWeekVolume.currentWeek`
- `projectedWeekVolume.projectionNotes`
- `projectedWeekVolume.projectedSessions`
- `projectedWeekVolume.fullWeekByMuscle`

Interpretation frame:

- This is full current-week projection from completed plus remaining advancing slots.
- Read `projectionNotes` before trusting the totals.
- Mid-week deficits are not structural failures if remaining projected slots close the gap.

## Classify the issue

- `tooling/readout`: wrong mode, misleading labels, missing caveat, serializer/report mismatch, or targeting confusion
- `runtime correctness`: wrong owner/week/phase, stale runtime assumptions, or artifact aimed at the wrong state
- `real engine allocation/policy issue`: correctly targeted artifact from the correct mode still shows a real generation or volume problem

## Recommend the next step

- `no action` when the artifact answers the question once interpreted correctly
- `design-only` when wording, workflow, docs, or output framing should improve without code
- `implementation` when audit harness or reporting behavior must change, or when correctly targeted artifacts prove a real engine/policy defect

If the issue is tooling or readout only, keep the change in the audit/reporting seam. Escalate into generation or policy only when the correct artifact supports that conclusion.

## Verification

- For read-only audit interpretation tasks, make no code changes.
- For audit harness or reporting changes, run focused tests for the changed audit files plus one targeted live audit command for the affected mode before broader verification.
- Preserve existing audit mode semantics unless the task explicitly changes them.
- Reach for broader verification only when shared CLI parsing, contracts, or reused audit seams changed.

## Required output

Return:

- the clarified audit question
- the chosen audit mode
- the runtime-targeting check
- the truthful interpretation frame
- the issue classification: `tooling/readout`, `runtime correctness`, or `real engine allocation/policy issue`
- the recommended next step
