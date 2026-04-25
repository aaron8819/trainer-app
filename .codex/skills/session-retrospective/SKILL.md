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

## Minimum Value Requirement

The retrospective must include at least ONE concrete improvement to:

- prompt wording, OR
- workflow sequencing, OR
- repo/architecture understanding

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

## Prompt Improvements

Include at least one of:

- a prompt that worked well
- a prompt that caused confusion
- an improved version for reuse

Focus on making future prompts clearer and more precise.

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

## Challenges Encountered
- Prompt ambiguities:
- Repo/seam confusion:
- Hidden coupling:
- Test/audit issues:
- Incorrect assumptions corrected:

## Process Improvements
- Better prompt wording next time:
- Better task sequencing:
- Better verification strategy:
- Commands/artifacts to capture earlier:
- Things to avoid repeating:

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

## Avoid Next Time
- 1:
- 2:
- 3:

## Follow-Up Recommendations
1. Must do:
2. Should do:
3. Defer:

## Workflow Skill Improvements
- Existing skills to update:
- New skill ideas:
- AGENTS.md updates:
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
