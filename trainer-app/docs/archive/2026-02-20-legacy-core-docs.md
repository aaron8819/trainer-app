# DEPRECATED: Legacy Core Docs Bundle

Owner: Aaron  
Last reviewed: 2026-02-20  
Purpose: Tombstone for legacy root docs that were merged into the canonical runtime IA.

This doc covers:
- Deprecation rationale for legacy root docs
- Replacement mapping to canonical docs

Invariants:
- Legacy root docs are not canonical and should not be restored as active references.

Sources of truth:
- `trainer-app/docs/00_START_HERE.md`
- `trainer-app/docs/01_ARCHITECTURE.md`
- `trainer-app/docs/03_DATA_SCHEMA.md`

Date archived: 2026-02-20  
Why deprecated: Legacy root docs (`architecture.md`, `data-model.md`, `decisions.md`, `index.md`) duplicated/contradicted current code and mixed historical planning with runtime behavior.

What replaced it:
- `docs/00_START_HERE.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DOMAIN_ENGINE.md`
- `docs/03_DATA_SCHEMA.md`
- `docs/04_API_CONTRACTS.md`
- `docs/05_UI_FLOWS.md`
- `docs/06_TESTING.md`
- `docs/07_OPERATIONS.md`

Salvaged sections:
- Route and module boundary references that still match `src/app`, `src/app/api`, `src/lib/api`, and `src/lib/engine`
- Runtime enum coverage now centralized in `docs/contracts/runtime-contracts.json`
