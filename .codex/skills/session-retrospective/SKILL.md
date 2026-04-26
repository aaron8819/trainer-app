---
name: session-retrospective
description: Produce a concise, evidence-based retrospective near the end of substantial Codex sessions involving multi-step implementation, bug investigation, audit harness validation, test/debug loops, failed first attempts followed by correction, architecture or seam discovery, prompt ambiguity, workflow/process lessons, or production blockers and recovery paths. Do not use for tiny edits, single-file trivial changes, formatting-only updates, simple Q&A, or purely mechanical rename/refactor work with no learning value.
---

# Session Retrospective

Capture useful, observable lessons from the completed session before the final response. Focus on what future Codex sessions, prompts, repo workflow, verification choices, and process docs can improve.

## Trigger Gate (Required)

Run this skill ONLY if at least one of the following is true:

- More than 3 files were modified
- A bug was investigated or fixed
- An audit or validation command was run
- A first attempt failed and required correction
- A new seam or architecture insight was discovered

Otherwise: do not run.

## Leverage Requirement

At least one retrospective recommendation must materially improve one of:

- future session success rate
- prompt quality or reusability
- repo workflow sequencing
- verification strategy
- audit harness effectiveness
- `AGENTS.md` or skill guidance
- canonical seam or invariant protection

Low-impact formatting or wording-only suggestions do not satisfy this requirement unless the observed session shows they directly prevented confusion, delay, or rework.

If no high-leverage improvement is supported by evidence, explicitly state:

"No high-leverage improvements identified from the available evidence."

## Minimum Value Requirement

The retrospective must include at least ONE concrete improvement that is both:

- evidence-backed, and
- assigned to a destination such as prompt wording, workflow sequencing, verification strategy, `AGENTS.md`, an existing Codex skill, a new Codex skill idea, audit harness/test coverage, or repo documentation.

If none exist, explicitly state:

"No meaningful improvements identified."

## Evidence Rule

Base all insights ONLY on observable evidence:

- files changed
- commands run
- test results
- audit artifacts
- errors encountered
- corrections made

Do NOT include:

- hidden reasoning
- vague statements
- generic advice
- unsupported guesses

## Output Constraints

- Be concise (target 300-700 words)
- Prefer bullet points over paragraphs
- Avoid repetition
- Avoid filler language
- Omit sections or bullets that do not apply.
- Do not duplicate the normal final answer; include only retrospective-specific lessons and artifacts.
- Rank action items by leverage and urgency.
- Do not require code, docs, or process changes solely because the retrospective ran.

## What To Capture

Include lessons about:

- prompt quality and ambiguity
- workflow quality and task sequencing
- repo/process insights
- verification strategy
- hidden coupling discovered
- test or audit gaps
- architecture and canonical-seam lessons
- future skill or `AGENTS.md` improvements

## Architecture Signal For Planning Audits

When the session touches generation, projection, slot allocation, repair, mesocycle explainability, or workout-audit output and the artifact includes `planningReality`, include a concise `Architecture Signal` subsection. Base it only on:

- `planningReality.summary.planningShape`
- `planningReality.summary.materialRepairCount`
- `planningReality.summary.majorRepairCount`
- `planningReality.warnings`
- `planningReality.repairMateriality`
- `planningReality.exerciseConcentration`
- `planningReality.slotDemandAllocation`

Report whether the evidence suggests upstream architecture improvement, downstream patch risk, or safe tooling/readout improvement. Do not stop at "tests passed" when `planningReality` is available.

Use this compact form:

```markdown
## Architecture Signal
- planningShape:
- materialRepairCount:
- majorRepairCount:
- key warning codes:
- highest-leverage next move:
```

Interpretation:

- Mostly repair-shaped -> recommend upstream WeeklyMuscleDemand -> SlotDemandAllocation ownership before selection.
- Mixed upstream plus repair-shaped -> name the muscles/slots that need upstream promotion.
- Mostly upstream-planned -> focus on validators, set distribution quality, and concentration guardrails.
- Missing or incomplete planningReality -> say instrumentation is insufficient and avoid architecture claims.

## High-Leverage Actions

Replace passive follow-ups with ranked, destination-bound actions. Each action must include:

- Action
- Evidence
- Target destination/seam/file
- Expected impact
- Priority: Must do / Should do / Defer
- Timing: next session / next similar task / next mesocycle / repo docs / skill update

Only include actions supported by the session evidence. Prefer one to three high-signal actions over long lists.

## System Injection Points

State where each durable lesson should live. Choose one or more:

- Prompt library
- `AGENTS.md`
- Existing skill
- New skill
- Repo docs
- Test/audit harness
- Engine/API/UI seam
- No persistent change recommended

If no persistent change is warranted, say so and give the evidence-based reason.

## Prompt Improvements

Include at least one of:

- a prompt that worked well
- a prompt that caused confusion
- an improved version for reuse

Focus on making future prompts clearer and more precise.

## Convert to Reusable Asset

If the session produced a repeatable lesson, identify whether it should become one of:

- reusable prompt
- `AGENTS.md` rule
- Codex skill update
- new Codex skill
- audit harness check
- test pattern
- repo doc note

If yes, provide the exact proposed artifact text or a concise draft. If no, say why not.

## Useful Commands / Artifacts

List commands, scripts, or artifacts that were especially useful.

Examples:
- audit harness commands
- test commands
- debugging commands

## Avoid Next Time

List 1-3 specific things that caused friction, confusion, or rework.

Be concrete and actionable.

## Required Output

```markdown
## Session Outcome
- Goal:
- Result:
- Files/seams changed:
- Verification:

## Evidence Summary
- Files changed:
- Commands/tests/audits:
- Errors/corrections:
- Artifacts:

## Challenges Encountered
- Prompt ambiguities:
- Repo/seam confusion:
- Hidden coupling:
- Test/audit issues:
- Incorrect assumptions corrected:

## High-Leverage Actions
1. Action:
   Evidence:
   Target destination/seam/file:
   Expected impact:
   Priority: Must do / Should do / Defer
   Timing: next session / next similar task / next mesocycle / repo docs / skill update

## System Injection Points
- Prompt library:
- AGENTS.md:
- Existing skill:
- New skill:
- Repo docs:
- Test/audit harness:
- Engine/API/UI seam:
- No persistent change recommended:

## Prompt Improvements
- Worked well:
- Caused confusion:
- Reusable improved prompt:

## Useful Commands / Artifacts
- Commands:
- Scripts/artifacts:

## Repo / Architecture Insights
- Canonical seams confirmed:
- Fragile seams discovered:
- Invariants to preserve:
- Docs/AGENTS/skills worth updating:

## Convert to Reusable Asset
- Asset type:
- Draft text:
- Why / why not:

## Avoid Next Time
- 1:
- 2:
- 3:
```

## Final Response Placement

When this skill runs and produces retrospective content, append that content to the final user-facing response after the normal answer. The retrospective must be visible to the user, clearly separated from the main result, and must not replace the main answer.

Use this wrapper exactly:

```markdown
## Session Retrospective

<retrospective output>
```

Preserve the normal final answer first. Append the retrospective only after that answer, keep it concise and skimmable, omit empty sections, and preserve useful command or artifact paths.

If the user requested a specific final format, include the retrospective only when it does not conflict with that format; otherwise preserve the requested final format and include the retrospective-relevant findings in the closest compatible user-facing section. Do not expose hidden reasoning, private scratchpad notes, or unsupported internal process.
