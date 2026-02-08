# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Layout

The app lives in the `trainer-app/` subdirectory. **All commands below must be run from `trainer-app/`.**

```bash
cd trainer-app
```

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
npm run export:ppl-options  # Export PPL options from DB
```

## Architecture

**Trainer App** is a workout generation engine wrapped in a Next.js full-stack app. It generates PPL (push/pull/legs) workouts based on user profile, goals, constraints, injuries, and session readiness.

### Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict mode) · Prisma 7 + PostgreSQL (Supabase) · Zustand · Tailwind CSS 4 · Vitest · Zod 4

### Key Architectural Boundaries

**The engine is pure.** `src/lib/engine/` contains no database access and produces deterministic output given the same inputs + seed. See [docs/architecture.md](trainer-app/docs/architecture.md) for the full engine behavior spec, module map, and generation flow.

| Layer | Location | Responsibility |
|-------|----------|---------------|
| Engine | `src/lib/engine/` | Exercise selection, volume prescription, load assignment, timeboxing, periodization. **No DB, no Prisma, no I/O.** |
| API/Context | `src/lib/api/` | DB queries, mapping DB models -> engine types, orchestrating load assignment with DB history |
| Routes | `src/app/api/` | Thin HTTP handlers, Zod validation via `safeParse` |
| UI | `src/app/` + `src/components/` | Pages and interactive components |
| Validation | `src/lib/validation.ts` | Zod schemas shared across routes |
| DB | `src/lib/db/prisma.ts` | Singleton Prisma client with PrismaPg adapter |

**When to use which layer:**
- `src/lib/engine/` — Pure computation only. If you need data from the database, accept it as a parameter.
- `src/lib/api/` — Data loading, DB-to-engine mapping, anything that touches Prisma.
- `src/app/api/` — Thin HTTP route handlers. Parse request with Zod, call into `src/lib/api/`, return `NextResponse.json()`.

### Anti-Patterns (Don't Do These)

- **Don't add DB/Prisma imports to `src/lib/engine/`**. The engine must stay pure. Pass data in as parameters.
- **Don't add a `setType` field** to distinguish top sets from back-off sets. This is inferred from `setIndex`.
- **Don't reset the split queue weekly**. The PPL rotation is perpetual across weeks.
- **Don't use `Math.random()` in engine code**. Use the seeded PRNG (`random.ts`) so tests are deterministic.
- **Don't bypass Zod validation in route handlers**. Always use `schema.safeParse(body)` and return 400 on failure.
- **Don't put business logic in route files** (`src/app/api/`). Route files should be thin — delegate to `src/lib/api/` or `src/lib/engine/`.
- **Don't weaken volume spike caps or load progression guardrails** without explicit instruction.
- **Don't select CORE/MOBILITY/PREHAB/CONDITIONING as general accessories**. They only appear in explicit warmup/finisher blocks.

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

See [docs/index.md](trainer-app/docs/index.md) for the full documentation map.

- `docs/architecture.md` — Engine behavior, guarantees, generation flow, module map (source of truth)
- `docs/decisions.md` — Architectural Decision Records
- `docs/data-model.md` — Complete DB schema reference
- `docs/seeded-data.md` — Baseline exercise catalog
- `prisma/schema.prisma` — Database schema

**When to read docs** (before starting work):
- Changing engine behavior or adding engine modules → read `docs/architecture.md`
- Changing DB schema or adding models → read `docs/data-model.md`
- Adding or modifying exercises in seed data → read `docs/seeded-data.md`
- Making an architectural decision (new pattern, new module, changing a constraint) → read `docs/decisions.md`

**When to update docs** (after completing work):
- Changed engine behavior, added/removed modules, or modified guarantees → update `docs/architecture.md`
- Changed DB schema → update `docs/data-model.md`
- Changed seed data → update `docs/seeded-data.md`
- Made an architectural decision worth recording → append to `docs/decisions.md`

## Database

Prisma with PostgreSQL via Supabase. Env vars in `.env` (see `.env.example`). Path alias: `@/*` maps to `./src/*`.

Profile stores height in inches (`heightIn`) and weight in pounds (`weightLb`). The engine receives these converted to metric (`heightCm`, `weightKg`) via `mapProfile()`.

### Migration Rules

**CRITICAL: Migrations must be applied before running the app.** A stale database causes cryptic runtime errors like "The column `(not available)` does not exist in the current database."

**When to check for pending migrations:**
- After pulling new code or switching branches
- After any schema change (`schema.prisma` modified)
- When you see Prisma runtime errors about missing columns/tables
- Before running `npm run dev` or `npm run build` after schema work

**Standard workflow when schema changes:**
```bash
# 1. Update schema.prisma
# 2. Create migration (dev only — generates SQL + applies it)
npx prisma migrate dev --name descriptive_name
# 3. Regenerate client
npm run prisma:generate
# 4. Commit both schema and migration files
```

**Apply existing migrations (after pulling code with new migrations):**
```bash
# Preferred — applies all pending migrations:
npx prisma migrate deploy

# Check status first if unsure:
npx prisma migrate status
```

**Manual apply (if `migrate deploy` fails):**
```bash
npx prisma db execute --file prisma/migrations/<migration_dir>/migration.sql
npx prisma migrate resolve --applied <migration_dir>
```

**After applying any migration, always regenerate the client:**
```bash
npm run prisma:generate
```
