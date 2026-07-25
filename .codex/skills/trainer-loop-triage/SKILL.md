---
name: trainer-loop-triage
description: Select one bounded next Trainer work item, design a recurring or autonomous loop, or draft a focused `/goal` prompt. Use only when the user asks what Codex should do next, requests safe loop design or recurring triage, or wants a bounded Trainer goal prompt.
---

# Trainer Loop Triage

Act as a control plane. Inspect, choose one bounded loop, define its gates, and stop unless implementation was explicitly requested.

## Inspect

Use the smallest read-only evidence set needed to understand:

- repository and branch state
- current candidate work
- known ownership or missing ownership evidence
- overlap with active changes
- available deterministic verification

Use repository policy and task inspection for classification rather than copying its rules into the prompt.

## Classify candidates

Place each candidate in one category:

- read-only evidence
- bounded authorized write
- human decision required
- do not touch

Reject a candidate when ownership is unresolved, the proposed scope overlaps unowned changes, required validation is unavailable, or completing it would require authority not present in the request.

## Choose one next action

Prefer the smallest action that materially reduces uncertainty or completes a bounded outcome. Recommend one best loop, not a backlog.

When implementation was not requested, produce a `/goal` prompt instead of starting the work.

## Design the loop

The loop or prompt must name:

- mission and current evidence
- authorized base and operating classification
- canonical owner, or the discovery required to identify it
- allowed and forbidden scope
- relevant retained skills
- ordered work
- deterministic verification handoff
- explicit stop conditions
- final report

Do not reproduce skill routing tables, worktree rules, database policy tables, testing mappings, release rules, or retrospective requirements. Refer to the repository-owned policy, command registry, and applicable retained skill instead.

## Required output

Return:

- loop classification
- repository evidence
- best next action and why
- owner and bounded scope
- verification and stop conditions
- one focused `/goal` prompt, or `none`
- residual risk

Keep the goal prompt concise enough to remain a usable execution contract.
