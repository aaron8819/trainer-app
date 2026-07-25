# Trainer Repository Memory

Use this file for durable, repository-specific lessons that are likely to prevent repeated mistakes. It is not project status, architecture authority, or a substitute for `AGENTS.md`, canonical documentation, skills, or deterministic tooling.

## Windows search and PowerShell

- Search real directories with `rg` and constrain filenames with `-g`; wildcard path segments are unreliable on Windows.
- Use `Get-Content -LiteralPath` and other `-LiteralPath` forms for bracketed Next.js App Router paths.
- Prefer single-quoted PowerShell search patterns when they contain dollar signs, quotes, Markdown backticks, pipes, or other punctuation that PowerShell could interpret.

## Verification interpretation

- Focused Vitest success does not replace TypeScript validation after shared TypeScript shapes change; transpilation can miss typed fixture or consumer drift.
- When base and branch both fail, compare failed tests by stable test identity under the same environment. Aggregate totals alone do not establish whether a regression is new.
- Verify file ownership and tracking with `git ls-files` and `git status`. Ignore rules, path casing, or machine-local labels do not prove whether a file belongs in a commit.
- Constrained deterministic inventories can produce identical executable rows across capacity profiles even when capacity contracts and accepted intent differ. Lifecycle fixtures should assert the mapped capacity contract, candidate linkage, and runtime inertness rather than require an executable-set delta.

## Evidence and source boundaries

- Keep audit evidence, executable truth, and write authorization distinct. Diagnostic output can support a hypothesis without becoming runtime input or granting permission to mutate state.
- On case-insensitive Windows filesystems, `.Codex` and `.codex` address the same location. The exact tracked Git path for this file is `.codex/napkin.md`; use that casing consistently.

## Memory quality

- Add only lessons that are new, durable, non-obvious, repository-specific, and not better encoded in `AGENTS.md`, canonical documentation, a skill, or tooling.
- Consolidate or replace stale and duplicated lessons instead of appending indefinitely.
- Exclude temporary project status, live environment observations, completed-task history, benchmark snapshots, and mesocycle-specific conclusions.
