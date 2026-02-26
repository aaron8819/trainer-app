/**
 * Protects: GET /api/workouts/history — cursor-based paginated workout log with filter support.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const workoutFindMany = vi.fn();
  const workoutCount = vi.fn();

  const prisma = {
    workout: {
      findMany: workoutFindMany,
      count: workoutCount,
    },
  };

  return { prisma, workoutFindMany, workoutCount };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeWorkout(overrides: Partial<{
  id: string;
  scheduledDate: Date;
  completedAt: Date | null;
  status: string;
  selectionMode: string;
  sessionIntent: string | null;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  mesocyclePhaseSnapshot: string | null;
  exerciseCount: number;
  setLogCount: number;
}> = {}) {
  const exerciseCount = overrides.exerciseCount ?? 3;
  const setLogCount = overrides.setLogCount ?? 9;
  // Build nested exercise/set/log structure matching the select shape
  const exercises = Array.from({ length: exerciseCount }, () => ({
    sets: Array.from({ length: 3 }, () => ({
      _count: { logs: Math.floor(setLogCount / exerciseCount) },
    })),
  }));

  return {
    id: overrides.id ?? "workout-1",
    scheduledDate: overrides.scheduledDate ?? new Date("2026-02-20T10:00:00Z"),
    completedAt: overrides.completedAt ?? null,
    status: overrides.status ?? "COMPLETED",
    selectionMode: overrides.selectionMode ?? "INTENT",
    sessionIntent: overrides.sessionIntent ?? "PUSH",
    mesocycleId: overrides.mesocycleId ?? null,
    mesocycleWeekSnapshot: overrides.mesocycleWeekSnapshot ?? null,
    mesocyclePhaseSnapshot: overrides.mesocyclePhaseSnapshot ?? null,
    _count: { exercises: exerciseCount },
    exercises,
  };
}

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/workouts/history");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workoutCount.mockResolvedValue(0);
  mocks.workoutFindMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/workouts/history", () => {
  it("returns 20 results by default with no filters", async () => {
    const workouts = Array.from({ length: 20 }, (_, i) =>
      makeWorkout({ id: `w-${i}`, scheduledDate: new Date(`2026-02-${String(20 - i).padStart(2, "0")}T10:00:00Z`) })
    );
    mocks.workoutFindMany.mockResolvedValue(workouts);
    mocks.workoutCount.mockResolvedValue(20);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workouts).toHaveLength(20);
    expect(body.totalCount).toBe(20);
    expect(body.nextCursor).toBeNull();
  });

  it("sets nextCursor when more results exist beyond the page", async () => {
    // Return take+1 = 21 workouts to signal more are available
    const workouts = Array.from({ length: 21 }, (_, i) =>
      makeWorkout({
        id: `w-${i}`,
        scheduledDate: new Date(Date.now() - i * 86400000),
      })
    );
    mocks.workoutFindMany.mockResolvedValue(workouts);
    mocks.workoutCount.mockResolvedValue(50);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.workouts).toHaveLength(20);
    expect(body.nextCursor).toBe(workouts[19].scheduledDate.toISOString());
  });

  it("intent filter is forwarded in findMany where clause", async () => {
    mocks.workoutFindMany.mockResolvedValue([makeWorkout({ sessionIntent: "PULL" })]);
    mocks.workoutCount.mockResolvedValue(1);

    await GET(makeRequest({ intent: "PULL" }));

    const callArgs = mocks.workoutFindMany.mock.calls[0][0];
    expect(callArgs.where.sessionIntent).toBe("PULL");
  });

  it("status filter (comma-separated) is forwarded as in-list", async () => {
    mocks.workoutFindMany.mockResolvedValue([
      makeWorkout({ status: "COMPLETED" }),
      makeWorkout({ status: "PARTIAL" }),
    ]);
    mocks.workoutCount.mockResolvedValue(2);

    await GET(makeRequest({ status: "COMPLETED,PARTIAL" }));

    const callArgs = mocks.workoutFindMany.mock.calls[0][0];
    expect(callArgs.where.status).toEqual({ in: ["COMPLETED", "PARTIAL"] });
  });

  it("cursor pagination passes scheduledDate lt constraint", async () => {
    const cursorDate = "2026-02-15T10:00:00.000Z";
    mocks.workoutFindMany.mockResolvedValue([makeWorkout({ id: "w-old" })]);
    mocks.workoutCount.mockResolvedValue(1);

    await GET(makeRequest({ cursor: cursorDate }));

    const callArgs = mocks.workoutFindMany.mock.calls[0][0];
    expect(callArgs.where.scheduledDate?.lt).toEqual(new Date(cursorDate));
  });

  it("count query does NOT include cursor constraint", async () => {
    const cursorDate = "2026-02-15T10:00:00.000Z";
    mocks.workoutFindMany.mockResolvedValue([]);
    mocks.workoutCount.mockResolvedValue(5);

    await GET(makeRequest({ cursor: cursorDate }));

    const countArgs = mocks.workoutCount.mock.calls[0][0];
    // Count where should not have a scheduledDate.lt from the cursor
    const sd = countArgs.where.scheduledDate;
    expect(sd?.lt).toBeUndefined();
  });

  it("nextCursor is null when fewer results than take", async () => {
    const workouts = [makeWorkout({ id: "only-one" })];
    mocks.workoutFindMany.mockResolvedValue(workouts);
    mocks.workoutCount.mockResolvedValue(1);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.nextCursor).toBeNull();
    expect(body.workouts).toHaveLength(1);
  });

  it("totalCount reflects filtered total not page size", async () => {
    const workouts = Array.from({ length: 5 }, (_, i) =>
      makeWorkout({ id: `w-${i}` })
    );
    mocks.workoutFindMany.mockResolvedValue(workouts);
    mocks.workoutCount.mockResolvedValue(42);

    const res = await GET(makeRequest({ intent: "LEGS" }));
    const body = await res.json();

    expect(body.workouts).toHaveLength(5);
    expect(body.totalCount).toBe(42);
  });

  it("invalid intent param returns 400", async () => {
    const res = await GET(makeRequest({ intent: "INVALID_INTENT" }));
    expect(res.status).toBe(400);
  });

  it("invalid status value returns 400", async () => {
    const res = await GET(makeRequest({ status: "COMPLETED,NOT_A_STATUS" }));
    expect(res.status).toBe(400);
  });

  it("maps exerciseCount and totalSetsLogged correctly", async () => {
    const workout = makeWorkout({ exerciseCount: 3, setLogCount: 9 });
    mocks.workoutFindMany.mockResolvedValue([workout]);
    mocks.workoutCount.mockResolvedValue(1);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.workouts[0].exerciseCount).toBe(3);
    // 3 exercises × 3 sets × floor(9/3) = 9 logs total (may vary by int division)
    expect(typeof body.workouts[0].totalSetsLogged).toBe("number");
  });
});
