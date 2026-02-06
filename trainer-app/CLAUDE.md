# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Start Next.js dev server (http://localhost:3000)
npm run build            # Production build
npm run lint             # ESLint
npm test                 # Run all tests (Vitest, once)
npm run test:watch       # Run tests in watch mode
npx vitest run src/lib/engine/engine.test.ts              # Run a single test file
npx vitest run -t "test name substring"                   # Run tests matching a name
npm run prisma:generate  # Generate Prisma client (also runs on postinstall)
npm run prisma:studio    # Visual DB browser
npm run db:seed          # Seed exercises, equipment, muscles, aliases
```

## Architecture

**Trainer App** is a workout generation engine wrapped in a Next.js full-stack app. It generates PPL (push/pull/legs) workouts based on user profile, goals, constraints, injuries, and session readiness.

### Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict mode) · Prisma 7 + PostgreSQL (Supabase) · Zustand · Tailwind CSS 4 · Vitest · Zod 4

### Key Architectural Boundaries

**The engine is pure.** `src/lib/engine/` contains no database access and produces deterministic output given the same inputs + seed. Load assignment (`applyLoads`) lives in the API/context layer (`src/lib/api/`), not in the engine, to preserve testability.

**Split between layers:**

| Layer | Location | Responsibility |
|-------|----------|---------------|
| Engine | `src/lib/engine/` | Exercise selection, volume prescription, timeboxing, periodization. **No DB, no Prisma, no I/O.** |
| API/Context | `src/lib/api/` | DB queries, mapping DB models → engine types, load assignment (`applyLoads`), user resolution |
| Routes | `src/app/api/` | HTTP handlers, Zod validation via `safeParse`, user resolution dispatch |
| UI | `src/app/` + `src/components/` | Pages and interactive components |
| Validation | `src/lib/validation.ts` | Zod schemas shared across routes |
| DB | `src/lib/db/prisma.ts` | Singleton Prisma client with PrismaPg adapter |

**Engine modules** (`src/lib/engine/`):

| Module | Responsibility |
|--------|---------------|
| `engine.ts` | Orchestrator: `generateWorkout`, `buildWorkoutExercise` |
| `split-queue.ts` | Split patterns, day index, target pattern resolution |
| `filtering.ts` | Exercise filtering (equipment, pain, injury, stall), `selectExercises` |
| `main-lift-picker.ts` | PPL main lift pairing with recency weighting |
| `pick-accessories-by-slot.ts` | Slot-based accessory selection (PPL, upper_lower, full_body) |
| `prescription.ts` | Set/rep prescription, rest seconds |
| `volume.ts` | Volume context, caps enforcement, fatigue state derivation |
| `timeboxing.ts` | Time estimation, priority-based accessory trimming |
| `substitution.ts` | Exercise substitution suggestions |
| `progression.ts` | Load progression (`computeNextLoad`, `shouldDeload`) |
| `utils.ts` | Shared helpers (`normalizeName`, `weightedPick`, `buildRecencyIndex`, etc.) |
| `rules.ts` | Constants, rep ranges, periodization modifiers |
| `random.ts` | Seeded PRNG (`createRng`) |
| `types.ts` | All engine type definitions |

**When to use which layer:**
- `src/lib/api/` — Data loading, DB-to-engine mapping, anything that touches Prisma. This is where `applyLoads`, `resolveUser`, `loadWorkoutContext`, and all `map*` functions live.
- `src/app/api/` — Thin HTTP route handlers. Parse request with Zod, call into `src/lib/api/`, return `NextResponse.json()`. Keep route files short.
- `src/lib/engine/` — Pure computation only. If you need data from the database, accept it as a parameter.

### Workout Generation Flow

```
POST /api/workouts/generate
  → resolveUser() → loadWorkoutContext() (parallel DB loads)
  → map DB models to engine types
  → generateWorkout() (pure engine: split selection → main lifts → accessories → timeboxing → volume caps)
  → applyLoads() (hybrid estimation: history → baseline → body-weight formula; periodization modifiers)
  → return WorkoutPlan JSON
```

### Engine Invariants

These are hard constraints the engine enforces — do not weaken them:

- **Strict split purity**: PPL filtered by `Exercise.splitTags`. Push day only gets PUSH exercises, etc.
- **Template-only special blocks**: CORE/MOBILITY/PREHAB/CONDITIONING only in explicit warmup/finisher blocks, never as general accessories.
- **Main lift pairing**: Push = 1 horizontal + 1 vertical press. Pull = 1 vertical pull + 1 horizontal row. Legs = 1 squat + 1 hinge.
- **Perpetual split queue**: PPL index advances on completed workouts with `advancesSplit=true`, not on weekly reset.
- **Top-set/back-off by setIndex**: No explicit `setType` field — inferred from position.
- **Timeboxing**: Accessories trimmed first to fit `sessionMinutes`.
- **Volume spike caps**: Rolling 7-day window, 20% spike cap per muscle group.
- **Load progression cap**: Max 7% step increase.
- **Deterministic randomization**: Seeded PRNG for reproducible test fixtures.

### Anti-Patterns (Don't Do These)

- **Don't add DB/Prisma imports to `src/lib/engine/`**. The engine must stay pure. Pass data in as parameters.
- **Don't add a `setType` field** to distinguish top sets from back-off sets. This is inferred from `setIndex`.
- **Don't reset the split queue weekly**. The PPL rotation is perpetual across weeks.
- **Don't use `Math.random()` in engine code**. Use the seeded PRNG (`random.ts`) so tests are deterministic.
- **Don't bypass Zod validation in route handlers**. Always use `schema.safeParse(body)` and return 400 on failure.
- **Don't put business logic in route files** (`src/app/api/`). Route files should be thin — delegate to `src/lib/api/` or `src/lib/engine/`.
- **Don't weaken volume spike caps or load progression guardrails** without explicit instruction.
- **Don't select CORE/MOBILITY/PREHAB/CONDITIONING as general accessories**. They only appear in explicit warmup/finisher blocks.

### Periodization (4-week cycle)

| Week | Phase | RPE Adj | Sets Mult | Back-off |
|------|-------|---------|-----------|----------|
| 0 | Introduction | -1 | 1.0× | 0.85× |
| 1 | Accumulation | +0 | 1.0× | 0.85× |
| 2 | Intensification | +0.5 | 0.85× | 0.85× |
| 3 | Deload | +0 | 0.6× | 0.75× |

Fallback uses calendar-based weeks when no program block exists.

## Conventions

### TypeScript

- **Strict mode is on** (`"strict": true` in tsconfig). Do not weaken it.
- Engine types use `type` aliases (not `interface`) — see `src/lib/engine/types.ts`. Follow this pattern.
- Engine types use lowercase string unions (`"push" | "pull" | "legs"`); Prisma enums use UPPER_CASE (`PUSH`, `PULL`, `LEGS`). The `map*` functions in `src/lib/api/workout-context.ts` bridge between them.
- Use `@/*` path alias for imports (maps to `./src/*`).

### Validation

- All API input validation uses Zod schemas in `src/lib/validation.ts`.
- Use `schema.safeParse(body)` in route handlers — never trust raw input.
- When adding a new API endpoint, add its Zod schema to `validation.ts`.

### Error Handling

- Route handlers catch `request.json()` failures: `await request.json().catch(() => ({}))`.
- Validation failures return `{ error: string }` with status 400.
- Missing entities return status 404.
- DB writes that span multiple tables use `prisma.$transaction()` (see `save/route.ts`).
- The engine does not throw — it degrades gracefully (e.g., returns fewer accessories if pool is limited).

## Testing

Tests live alongside source in `src/lib/engine/*.test.ts` and `src/lib/api/*.test.ts`. Engine tests use deterministic seeded PRNG for reproducibility.

**When to write tests:**
- Any change to `src/lib/engine/` must have test coverage. The engine is pure, so tests are straightforward.
- Use the existing fixture builders (`exampleUser`, `exampleGoals`, `exampleConstraints`, `exampleExerciseLibrary` from `sample-data.ts`) and `buildHistory()` helpers.
- For end-to-end engine behavior, see `engine.integration.test.ts` for patterns covering `generateWorkout` + `applyLoads`.
- API route handlers are not currently unit-tested — the engine tests provide coverage for the logic.

## Key Documentation

- `docs/engine_refactor_2.5.md` — Consolidated engine behavior, schema, and implementation status (source of truth)
- `docs/data-model.md` — Complete DB schema reference
- `docs/seeded_data.md` — Baseline exercise catalog
- `prisma/schema.prisma` — Database schema

## Database

Prisma with PostgreSQL via Supabase. Env vars in `.env` (see `.env.example`). Path alias: `@/*` maps to `./src/*`.

Profile stores height in inches (`heightIn`) and weight in pounds (`weightLb`). The engine receives these converted to metric (`heightCm`, `weightKg`) via `mapProfile()`.

To apply migrations manually:
```bash
npx prisma db execute --file prisma/migrations/<migration_dir>/migration.sql
npx prisma migrate resolve --applied <migration_dir>
```
