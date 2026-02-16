# Test Suite Overview

High-level organization, philosophy, and architecture of the Trainer App test suite.

---

## Testing Philosophy

The Trainer App test suite follows these core principles:

### 1. **Determinism First**
All engine tests produce **identical results** given identical inputs:
- Seeded PRNG (`random.ts`) replaces `Math.random()`
- No real-time clock dependencies (dates passed as parameters)
- No external API calls or I/O in unit tests

**Why:** Flaky tests erode confidence. Deterministic tests catch regressions reliably.

---

### 2. **Pure Engine = Pure Tests**
The engine (`src/lib/engine/`) is a **pure computation layer**:
- No database access
- No Prisma imports
- No side effects

Engine tests mirror this purity:
- Fast execution (full suite in ~10-15 seconds)
- No test database required (except E2E simulation tests)
- Parallelizable across CPU cores

**Why:** Pure functions are easy to test. Tests run in milliseconds, not seconds.

---

### 3. **Layered Testing Strategy**

```
┌─────────────────────────────────────────────────────┐
│  End-to-End Simulation Tests (4 scenarios)         │  ← Multi-week integration
│  - 12-week PPL simulation                          │
│  - Autoregulation integration                      │
│  - Block transitions                               │
└─────────────────────────────────────────────────────┘
                        ▲
┌─────────────────────────────────────────────────────┐
│  Integration Tests (selection, periodization)      │  ← Cross-module workflows
│  - Exercise selection pipeline                     │
│  - Periodization + prescription                    │
└─────────────────────────────────────────────────────┘
                        ▲
┌─────────────────────────────────────────────────────┐
│  Unit Tests (50+ files)                            │  ← Module-level logic
│  - prescription.test.ts                            │
│  - volume.test.ts                                  │
│  - apply-loads.test.ts                             │
│  - scoring.test.ts                                 │
│  - etc.                                            │
└─────────────────────────────────────────────────────┘
```

**Unit Tests** validate individual modules in isolation.

**Integration Tests** validate multi-module workflows (e.g., selection + prescription + timeboxing).

**End-to-End Tests** validate full system behavior over time (multi-week training cycles).

---

### 4. **Test Behavior, Not Implementation**
Tests verify **outcomes**, not internal function calls:

✅ **Good:**
```typescript
it("should progress volume 20% during accumulation", () => {
  const result = prescribeWithBlock({ basePrescription, blockContext });
  expect(result.sets).toBe(5); // 4 * 1.2 = 4.8 → 5
});
```

❌ **Bad:**
```typescript
it("should call getVolumeMultiplier", () => {
  const spy = vi.spyOn(module, "getVolumeMultiplier");
  prescribeWithBlock(...);
  expect(spy).toHaveBeenCalled(); // Testing implementation detail
});
```

**Why:** Tests should survive refactoring. Implementation details change; behavior should not.

---

## Test Organization

### Directory Structure

```
src/lib/engine/
├── __tests__/
│   ├── end-to-end-simulation.test.ts    # Multi-week simulation
│   └── simulation-utils.ts              # Simulation helpers
├── periodization/
│   ├── generate-macro.test.ts
│   ├── block-context.test.ts
│   └── prescribe-with-block.test.ts
├── selection-v2/
│   ├── optimizer.test.ts
│   ├── scoring.test.ts
│   ├── candidate.test.ts
│   ├── rationale.test.ts
│   ├── beam-search.test.ts
│   └── integration.test.ts
├── readiness/
│   ├── compute-fatigue.test.ts
│   ├── autoregulate.test.ts
│   └── stall-intervention.test.ts
├── explainability/
│   ├── __tests__/
│   │   └── exercise-rationale.test.ts
│   ├── prescription-rationale.test.ts
│   ├── coach-messages.test.ts
│   ├── session-context.test.ts
│   ├── knowledge-base.test.ts
│   └── utils.test.ts
├── prescription.test.ts
├── volume.test.ts
├── apply-loads.test.ts
├── rules.test.ts
├── utils.test.ts
├── warmup-ramp.test.ts
├── sra.test.ts
├── split-queue.test.ts
├── template-session.test.ts
├── smart-build.test.ts
├── template-analysis.test.ts
├── timeboxing.test.ts
└── (etc.)
```

**Convention:** Co-locate test files with source code (`feature.ts` → `feature.test.ts`).

**Exception:** End-to-end tests live in `__tests__/` to indicate cross-module scope.

---

## Test Categories

### 1. Core Engine Logic (20+ test files)
**Validates:** Pure computation (no DB, no I/O)

| Module | Test File | Coverage |
|--------|-----------|----------|
| Prescription | `prescription.test.ts` | Sets/reps/RIR/rest calculation |
| Volume | `volume.test.ts` | MEV/MAV landmarks, weekly targets |
| Load Assignment | `apply-loads.test.ts` | 1RM estimation, %1RM, warmups |
| Periodization | `periodization/*.test.ts` | Macro cycles, block transitions |
| Rules | `rules.test.ts` | Back-off multipliers, contraindications |
| Utils | `utils.test.ts` | normalizeName, weightedPick, roundLoad |

**Run with:** `npx vitest run src/lib/engine/prescription.test.ts`

---

### 2. Exercise Selection (7 test files)
**Validates:** Beam-search optimization algorithm

| Test File | Coverage |
|-----------|----------|
| `optimizer.test.ts` | Beam search, pruning, constraint enforcement |
| `scoring.test.ts` | 7-factor scoring (deficit fill, rotation, SFR, lengthened, SRA, preference, movement diversity) |
| `candidate.test.ts` | Candidate generation, volume contribution |
| `rationale.test.ts` | Selection explanation text |
| `beam-search.test.ts` | Beam width, depth control, convergence |
| `integration.test.ts` | End-to-end selection scenarios |

**Key Scenario:** Indirect volume prevents redundant selection (bench → no OHP).

---

### 3. Autoregulation (3 test files)
**Validates:** Fatigue-based workout modification

| Test File | Coverage |
|-----------|----------|
| `compute-fatigue.test.ts` | Fatigue score calculation (subjective + performance) |
| `autoregulate.test.ts` | Workout modification logic (scale down, deload) |
| `stall-intervention.test.ts` | Progress stall detection and intervention |

**Key Scenario:** Fatigue < 0.3 triggers automatic deload.

---

### 4. Explainability (6 test files)
**Validates:** Coach messaging and rationale generation (Phase 4.3-4.5)

| Test File | Coverage |
|-----------|----------|
| `exercise-rationale.test.ts` | Per-exercise selection explanations with KB citations |
| `prescription-rationale.test.ts` | Sets/reps/load/RIR/rest explanations |
| `coach-messages.test.ts` | Natural language coaching tips |
| `session-context.test.ts` | Session summary extraction |
| `knowledge-base.test.ts` | Science citation lookup (Maeo, Pedrosa, Kassiano) |
| `utils.test.ts` | Text formatting utilities |

**Key Feature:** Lengthened exercises cite research (e.g., "Overhead extensions: Maeo 2023 found 3.2× hypertrophy vs short position").

---

### 5. Template Mode (3 test files)
**Validates:** Fixed-template workout mode

| Test File | Coverage |
|-----------|----------|
| `template-session.test.ts` | Template execution with substitutions |
| `smart-build.test.ts` | Engine-assisted template creation |
| `template-analysis.test.ts` | Template quality scoring (6 dimensions) |

**Key Feature:** Smart Build iteratively improves templates using selection engine.

---

### 6. End-to-End Simulation (1 test file, 4 scenarios)
**Validates:** Multi-week training cycles

| Scenario | Coverage |
|----------|----------|
| Beginner 12-week PPL | Volume progression, RIR ramping, deload behavior |
| Exercise Rotation | 28-day novelty scoring (SKIPPED: needs optimization) |
| Autoregulation | Fatigue triggers deload |
| Indirect Volume | Bench press prevents OHP selection |
| Block Transitions | Intermediate mesocycles (acc → int → deload) |

**Status:** 3 passing, 1 skipped (rotation test requires DB optimization).

See [end-to-end-simulation.md](end-to-end-simulation.md) for full documentation.

---

## Test Execution Speed

| Test Category | File Count | Test Count | Execution Time |
|---------------|------------|------------|----------------|
| Unit Tests | 50+ | ~750 | ~8-10 seconds |
| Integration Tests | 3 | ~30 | ~2-3 seconds |
| End-to-End Simulation | 1 | 4 (3 run) | ~5-8 seconds |
| **Total** | **54** | **805** | **~10-15 seconds** |

**Skipped Tests:** 1 (exercise rotation, needs DB optimization)

**Parallel Execution:** Vitest runs tests across all CPU cores by default.

---

## Coverage Gaps

### Areas with Full Coverage ✅
- Prescription logic (sets/reps/RIR/rest)
- Volume calculation (MEV/MAV, indirect volume)
- Load assignment (1RM, %1RM, warmups)
- Exercise selection (beam search, scoring, constraints)
- Periodization (macro cycles, block transitions)
- Explainability (rationale generation, KB citations)

### Areas with Partial Coverage ⚠️
- Template mode (basic scenarios covered, edge cases need work)
- Autoregulation (fatigue computation covered, intervention logic partially tested)

### Areas Needing More Tests 🔴
- UI components (React components not systematically tested)
- API routes (route handlers have no direct tests; engine tests provide indirect coverage)
- Error handling (happy path covered, error cases need explicit tests)

**Next Steps:** Add Playwright E2E tests for critical UI flows (workout generation → completion).

---

## Key Testing Utilities

### 1. Seeded PRNG (`random.ts`)
```typescript
import { createRng } from "./random";

const rng = createRng(12345); // Deterministic
const value = rng(); // 0-1 float
```

**Never use `Math.random()` in engine code.**

---

### 2. Fixture Builders (`sample-data.ts`)
```typescript
import { exampleUser, exampleGoals, exampleConstraints } from "./sample-data";

const user = exampleUser({ trainingAge: "intermediate" });
const goals = exampleGoals({ primary: "strength" });
const constraints = exampleConstraints({ sessionMinutes: 60 });
```

See [testing-patterns.md](testing-patterns.md) for complete fixture catalog.

---

### 3. Simulation Utilities (`simulation-utils.ts`)
```typescript
import {
  simulateWorkoutCompletion,
  simulateFatigueCheckIn,
  assertVolumeProgression,
  assertRIRProgression
} from "./__tests__/simulation-utils";

const completed = simulateWorkoutCompletion(workout, {
  successRate: 0.95,
  date: new Date("2026-03-01"),
  randomSeed: 12345,
});
```

Used exclusively by end-to-end simulation tests.

---

## Contributing Guidelines

### Adding New Tests

1. **Co-locate with source:** `feature.ts` → `feature.test.ts`
2. **Use descriptive test names:**
   ```typescript
   it("should increase volume 20% during accumulation block", () => {
     // ...
   });
   ```
3. **Use seeded PRNG** for any randomness
4. **Document test scenarios** with comments explaining "why" not just "what"
5. **Run full suite** before committing: `npm test`

---

### Test Structure Pattern

```typescript
import { describe, it, expect } from "vitest";
import { functionUnderTest } from "./feature";

describe("Feature Name", () => {
  describe("Scenario 1: Happy path", () => {
    it("should do X when Y", () => {
      // Arrange
      const input = createInput();

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe(expectedValue);
    });
  });

  describe("Scenario 2: Edge case", () => {
    it("should handle Z gracefully", () => {
      // ...
    });
  });
});
```

**Use nested `describe` blocks** to group related tests logically.

---

## Known Issues & Limitations

### 1. Skipped Exercise Rotation Test
**File:** `end-to-end-simulation.test.ts`

**Issue:** Requires persisting 18+ workouts to DB (90+ seconds)

**Fix:** Batch-insert optimization or mock ExerciseExposure table

**Impact:** Core novelty scoring is tested in unit tests; only integration is skipped.

---

### 2. Template Mode Edge Cases
**Issue:** Smart Build edge cases (empty library, impossible constraints) not exhaustively tested

**Fix:** Add explicit error-case tests

**Impact:** Low (engine degrades gracefully)

---

### 3. No UI Component Tests
**Issue:** React components not systematically tested

**Fix:** Add Playwright E2E tests for critical flows

**Impact:** Medium (manual testing catches most issues)

---

## Additional Resources

- [end-to-end-simulation.md](end-to-end-simulation.md) — Multi-week simulation test documentation
- [unit-tests-by-module.md](unit-tests-by-module.md) — Complete test file catalog
- [testing-patterns.md](testing-patterns.md) — Conventions and best practices
- [running-tests.md](running-tests.md) — Commands and debugging

---

**Last Updated:** 2026-02-16
**Total Tests:** 805 tests across 54 files
