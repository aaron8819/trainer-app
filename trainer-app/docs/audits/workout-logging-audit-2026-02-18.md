# Workout Logging Audit
*2026-02-18 — decisions captured for implementation*

---

## Technical Bugs

| ID | Severity | Location | Issue |
|----|----------|----------|-------|
| T1 | High | `src/components/LogWorkoutClient.tsx:569` | Complete/Skip buttons have no loading guard — double-tap fires duplicate POST requests; `detectPRsFromWorkout` can race |
| T2 | High | `src/components/LogWorkoutClient.tsx:447` | `handleUndo` has no try/catch and no loading state — if DB call fails, UI shows "reverted" but DB wasn't updated (silent desync) |
| T3 | Medium | `src/app/log/[id]/page.tsx` | Workout stays `PLANNED` throughout entire logging session — dashboard shows wrong state, "Start logging" never changes to "Continue logging" |
| T4 | Low | `src/lib/validation.ts:119` | `actualRpe: z.number().optional()` — no 0.5-step rounding or [1–10] bounds enforced on backend; frontend clamps range but not steps |
| T5 | Low | `src/components/LogWorkoutClient.tsx:157` | `withDefaults` overwrites previously-logged `null` actualReps with `targetReps` on page reload — misrepresents what user actually logged |
| T6 | Low | `src/components/BonusExerciseSheet.tsx:52` | `.catch(() => {})` on `/api/exercises` fetch — search silently returns 0 results with no error message if the request fails |
| T7 | Trivial | `src/lib/validation.ts:117` | `workoutExerciseId` in `setLogSchema` is accepted and forwarded but never read by the route handler — dead field |
| T8 | Low | `src/lib/api/pr-tracker.ts:101` | `prevMax === null` always counts as a PR — first-time user sees every exercise as a "personal record" |
| T9 | Low | `src/lib/api/pr-tracker.ts:31` | PR detection is weight-only (`actualLoad: { not: null }`) — bodyweight exercises never get PR feedback; reps PRs not tracked |
| T10 | Low | `src/app/api/workouts/[id]/add-exercise/route.ts:53` | `targetLoad = null` hardcoded for bonus exercises — no load estimation from history even when history exists |
| T11 | Trivial | `src/components/LogWorkoutClient.tsx:790` | Skip logs target-prefilled reps/load alongside `wasSkipped: true` — misleading raw data (display is fine since `wasSkipped` takes priority) |

---

## UX Issues

| ID | Priority | Location | Issue |
|----|----------|----------|-------|
| U1 | Critical | `LogWorkoutClient` | **No rest timer** — KB §E explicitly calls this a core requirement; every comparable app has it; users must use phone clock separately |
| U2 | High | `LogWorkoutClient.tsx:1072` | Complete/Skip buried in "More actions" at bottom — on long workouts requires scrolling past everything; early completion is 4 taps + scroll |
| U3 | High | `LogWorkoutClient.tsx:231` | Warmup/accessory sections start collapsed; queue never auto-expands when active set advances into a new section |
| U4 | Medium | `LogWorkoutClient.tsx:164` | RPE pre-filled from target — leads to lazy/inaccurate logging; target should be shown as reference, not pre-filled |
| U5 | Medium | `LogWorkoutClient.tsx:1048` | Undo toast renders inline at bottom of scroll flow — invisible when keyboard is open or page is scrolled; 5s window may be too short |
| U6 | Low | `LogWorkoutClient.tsx:721` | RPE preset buttons only show `[7, 8, 9, 10]` — warmup and lighter accessories often land at RPE 5–6; user must type manually |
| U7 | Low | `LogWorkoutClient.tsx` | Per-set notes field exists in DB schema and API but is never exposed in the logging UI |
| U8 | Low | `LogWorkoutClient.tsx:776` | "Same as last" copies target-prefilled values when previous set was skipped — misleads user into thinking it was a real prior performance |
| U9 | Low | `LogWorkoutClient.tsx:669` | Dumbbell delta buttons can produce non-standard weights (e.g. 22.5 lbs/dumbbell) — `snapToDumbbell` only applies on display from storage, not on entry |
| U10 | Low | `src/app/workout/[id]/page.tsx` | Post-log analysis view and `/workout/[id]` Session Review show the same data in two different UIs with no cross-link between them |

---

## Decisions

| Decision | Choice |
|----------|--------|
| **Rest timer** | Auto-start after each set is logged |
| **Rest duration** | Infer from exercise: use `restSeconds` field if set; fallback: main lifts 3 min, accessories 90s, warmup 60s. User can override. |
| **Sticky footer** | Replace "More actions" with a sticky bottom bar showing progress + complete button |
| **Section auto-expand** | Auto-expand the section containing the active set when it advances |
| **RPE pre-fill** | Start empty — user enters actual RPE; target shown as reference label only |
| **IN_PROGRESS status** | Set workout to `IN_PROGRESS` on first set logged |
| **T1 (double-tap guard)** | Fix |
| **T2 (undo error handling)** | Fix |
| **T6 (bonus sheet silent error)** | Fix |
| **T8 (PR first-timer false positive)** | Fix |
