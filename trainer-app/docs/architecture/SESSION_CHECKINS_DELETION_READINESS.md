# Session Check-ins Deletion Readiness

Date: 2026-04-28

## Scope

Audit whether deprecated `POST /api/session-checkins` could be deleted and record the endpoint cleanup result.

Inspected:
- `src/app/api/session-checkins/route.ts`
- Tests matching `session-checkins`, `SessionCheckIn`, and `sessionCheckIn`
- Docs matching `session-checkins`, `SessionCheckIn`, and `sessionCheckIn`
- Prisma schema and migration references for `SessionCheckIn`
- Full repo search: `rg "session-checkins|SessionCheckIn|sessionCheckIn"`

## Deleted route behavior

`src/app/api/session-checkins/route.ts` was a deprecated compatibility writer. It has been deleted as endpoint cleanup.

It used to:
- resolves the owner through `resolveOwner()`
- validates a simple `readiness` score
- writes a legacy `SessionCheckIn` row through `prisma.sessionCheckIn.create()`
- mirrors the same submission into canonical `ReadinessSignal`
- returns `deprecated: true` and points clients to `/api/readiness/submit`

The current canonical write route is `POST /api/readiness/submit`.

## Findings

### 1. Are there any remaining production callers?

No production caller of `/api/session-checkins` remains.

Evidence:
- `src/components/GenerateFromTemplateCard.tsx` submits pre-generation readiness to `/api/readiness/submit`.
- `src/components/GenerateFromTemplateCard.test.tsx` asserts the first call goes to `/api/readiness/submit`.
- `rg "session-checkins" trainer-app/src` no longer finds source references after route deletion.

There are still production symbols named `SessionCheckIn`, but these are not route callers:
- `src/components/SessionCheckInForm.tsx` is a UI form name.
- `src/components/GenerateFromTemplateCard.tsx` uses a `SessionCheckInPayload` type and translates it to the canonical readiness submit payload.
- `src/lib/engine/types.ts`, `src/lib/engine/template-session.ts`, and `src/lib/engine/volume.ts` use an in-memory `SessionCheckIn` shape for fatigue/readiness inputs.
- `src/lib/api/checkin-staleness.ts` maps current readiness-shaped rows into that engine shape.

### 2. Are remaining refs only tests/docs/deprecated route?

For the literal route string `session-checkins`, remaining references are historical/deletion notes.

For the broader symbol search `SessionCheckIn|sessionCheckIn`, no. Production code still uses the name for UI/domain shapes, and Prisma still defines the historical model.

Remaining non-route production refs are naming/model compatibility, not active calls to the deprecated endpoint.

### 3. Does any code read `SessionCheckIn` for current behavior?

No current behavior reads the Prisma `SessionCheckIn` table.

Evidence:
- `src/lib/api/workout-context.ts` loads latest readiness from `prisma.readinessSignal.findMany(...)`, not `prisma.sessionCheckIn`.
- It maps that `ReadinessSignal` data into a `CheckInRow[]` compatibility shape before calling `mapLatestCheckIn()`.
- `src/lib/api/readiness.ts` reads and writes `ReadinessSignal`.
- Repo search finds no production `prisma.sessionCheckIn.find*` usage.

The only remaining production Prisma usage of `sessionCheckIn` is seed cleanup deletion in `prisma/cleanup-seed-user.ts`.

### 4. Is historical `SessionCheckIn` data displayed anywhere?

No.

Search found no UI, API read model, analytics route, history route, review page, or dashboard surface reading or rendering historical `SessionCheckIn` rows. Historical readiness behavior now flows through `ReadinessSignal` and performed workout history.

### 5. Can route deletion happen without schema/table deletion?

Yes.

Deleting `src/app/api/session-checkins/route.ts` only removed the deprecated writer. The Prisma `SessionCheckIn` model/table remains as historical data until a separate schema/data migration decides whether to archive, backfill, or drop it.

This is the safer split:
- Route deletion: ready now.
- Prisma model/table deletion: separate migration/data-retention task.

Keeping the table temporarily avoids coupling endpoint cleanup to historical data migration risk.

### 6. What tests/docs need update if route is deleted?

Tests:
- `src/components/GenerateFromTemplateCard.test.tsx`
  - Keep or update the guard that pre-generation readiness submits to `/api/readiness/submit`.
  - The route-specific negative assertion was removed after endpoint deletion; the test still asserts the canonical readiness route.
- `src/lib/api/checkin-staleness.test.ts`
  - Header comment updated so the helper is described as a `ReadinessSignal`-to-engine-shape compatibility mapper.
- `src/lib/api/readiness.test.ts`
  - Update the header comment for the same reason.

Docs:
- `docs/04_API_CONTRACTS.md`
  - Remove `src/app/api/session-checkins/route.ts` from current profile/session support.
  - Keep `/api/readiness/submit` as the canonical readiness write contract.
- `docs/03_DATA_SCHEMA.md`
  - If the table remains, mark `SessionCheckIn` as historical/compatibility persistence, not a current runtime source.
- `docs/architecture/CODEBASE_CLEANUP_OPPORTUNITY_MAP.md`
  - Replace stale claims that `GenerateFromTemplateCard.tsx` still calls `/api/session-checkins`.
- `docs/architecture/LEGACY_FALLBACK_DATA_INVENTORY.md`
  - Update stale blockers that say route deletion is blocked by a live production caller.
  - Keep any data-retention note for existing `SessionCheckIn` rows as a schema/table migration concern.

No active migration file should be edited for route deletion. Baseline migration references are historical schema history and should remain unchanged.

## Recommendation

Delete route now.

Rationale:
- The canonical production caller has already moved to `/api/readiness/submit`.
- Current behavior reads `ReadinessSignal`, not `SessionCheckIn`.
- Historical `SessionCheckIn` rows are not displayed anywhere.
- Route deletion does not require dropping the Prisma model/table.

Do not delete the Prisma `SessionCheckIn` model/table in the same change unless a separate migration/data-retention plan explicitly handles historical rows and relation cleanup.

## Suggested deletion change set

Required:
- Deleted `src/app/api/session-checkins/route.ts`.
- Updated the three test comments/assertions listed above as needed.
- Updated `docs/04_API_CONTRACTS.md`.
- Updated stale architecture cleanup docs.

Optional follow-up:
- Rename UI/domain `SessionCheckIn*` symbols to `ReadinessCheckIn*` for clarity.
- Inventory historical `SessionCheckIn` rows and decide whether to migrate, archive, or drop the table.
- If dropping the table later, update `prisma/schema.prisma`, create a migration, update `docs/03_DATA_SCHEMA.md`, and remove `prisma/cleanup-seed-user.ts` cleanup for `sessionCheckIn`.
