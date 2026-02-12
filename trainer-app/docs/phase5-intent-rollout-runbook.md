# Phase 5 Intent Rollout Runbook

Date: 2026-02-12
Owner: Product + Engineering

## Goal

Roll out intent mode as the default for new users in a controlled way and validate production quality using KPI checkpoints.

## Preconditions (must be true before flip)

- Weekly analysis Option A is live (history-backed intent estimation for mixed weekly schedules).
- Selection calibration scenarios pass (4/4).
- Manual full-session review passes (8/8 coherent sessions).
- Cold-start staged unlock is enabled and verified.
- KPI outputs are available from analytics summary.

## Flag and scope

- Feature flag: `USE_INTENT_DEFAULT_FOR_NEW_USERS`
- Scope: only new users (no existing workouts).
- Existing users stay on current behavior unless changed intentionally.

## Rollout steps

1. Confirm baseline metrics for the prior 7 days with the flag off.
2. Enable `USE_INTENT_DEFAULT_FOR_NEW_USERS=true` in the target environment.
3. Smoke test:
   - New user lands on intent-default generation path.
   - Existing user remains unaffected.
   - Save path persists `selectionMode=INTENT` and `sessionIntent`.
4. Monitor KPIs at week 1, week 2, and week 4.
5. Keep flag on only if success thresholds are met.

## Manual test execution (today)

Use this sequence when you are ready to manually validate the rollout in dev or staging.

### 1) Preflight setup

- Confirm environment and branch are what you expect.
- Ensure `USE_INTENT_DEFAULT_FOR_NEW_USERS=false` before baseline checks.
- Keep `USE_INTENT_COLD_START_PROTOCOL` at the intended value for this environment.
- Prepare two test users:
  - **New user**: no workouts saved.
  - **Existing user**: has at least one saved workout.
- Keep one short note doc open while testing and log pass/fail per step.

### 2) Capture baseline (flag off)

1. Call `GET /api/analytics/summary` and save the response snapshot.
2. Record:
   - `kpis.selectionModes` rows
   - `kpis.intents` rows
3. This is your pre-rollout comparison point.

### 3) Flip the flag

1. Set `USE_INTENT_DEFAULT_FOR_NEW_USERS=true`.
2. Restart or redeploy the target runtime so env changes are active.
3. Confirm the app instance you are testing is using the updated env.

### 4) Smoke test matrix (required)

Run all checks below in order and mark each as pass/fail.

| Check | Test action | Expected result |
|---|---|---|
| New user default path | Generate first workout as the new user | Request follows intent-default path (no template-only fallback unless expected by cold-start logic) |
| Existing user safety | Generate workout as existing user | Existing behavior remains unchanged |
| Save payload | Save new-user generated session | Save includes `selectionMode=INTENT` and `sessionIntent` |
| Persistence readback | Re-open workout detail/history | Persisted values reflect intent mode and chosen intent |
| Analytics ingestion | Refresh `GET /api/analytics/summary` after test saves | Generated/completed counters move in expected mode/intent buckets |

### 5) Quick quality checks (manual coherence)

Use the existing review artifact as your reference:

- `docs/template/phase5-intent-session-manual-review.md`

For 2-3 newly generated sessions, confirm:

- Main movements appear early.
- Accessories complement the session intent.
- No obvious duplicate/redundant picks.
- Set targets look plausible for training age and session time budget.

### 6) Immediate rollback triggers

Turn the flag off immediately if any of these are true:

- New users are not defaulting to intent mode.
- Existing users are unexpectedly shifted to intent mode.
- Save path does not persist `selectionMode=INTENT` and `sessionIntent` correctly.
- Clear session-coherence regressions appear repeatedly in manual checks.
- Analytics output becomes internally inconsistent after saves.

Then execute rollback steps in this runbook and open an investigation ticket with:

- Repro steps
- User type used (new/existing)
- Request/response payload snippets
- Analytics snapshot before/after

## KPI sources

- Endpoint: `GET /api/analytics/summary`
- Selection mode KPIs: `kpis.selectionModes[]`
  - `mode`
  - `generated`
  - `completed`
  - `completionRate`
- Intent KPIs: `kpis.intents[]`
  - `intent`
  - `generated`
  - `completed`
  - `completionRate`

## KPI checkpoints

### Week 1 (early safety)

- Validate no obvious regression in intent completion rate versus baseline.
- Confirm intent generation volume is growing for new users.
- Verify no unexpected mode-distribution anomalies.

### Week 2 (initial signal)

- Compare `completionRate` for `INTENT` against pre-rollout baseline and template cohorts.
- Check weekly analysis outcomes for improved volume adherence trends (especially fewer below-target warnings in mixed schedules).
- Track qualitative feedback for session coherence and edit/substitution friction.

### Week 4 (decision checkpoint)

- Require intent completion to be equal or better than baseline.
- Require volume adherence to be improved or neutral with cleaner weekly coverage.
- If criteria hold, keep flag enabled as the default path.
- If criteria fail, turn flag off and investigate by intent and training-age slices.

## Success criteria

- No regression in completion.
- Improved weekly volume adherence.
- No major qualitative regressions in session coherence.

## Interpreting early data correctly

- Anchor persistence signal is delayed by design.
- First sessions in intent mode are anchor-light (cold-start stage behavior).
- Do not judge anchor-dependent KPIs until users have at least 3 same-intent sessions (roughly one mesocycle for stable signal).

## Rollback plan

1. Set `USE_INTENT_DEFAULT_FOR_NEW_USERS=false`.
2. Re-run smoke test for default mode behavior.
3. Continue collecting analytics while investigating root cause.

