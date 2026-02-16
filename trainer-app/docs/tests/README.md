# Test Suite Documentation

Complete documentation for the Trainer App engine test suite covering 805+ tests across 54 files.

---

## Documentation Files

| Document | Purpose |
|----------|---------|
| [index.md](index.md) | **Start here:** Test suite overview, quick reference, test categories |
| [test-overview.md](test-overview.md) | Testing philosophy, principles, and organization |
| [end-to-end-simulation.md](end-to-end-simulation.md) | Multi-week simulation tests (12-week PPL, autoregulation, block transitions) |
| [unit-tests-by-module.md](unit-tests-by-module.md) | Complete catalog of all 54 test files organized by functional area |
| [testing-patterns.md](testing-patterns.md) | Fixtures, conventions, best practices, and common patterns |
| [running-tests.md](running-tests.md) | Commands, debugging, troubleshooting, and CI/CD integration |

---

## Quick Start

### Run All Tests
```bash
cd trainer-app
npm test
```

### Run Specific Module
```bash
npx vitest run src/lib/engine/prescription.test.ts
npx vitest run src/lib/engine/periodization/*.test.ts
npx vitest run src/lib/engine/selection-v2/*.test.ts
```

### Watch Mode (re-runs on changes)
```bash
npm run test:watch
```

---

## Test Statistics

| Metric | Value |
|--------|-------|
| **Total Test Files** | 54 |
| **Total Tests** | 805 passing, 1 skipped |
| **Execution Time** | ~10-15 seconds |
| **Coverage** | Core engine: 82%+ |

**Test Categories:**
- Core Engine Logic: 15 files, ~242 tests
- Periodization: 3 files, ~50 tests
- Exercise Selection (v2): 6 files, ~200 tests
- Autoregulation: 3 files, ~60 tests
- Explainability: 6 files, ~135 tests
- Template Mode: 3 files, ~63 tests
- End-to-End Simulation: 1 file, 4 scenarios

---

## Key Features Tested

### ✅ Core Engine
- Sets/reps/RIR/rest prescription
- Volume calculation (MEV/MAV)
- Load assignment (1RM, warmups)
- Progressive overload
- Periodization (accumulation/intensification/deload)

### ✅ Exercise Selection
- Beam search optimization
- 7-factor scoring system
- Indirect volume accounting (bench → no OHP)
- Exercise rotation (28-day novelty)
- Equipment constraints
- User preferences

### ✅ Autoregulation
- Fatigue score calculation
- Workout modification (scale down, deload)
- Per-muscle soreness penalty
- Stall detection and intervention

### ✅ Explainability (Phase 4)
- Exercise selection rationale with KB citations
- Prescription rationale (sets/reps/load/RIR/rest)
- Coach messages
- Alternative exercise suggestions

### ✅ End-to-End Simulation
- 12-week PPL simulation
- Block transitions
- Autoregulation integration
- Indirect volume validation

---

## Documentation Philosophy

**Determinism First:** All engine tests use seeded PRNG for reproducibility.

**Pure Engine = Pure Tests:** No database access in unit tests (except E2E simulation).

**Layered Testing:**
- Unit tests validate individual modules
- Integration tests validate cross-module workflows
- End-to-end tests validate multi-week training cycles

**Test Behavior, Not Implementation:** Tests verify outcomes, not internal function calls.

---

## Need Help?

- **Starting point:** [index.md](index.md)
- **Running tests:** [running-tests.md](running-tests.md)
- **Writing tests:** [testing-patterns.md](testing-patterns.md)
- **Test catalog:** [unit-tests-by-module.md](unit-tests-by-module.md)

---

**Last Updated:** 2026-02-16
**Test Suite Version:** Phase 4.5 (Explainability Complete)
