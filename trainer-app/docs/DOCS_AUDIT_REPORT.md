# Docs Audit Report

Owner: Aaron  
Last reviewed: 2026-02-20  
Purpose: Records the full documentation audit, reorganization, and deprecation actions completed for the Trainer app repository.

Sources of truth:
- `trainer-app/src/app`
- `trainer-app/src/app/api`
- `trainer-app/src/lib/api`
- `trainer-app/src/lib/engine`
- `trainer-app/src/lib/validation.ts`
- `trainer-app/prisma/schema.prisma`

## Summary of changes
- Replaced sprawling docs tree with a strict canonical IA (`00` to `07` + contracts + archive).
- Rewrote docs to be code-first, single-user/local-first, and non-speculative.
- Merged legacy root docs (`architecture.md`, `data-model.md`, `decisions.md`, `index.md`) into canonical docs.
- Removed high-drift workstream docs (`analysis`, `audits`, `debug`, `knowledgebase`, `plans`, `specs`, `template`, `tests`) and legacy archive artifacts.
- Rebuilt `docs/archive/` with explicit deprecation tombstones.
- Updated `README.md` to minimal quickstart and docs entry point.
- Refreshed `docs/contracts/runtime-contracts.json` and retained compatibility with `scripts/check-doc-runtime-contracts.ts`.

## Inventory
| path | type | inferred purpose | status (KEEP / REWRITE / MERGE / ARCHIVE / DELETE) | conflicts-with-code? (Y/N) | reason |
|---|---|---|---|---|---|
| `trainer-app/README.md` | root-readme | project entry docs | REWRITE | Y | Removed stale architecture prose; now quickstart + docs entrypoint only |
| `trainer-app/docs/index.md` | index | old docs map | MERGE | Y | Replaced by `docs/00_START_HERE.md` |
| `trainer-app/docs/architecture.md` | architecture | runtime architecture narrative | MERGE | Y | Replaced by `docs/01_ARCHITECTURE.md` + `docs/02_DOMAIN_ENGINE.md` |
| `trainer-app/docs/data-model.md` | schema-doc | data model narrative | MERGE | Y | Replaced by `docs/03_DATA_SCHEMA.md` |
| `trainer-app/docs/decisions.md` | adr-log | design decisions history | MERGE | Y | Historical/duplicative; runtime facts moved into canonical docs |
| `trainer-app/docs/contracts/runtime-contracts.json` | contract-json | runtime enum contract source | REWRITE | N | Kept as canonical machine-readable contract file |
| `trainer-app/docs/analysis/*.md` | analysis-docs | deep-dive analyses | DELETE | Y | Speculative/historical and non-canonical |
| `trainer-app/docs/audits/*.md` | audit-docs | point-in-time audits | DELETE | Y | Time-bound diagnostics, not stable runtime docs |
| `trainer-app/docs/debug/*.md` | debug-docs | debugging artifacts | DELETE | Y | Episodic notes, high drift |
| `trainer-app/docs/knowledgebase/*.md` | research-kb | research literature notes | DELETE | N | Not runtime contract docs; removed from canonical corpus |
| `trainer-app/docs/plans/*.md` | planning-docs | plans/roadmaps | DELETE | Y | Future-oriented/speculative relative to current implementation |
| `trainer-app/docs/specs/*.md` | specs | versioned specs | DELETE | Y | Diverged from current code and duplicated behavior |
| `trainer-app/docs/template/*.md` | feature-specs | template algorithm docs | DELETE | Y | Duplicated engine behavior and drifted |
| `trainer-app/docs/tests/*.md` | test-docs | test strategy/how-to | DELETE | Y | Consolidated into `docs/06_TESTING.md` |
| `trainer-app/docs/archive/*.md` (legacy) | historical-archive | prior archived markdown | DELETE | N | Legacy archive replaced with explicit 2026-02-20 tombstones |
| `trainer-app/docs/archive/mobile-optimization-artifacts/**` | artifact-bundle | screenshots/bundle reports/checklists | DELETE | N | Historical artifacts; out of scope for runtime docs |
| `trainer-app/docs/archive/2026-02-20-legacy-core-docs.md` | archive-tombstone | deprecation marker | ARCHIVE | N | Explicit replacement map for merged root docs |
| `trainer-app/docs/archive/2026-02-20-legacy-workstreams.md` | archive-tombstone | deprecation marker | ARCHIVE | N | Explicit replacement map for removed workstream folders |
| `trainer-app/docs/archive/2026-02-20-legacy-knowledgebase.md` | archive-tombstone | deprecation marker | ARCHIVE | N | Explicit replacement map for removed research docs |
| `trainer-app/src/**/*.md` | source-markdown | in-source docs | KEEP | N | No long runtime documentation markdown found in `src/` |

## Final IA tree
```text
docs/
  00_START_HERE.md
  01_ARCHITECTURE.md
  02_DOMAIN_ENGINE.md
  03_DATA_SCHEMA.md
  04_API_CONTRACTS.md
  05_UI_FLOWS.md
  06_TESTING.md
  07_OPERATIONS.md
  DOCS_AUDIT_REPORT.md
  contracts/
    runtime-contracts.json
  archive/
    2026-02-20-legacy-core-docs.md
    2026-02-20-legacy-knowledgebase.md
    2026-02-20-legacy-workstreams.md
```

## Keep / Rewrite / Merge / Archive / Delete

### KEEP
- `trainer-app/docs/contracts/runtime-contracts.json` (as canonical contract file)

### REWRITE
- `trainer-app/README.md`
- `trainer-app/docs/contracts/runtime-contracts.json`

### MERGE
- `trainer-app/docs/index.md` -> `trainer-app/docs/00_START_HERE.md`
- `trainer-app/docs/architecture.md` -> `trainer-app/docs/01_ARCHITECTURE.md`, `trainer-app/docs/02_DOMAIN_ENGINE.md`
- `trainer-app/docs/data-model.md` -> `trainer-app/docs/03_DATA_SCHEMA.md`
- `trainer-app/docs/decisions.md` -> canonical runtime docs where still true

### ARCHIVE
- `trainer-app/docs/archive/2026-02-20-legacy-core-docs.md`
- `trainer-app/docs/archive/2026-02-20-legacy-workstreams.md`
- `trainer-app/docs/archive/2026-02-20-legacy-knowledgebase.md`

### DELETE
- `trainer-app/docs/analysis/*`: historical deep dives; non-canonical and drift-prone
- `trainer-app/docs/audits/*`: point-in-time diagnostics; not durable runtime docs
- `trainer-app/docs/debug/*`: temporary troubleshooting notes
- `trainer-app/docs/knowledgebase/*`: research references not required for runtime operation
- `trainer-app/docs/plans/*`: speculative/planning docs
- `trainer-app/docs/specs/*`: stale specs duplicated by code
- `trainer-app/docs/template/*`: duplicated feature behavior docs
- `trainer-app/docs/tests/*`: consolidated into one canonical testing doc
- `trainer-app/docs/archive/*` (legacy archive corpus): replaced by explicit tombstones
- `trainer-app/docs/archive/mobile-optimization-artifacts/**`: non-canonical artifact dump

## Remaining documentation risks
- API response payload examples are intentionally minimal to reduce duplication risk; route handlers remain source of truth.
- Large repository code churn can still outpace docs if `docs/00_START_HERE.md` checklist is skipped during feature work.
- Existing unrelated code changes in the working tree may continue to evolve contract behavior independently of this doc pass.

## Drift prevention process
1. Trigger review on any schema/API/engine/UI flow change (as defined in `docs/00_START_HERE.md`).
2. Update exactly one canonical doc per topic area.
3. Keep enum contracts in `docs/contracts/runtime-contracts.json` and run `npm run verify:contracts`.
4. Reference implementation paths directly and avoid duplicating long contracts.
5. Archive or delete stale docs immediately; do not keep TODO/speculative docs in canonical paths.
