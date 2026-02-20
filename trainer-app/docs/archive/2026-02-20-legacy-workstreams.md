# DEPRECATED: Legacy Workstream Docs Bundle

Owner: Aaron  
Last reviewed: 2026-02-20  
Purpose: Tombstone for removed workstream documentation folders that were high-drift and non-canonical.

This doc covers:
- Removed workstream documentation categories
- Canonical replacements

Invariants:
- Planning/debug/audit artifacts do not live in canonical docs paths.

Sources of truth:
- `trainer-app/docs/00_START_HERE.md`
- `trainer-app/docs/06_TESTING.md`
- `trainer-app/docs/07_OPERATIONS.md`

Date archived: 2026-02-20  
Why deprecated: Prior workstream folders (`analysis`, `audits`, `debug`, `plans`, `specs`, `template`, `tests`) were high-drift, speculative, or duplicated implementation details.

What replaced it:
- Canonical runtime docs under `docs/01_ARCHITECTURE.md` through `docs/07_OPERATIONS.md`
- Runtime contracts under `docs/contracts/runtime-contracts.json`

Salvaged sections:
- Only validated operational/test commands retained in `docs/06_TESTING.md` and `docs/07_OPERATIONS.md`
