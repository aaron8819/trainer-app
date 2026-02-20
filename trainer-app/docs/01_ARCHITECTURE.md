# 01 Architecture

Owner: Aaron  
Last reviewed: 2026-02-20  
Purpose: Defines the current runtime architecture for the single-user local-first Trainer app and the boundaries between UI, API routes, orchestration, engine, and persistence.

This doc covers:
- App Router UI and API boundaries
- Orchestration and engine boundaries
- Persistence and runtime identity model

Invariants:
- Runtime identity is owner-scoped via `resolveOwner()`.
- App routes and API routes are the only external app surface.
- Engine logic is pure/domain-focused under `src/lib/engine`; DB access lives in API/orchestration.

Sources of truth:
- `trainer-app/src/lib/api/workout-context.ts`
- `trainer-app/src/lib/db/prisma.ts`
- `trainer-app/src/app`
- `trainer-app/src/app/api`
- `trainer-app/src/lib/api`
- `trainer-app/src/lib/engine`

## Runtime layers
1. UI layer: App Router pages and client components under `src/app` and `src/components`.
2. API layer: route handlers under `src/app/api/**/route.ts`.
3. Orchestration layer: runtime composition under `src/lib/api`.
4. Engine layer: selection/progression/periodization/readiness/explainability logic under `src/lib/engine`.
5. Data layer: Prisma models and migrations under `prisma/` and client setup in `src/lib/db/prisma.ts`.

## Single-user local-first behavior
- `resolveOwner()` upserts a deterministic owner user, using `OWNER_EMAIL` or fallback `owner@local`.
- `RUNTIME_MODE` defaults to `single_user_local`; current behavior is owner-scoped upsert for runtime data access.
- All major pages and API flows resolve the owner before loading/writing data.

## App surface
- UI pages are defined in `src/app/**/page.tsx` (dashboard, onboarding, workout/log detail, analytics, templates, library, settings, program).
- API routes are defined in `src/app/api/**/route.ts` and validated through `src/lib/validation.ts` where applicable.

## Data and control flow (high level)
1. UI calls API routes.
2. API routes validate input, resolve owner, and call orchestration helpers in `src/lib/api`.
3. Orchestration loads context from Prisma and invokes engine functions.
4. Engine returns deterministic plan/rationale outputs.
5. API persists workout/log changes and returns response payloads.
