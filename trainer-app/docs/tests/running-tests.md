# Running and Debugging Tests

Complete guide to running, debugging, and troubleshooting Trainer App tests.

---

## Quick Start

```bash
cd trainer-app

# Run all tests (once)
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage
```

---

## Basic Commands

### Run All Tests
```bash
npm test
# Alias for: npx vitest run
```

**Output:**
```
✓ src/lib/engine/prescription.test.ts (30 tests) 124ms
✓ src/lib/engine/volume.test.ts (25 tests) 98ms
✓ src/lib/engine/selection-v2/optimizer.test.ts (40 tests) 342ms
...
Test Files  54 passed (54)
     Tests  805 passed | 1 skipped (806)
      Time  10.23s
```

---

### Run Specific Test File
```bash
npx vitest run src/lib/engine/prescription.test.ts
```

---

### Run Multiple Files by Pattern
```bash
# All periodization tests
npx vitest run src/lib/engine/periodization/*.test.ts

# All selection-v2 tests
npx vitest run src/lib/engine/selection-v2/*.test.ts

# All explainability tests
npx vitest run src/lib/engine/explainability/*.test.ts
```

---

### Run Tests Matching a Name
```bash
# Run all tests with "volume" in the name
npx vitest run -t "volume"

# Run all tests with "should progress volume" in the name
npx vitest run -t "should progress volume"

# Case-insensitive pattern matching
npx vitest run -t "accumulation"
```

---

## Watch Mode

### Basic Watch Mode
```bash
npm run test:watch
# Alias for: npx vitest watch
```

**Features:**
- Re-runs tests when files change
- Interactive menu for filtering tests
- Fast feedback loop during development

**Interactive Commands (in watch mode):**
- `a` — Run all tests
- `f` — Run only failed tests
- `p` — Filter by filename pattern
- `t` — Filter by test name pattern
- `q` — Quit watch mode

---

### Watch Specific File
```bash
npx vitest watch src/lib/engine/prescription.test.ts
```

---

## Debugging

### Run Tests with Verbose Output
```bash
npx vitest run --reporter=verbose
```

**Shows:**
- Individual test names
- Pass/fail status for each test
- Execution time per test

---

### Run Single Test with `.only`
```typescript
// In test file
it.only("should increase volume during accumulation", () => {
  // Only this test will run
  const result = prescribeWithBlock({ basePrescription, blockContext });
  expect(result.sets).toBe(5);
});
```

**Run:**
```bash
npx vitest run src/lib/engine/periodization/prescribe-with-block.test.ts
```

**Output:**
```
✓ prescribeWithBlock > Accumulation > should increase volume during accumulation
Test Files  1 passed (1)
     Tests  1 passed (1)
```

---

### Skip Tests with `.skip`
```typescript
// Temporarily disable a test
it.skip("should rotate accessories every 3-4 weeks", () => {
  // This test will be skipped
});

// Skip entire describe block
describe.skip("Exercise Rotation", () => {
  it("test 1", () => {});
  it("test 2", () => {});
});
```

---

### Enable Console Logging
```typescript
it("should select exercises within time budget", () => {
  const result = selectExercisesOptimized(exercises, objective);

  console.log("Selected exercises:", result.selected.map((c) => c.exercise.name));
  console.log("Total time:", result.selected.reduce((sum, c) => sum + c.timeContribution, 0));

  expect(result.selected.length).toBeGreaterThan(0);
});
```

**Run with default reporter (shows console output):**
```bash
npx vitest run src/lib/engine/selection-v2/optimizer.test.ts --reporter=default
```

---

### Use Vitest UI (Browser-based debugger)
```bash
npx vitest --ui
```

**Features:**
- Visual test tree
- Test execution timeline
- Console output per test
- Re-run individual tests
- Opens at `http://localhost:51204/__vitest__/`

---

### Debug with VS Code
**`.vscode/launch.json`:**
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Vitest Tests",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "test:debug"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

**`package.json`:**
```json
{
  "scripts": {
    "test:debug": "vitest --inspect-brk --no-coverage --threads=false"
  }
}
```

**Usage:**
1. Set breakpoints in test file or source code
2. Press F5 (or Run > Start Debugging)
3. VS Code debugger will pause at breakpoints

---

## Coverage Reports

### Generate Coverage
```bash
npm run test:coverage
# Alias for: npx vitest run --coverage
```

**Output:**
```
File                                  | % Stmts | % Branch | % Funcs | % Lines
--------------------------------------|---------|----------|---------|--------
All files                             |   82.45 |    78.32 |   85.67 |   82.45
 src/lib/engine                       |   88.23 |    85.42 |   92.11 |   88.23
  prescription.ts                     |   95.12 |    90.23 |   100.0 |   95.12
  volume.ts                           |   92.34 |    88.45 |   95.67 |   92.34
  apply-loads.ts                      |   89.45 |    82.34 |   91.23 |   89.45
...
```

**HTML Report:**
```bash
npx vitest run --coverage
# Opens: coverage/index.html
```

---

### Coverage Thresholds
**`vitest.config.ts`:**
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
```

**Enforce thresholds:**
```bash
npm run test:coverage
# Fails if coverage < thresholds
```

---

## Parallel Execution

### Run Tests in Parallel (default)
```bash
npm test
# Uses all CPU cores by default
```

---

### Run Tests Serially (for debugging)
```bash
npx vitest run --no-threads
# Runs tests sequentially (slower, but easier to debug)
```

---

### Limit Concurrency
```bash
npx vitest run --max-concurrency=2
# Runs max 2 test files at a time
```

---

## Filtering Tests

### By File Pattern
```bash
# All periodization tests
npx vitest run periodization

# All selection tests
npx vitest run selection

# All explainability tests
npx vitest run explainability
```

---

### By Test Name
```bash
# All tests with "volume" in the name
npx vitest run -t "volume"

# All tests with "should progress" in the name
npx vitest run -t "should progress"

# Multiple patterns (OR logic)
npx vitest run -t "volume|prescription"
```

---

### By File and Test Name
```bash
# All "accumulation" tests in periodization files
npx vitest run periodization -t "accumulation"

# All "fatigue" tests in readiness files
npx vitest run readiness -t "fatigue"
```

---

## Test Timeouts

### Default Timeout
**Default:** 5000ms (5 seconds)

---

### Per-Test Timeout
```typescript
it("should complete within 10 seconds", { timeout: 10000 }, async () => {
  const result = await longRunningOperation();
  expect(result).toBeDefined();
});
```

---

### Global Timeout Override
```bash
npx vitest run --testTimeout=30000
# Sets timeout to 30 seconds for all tests
```

---

### Per-File Timeout
```typescript
// At top of test file
import { describe, it, expect } from "vitest";

describe("End-to-End Simulation", () => {
  // All tests in this describe block have 30s timeout
  it.concurrent("test 1", { timeout: 30000 }, async () => { /* ... */ });
  it.concurrent("test 2", { timeout: 30000 }, async () => { /* ... */ });
});
```

---

## Environment Variables

### Set Environment Variables
```bash
# Unix/Linux/Mac
export USE_REVISED_FAT_LOSS_POLICY=true
npm test

# Windows PowerShell
$env:USE_REVISED_FAT_LOSS_POLICY="true"
npm test

# Inline (Unix/Linux/Mac)
USE_REVISED_FAT_LOSS_POLICY=true npm test
```

---

### In Test Code
```typescript
describe("Fat Loss Policy", () => {
  it("should use revised policy when env var set", () => {
    process.env.USE_REVISED_FAT_LOSS_POLICY = "true";

    const result = prescribeSetsReps(true, "intermediate", fatLossGoals, defaultFatigue);

    expect(result[0].targetReps).toBeGreaterThanOrEqual(12);

    delete process.env.USE_REVISED_FAT_LOSS_POLICY; // Cleanup
  });
});
```

---

## Troubleshooting

### Tests Failing Intermittently (Flaky Tests)
**Cause:** Non-deterministic behavior (Math.random(), Date.now(), etc.)

**Fix:** Use seeded PRNG and pass dates as parameters
```typescript
// Bad
const value = Math.random();
const today = new Date();

// Good
import { createRng } from "./random";
const rng = createRng(12345);
const value = rng();
const today = new Date("2026-03-01");
```

---

### Tests Pass Locally But Fail in CI
**Cause:** Environment differences (timezone, DB state, etc.)

**Fixes:**
1. **Timezone:** Use UTC dates
   ```typescript
   const date = new Date("2026-03-01T00:00:00Z"); // UTC
   ```

2. **Database:** Ensure test DB is clean before each test
   ```typescript
   beforeEach(async () => {
     await prisma.user.deleteMany();
     await prisma.workout.deleteMany();
   });
   ```

3. **Concurrent tests:** Use unique user IDs
   ```typescript
   const userId = `test-user-${Date.now()}-${Math.random()}`;
   ```

---

### Tests Timing Out
**Cause:** Slow database operations or infinite loops

**Fixes:**
1. **Increase timeout:**
   ```typescript
   it("slow test", { timeout: 30000 }, async () => { /* ... */ });
   ```

2. **Optimize DB operations:** Use transactions
   ```typescript
   await prisma.$transaction([
     prisma.workout.create({ data: workout1 }),
     prisma.workout.create({ data: workout2 }),
   ]);
   ```

3. **Mock slow operations:**
   ```typescript
   vi.mock("./slow-function", () => ({
     slowFunction: vi.fn().mockResolvedValue(mockResult),
   }));
   ```

---

### "Cannot find module" Errors
**Cause:** Missing imports or incorrect paths

**Fixes:**
1. **Check path alias:** Use `@/*` for src imports
   ```typescript
   // Good
   import { generateWorkout } from "@/lib/engine";

   // Bad
   import { generateWorkout } from "../../../lib/engine";
   ```

2. **Regenerate Prisma client:**
   ```bash
   npm run prisma:generate
   ```

3. **Clear Vitest cache:**
   ```bash
   npx vitest run --no-cache
   ```

---

### Database Connection Errors
**Cause:** Missing `.env` file or wrong DATABASE_URL

**Fixes:**
1. **Check `.env` file exists:**
   ```bash
   cd trainer-app
   ls -la .env
   ```

2. **Verify DATABASE_URL:**
   ```bash
   cat .env | grep DATABASE_URL
   ```

3. **Test connection:**
   ```bash
   npx prisma db pull --print
   ```

---

### "The column `(not available)` does not exist"
**Cause:** Stale Prisma client (schema changed but client not regenerated)

**Fix:**
```bash
npm run prisma:generate
# Restart dev server if running
```

---

### Tests Pass But Coverage Fails
**Cause:** Coverage thresholds not met

**Fix:**
```bash
# Check coverage report
npm run test:coverage

# Lower thresholds temporarily (vitest.config.ts)
coverage: {
  thresholds: {
    lines: 70,
    functions: 70,
  },
}
```

---

## CI/CD Integration

### GitHub Actions
**`.github/workflows/test.yml`:**
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd trainer-app
          npm ci

      - name: Run tests
        run: |
          cd trainer-app
          npm test
        env:
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./trainer-app/coverage/coverage-final.json
```

---

### Run Subset of Tests in CI
```yaml
# Run only fast unit tests (skip slow E2E tests)
- name: Run unit tests
  run: |
    cd trainer-app
    npx vitest run --exclude "**/__tests__/end-to-end-simulation.test.ts"
```

---

## Performance Optimization

### Reduce Test Execution Time

1. **Use `.concurrent` for independent tests:**
   ```typescript
   it.concurrent("test 1", async () => { /* ... */ });
   it.concurrent("test 2", async () => { /* ... */ });
   ```

2. **Share expensive setup with `beforeAll`:**
   ```typescript
   let macro: MacroCycle;

   beforeAll(() => {
     macro = generateMacroCycle({ /* ... */ }); // Once per file
   });

   it("test 1", () => {
     const blockContext = deriveBlockContext(macro, date1);
     // Use shared macro
   });
   ```

3. **Mock expensive operations:**
   ```typescript
   vi.mock("./expensive-function", () => ({
     expensiveFunction: vi.fn().mockReturnValue(cachedResult),
   }));
   ```

---

### Profile Test Performance
```bash
# Show slowest tests
npx vitest run --reporter=verbose | grep "ms"

# Example output:
# ✓ should generate 12-week PPL (5423ms)
# ✓ should select exercises optimally (342ms)
# ✓ should prescribe sets/reps (24ms)
```

---

## Additional Resources

- [test-overview.md](test-overview.md) — Testing philosophy
- [unit-tests-by-module.md](unit-tests-by-module.md) — Complete test catalog
- [testing-patterns.md](testing-patterns.md) — Conventions and fixtures
- [end-to-end-simulation.md](end-to-end-simulation.md) — Multi-week simulation tests

---

**Last Updated:** 2026-02-16
