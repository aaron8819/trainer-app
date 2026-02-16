# Engine Test Suite Documentation

Complete documentation for the Trainer App engine test suite. This directory documents all 54 test files covering 805+ tests that validate the workout generation engine.

---

## Quick Reference

| Metric | Value |
|--------|-------|
| **Test Files** | 54 |
| **Total Tests** | 805 passing, 1 skipped |
| **Coverage Areas** | Engine logic, API integration, UI components |
| **Test Runner** | Vitest |
| **Determinism** | Seeded PRNG for reproducibility |

---

## Documentation Structure

### Core Documentation

| Document | Purpose |
|----------|---------|
| [test-overview.md](test-overview.md) | High-level test organization and philosophy |
| [end-to-end-simulation.md](end-to-end-simulation.md) | Multi-week simulation tests (Phase 4.5+ readiness) |
| [unit-tests-by-module.md](unit-tests-by-module.md) | Comprehensive module-by-module test catalog |
| [testing-patterns.md](testing-patterns.md) | Conventions, fixtures, and best practices |
| [running-tests.md](running-tests.md) | Commands, debugging, and CI/CD integration |

---

## Test Categories

### 1. End-to-End Simulation Tests
**Location:** `src/lib/engine/__tests__/end-to-end-simulation.test.ts`

Multi-week workout simulations validating:
- Volume progression (MEV → MAV during accumulation)
- RIR ramping (4 → 1 across mesocycle)
- Block transitions (accumulation → intensification → deload)
- Exercise rotation (28-day novelty scoring)
- Autoregulation integration (fatigue triggers deload)
- Indirect volume accounting (bench → no OHP)

**Status:** 4 test scenarios, 3 passing + 1 skipped (rotation test requires optimization)

See [end-to-end-simulation.md](end-to-end-simulation.md) for complete documentation.

---

### 2. Periodization Tests
**Location:** `src/lib/engine/periodization/*.test.ts`

Tests the macro-cycle planning system:
- **generate-macro.test.ts** — Training block generation (accumulation/intensification/deload)
- **block-context.test.ts** — Block type derivation from date
- **prescribe-with-block.test.ts** — Volume/RIR/rest modifiers per block type

**Key Validations:**
- Beginner: 3w accumulation + 1w deload (4-week mesocycles)
- Intermediate: 2w accumulation + 2w intensification + 1w deload (5-week mesocycles)
- Advanced: 1w accumulation + 2w intensification + 1w deload (4-week mesocycles)
- Volume multipliers: 1.0 → 1.2 during accumulation, 0.8 during intensification, 0.5 during deload
- RIR adjustments: +2 during accumulation, -1 during intensification, +5 during deload

---

### 3. Exercise Selection (selection-v2) Tests
**Location:** `src/lib/engine/selection-v2/*.test.ts`

Tests the beam-search exercise selection algorithm:
- **optimizer.test.ts** — Beam search optimization logic
- **scoring.test.ts** — 7-factor scoring system (deficit fill, rotation novelty, SFR, lengthened, SRA, preference, movement diversity)
- **candidate.test.ts** — Candidate generation and volume contribution calculation
- **rationale.test.ts** — Selection explanation text generation
- **integration.test.ts** — End-to-end selection scenarios (indirect volume, rotation enforcement, constraint satisfaction)

**Key Features Tested:**
- Indirect volume accounting (bench → front delts at 30% efficiency)
- Exercise rotation (penalize exercises used within 28 days)
- Equipment constraints
- Time budget constraints
- User preferences (favorites/avoids)
- Movement pattern diversity

---

### 4. Prescription Tests
**Location:** `src/lib/engine/prescription.test.ts`

Tests sets/reps/RIR/rest prescription logic:
- Rep range selection by goal (strength: 3-6, hypertrophy: 6-12, fat loss: 12-20)
- Set count by training age (beginner: 3-4 sets, intermediate: 4-5, advanced: 5-6)
- RIR ramping across weeks
- Rest period calculation (rep-aware: higher reps = shorter rest)
- Exercise-specific rep range clamping (e.g., calf raises: 12-20 reps)

---

### 5. Volume Calculation Tests
**Location:** `src/lib/engine/volume.test.ts`

Tests MEV/MAV landmark calculations and volume progression:
- Training age modifiers (beginner: 0.75×, intermediate: 1.0×, advanced: 1.25×)
- Per-muscle volume targets (chest: 12-22 sets/week, quads: 12-20, etc.)
- Indirect volume calculation (secondary muscles at 30% efficiency)
- Weekly volume tracking and deficit calculation

---

### 6. Load Assignment Tests
**Location:** `src/lib/engine/apply-loads.test.ts`

Tests weight progression and load calculation:
- 1RM estimation from baseline history
- Relative intensity calculation (%1RM from RIR/reps)
- Warmup set generation
- Back-off set logic (reduce load 10-20% after top sets)
- Deload load adjustment (reduce 20% during deload weeks)

---

### 7. Autoregulation Tests
**Location:** `src/lib/engine/readiness/*.test.ts`

Tests fatigue-based workout modification:
- **compute-fatigue.test.ts** — Fatigue score calculation (subjective + performance metrics)
- **autoregulate.test.ts** — Workout modification based on fatigue (scale down volume/intensity)
- **stall-intervention.test.ts** — Intervention strategies when progress stalls

**Fatigue Score Components:**
- Subjective readiness (40% weight)
- Performance metrics (40% weight): RPE deviation, stalls, compliance
- Whoop/HRV data (20% weight, optional)

---

### 8. Explainability Tests
**Location:** `src/lib/engine/explainability/*.test.ts`

Tests coach messaging and rationale generation (Phase 4.3-4.5):
- **exercise-rationale.test.ts** — Per-exercise selection explanations with KB citations
- **prescription-rationale.test.ts** — Sets/reps/load/RIR/rest explanations
- **coach-messages.test.ts** — Natural language coaching tips
- **session-context.test.ts** — Session summary and context extraction
- **knowledge-base.test.ts** — Science citation lookup (Maeo, Pedrosa, Kassiano, etc.)

**Key Features:**
- Primary reasons extraction (top 2-3 selection factors)
- Science-backed citations for lengthened exercises
- Alternative exercise suggestions with similarity scoring
- Volume contribution summaries ("3 sets chest, 0.9 indirect front delts")

---

### 9. Template Mode Tests
**Location:** `src/lib/engine/template-session.test.ts`, `smart-build.test.ts`, `template-analysis.test.ts`

Tests fixed-template workout mode:
- **template-session.test.ts** — Template execution with substitutions
- **smart-build.test.ts** — Engine-assisted template creation with iterative improvement
- **template-analysis.test.ts** — Template quality scoring (6 dimensions: volume balance, SFR, lengthened bias, movement diversity, time efficiency, safety)

---

### 10. Utility Tests
**Location:** `src/lib/engine/utils.test.ts`, `rules.test.ts`, etc.

Tests shared utilities and rules:
- **utils.test.ts** — normalizeName, buildRecencyIndex, weightedPick, roundLoad
- **rules.test.ts** — Back-off multipliers, fatigue cost rules, contraindication checks
- **warmup-ramp.test.ts** — Warmup set generation (50%/70%/85% of working weight)
- **sra.test.ts** — Stimulus-Recovery-Adaptation tracking
- **split-queue.test.ts** — PPL rotation queue management

---

## Running Tests

### Basic Commands

```bash
cd trainer-app

# Run all tests (once)
npm test

# Run tests in watch mode
npm run test:watch

# Run a specific test file
npx vitest run src/lib/engine/prescription.test.ts

# Run tests matching a pattern
npx vitest run -t "should progress volume"

# Run with coverage
npm run test:coverage
```

See [running-tests.md](running-tests.md) for advanced usage.

---

## Test Architecture Principles

### 1. Determinism First
All engine tests use seeded PRNG (`random.ts`) for reproducibility:

```typescript
import { createRng } from "./random";

const rng = createRng(12345); // Deterministic seed
const value = rng(); // 0-1 float
```

**Never use `Math.random()` in engine code** — breaks test reproducibility.

---

### 2. Pure Engine, Side-Effect-Free Tests
Engine tests (`src/lib/engine/*.test.ts`) are **pure unit tests**:
- No database access
- No Prisma imports
- No I/O operations
- Deterministic inputs → deterministic outputs

**Exception:** End-to-end simulation tests use real database for integration testing.

---

### 3. Fixture Builders Over Hardcoded Data
Use shared fixture builders for consistency:

```typescript
import { exampleUser, exampleGoals, exampleConstraints } from "./sample-data";

const user = exampleUser({ trainingAge: "intermediate" });
const goals = exampleGoals({ primary: "strength" });
```

See [testing-patterns.md](testing-patterns.md) for complete fixture catalog.

---

### 4. Test Behavior, Not Implementation
Tests validate **outcomes**, not internal logic:

**Good:**
```typescript
it("should increase volume 20% during accumulation", () => {
  const result = prescribeWithBlock({ basePrescription, blockContext });
  expect(result.sets).toBeGreaterThan(basePrescription.sets);
});
```

**Bad:**
```typescript
it("should call getVolumeMultiplier with correct args", () => {
  // Don't test internal function calls
});
```

---

## Contributing Tests

When adding new engine features:

1. **Write tests first** (TDD approach preferred)
2. **Use seeded PRNG** for any randomness
3. **Co-locate tests** with source (`feature.ts` → `feature.test.ts`)
4. **Document test scenarios** with clear comments
5. **Run full suite** before committing: `npm test`

See [testing-patterns.md](testing-patterns.md) for detailed guidelines.

---

## Known Issues & Limitations

### Skipped Tests

1. **Exercise Rotation Test** (`end-to-end-simulation.test.ts`):
   - **Why skipped:** Requires persisting 18+ workouts to DB (90+ seconds)
   - **Fix needed:** Batch-insert optimization or mock ExerciseExposure table
   - **Core logic tested:** Unit tests validate novelty scoring

### Test Performance

- Full suite runs in ~10-15 seconds
- End-to-end simulation tests have 30s timeout (3 concurrent scenarios)
- Skipped rotation test would add 90s if enabled

---

## Additional Resources

- [Architecture Docs](../architecture.md) — Engine behavior specification
- [Data Model](../data-model.md) — Database schema
- [Decisions](../decisions.md) — ADRs explaining design choices
- [Project Overview](../project_overview.md) — High-level system design

---

**Last Updated:** 2026-02-16
**Test Suite Version:** Phase 4.5 (Explainability Complete)
**Total Test Count:** 805 tests across 54 files
