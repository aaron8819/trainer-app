---
name: test-impact-triage
description: Review the repository-selected verification plan for a known Trainer change surface. Use after the owning seam and diff are known to judge whether selected local checks are sufficient, identify prerequisite or authorization gates, interpret failures, and state residual risk. Do not use to discover architecture or invent path-to-check policy.
---

# Test Impact Triage

Use deterministic repository policy for check selection and human judgment for sufficiency and interpretation.

## Generate and inspect

Run:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>
```

Confirm:

- the base is the authorized comparison point
- changed-path provenance represents the actual diff
- the owning seam matches the selected implementation and release checks
- warnings and blockers are classified correctly
- domain-specific validation is present when the change claims domain output

Do not restate path mappings, prerequisites, side-effect classifications, release rules, or execution eligibility. `scripts/codex/trainer-policy.v1.json` and the command registry own them.

## Decide what may run

Before eligible local execution, use `.\scripts\codex\Invoke-TrainerDoctor.ps1`.

Planning is the default. Use `-Run` only when the plan marks a local implementation check executable, its prerequisites are present, and the requested workflow authorizes it. Leave release-only and separately authorized checks visible but unexecuted.

Route the audit question and output-level mode decision to `audit-workflow`. Use `receipt-integrity` or `seed-runtime-source-of-truth` when those specialized contracts are affected.

## Interpret results

- Compare a failure with the authorized base by test identity and environment before calling it a regression.
- A passed local plan proves only the seams exercised by its checks.
- A selected but unavailable check is an unresolved gate, not a pass.
- A release check remains release work until it runs in the correct authorized context.
- An audit or database-dependent check remains separately authorized even when selected.

## Required output

Report:

1. change classification and owning seam
2. authorized base and changed-path provenance
3. selected implementation checks and reasons
4. selected release or separately authorized checks and reasons
5. doctor warnings or prerequisite blockers
6. executed, skipped, and unresolved checks
7. result interpretation, including base comparison when needed
8. residual risk and what the plan does not prove

For each executed command, include exit code and result using the side-effect classification supplied by repository tooling.
