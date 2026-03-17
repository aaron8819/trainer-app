# Audit CLI DB Validation

Use this together with `docs/09_AUDIT_PLAYBOOK.md`.
- This file is the narrow DB-backed validation runbook for the unified `npm run audit:workout` entrypoint.
- It covers environment prerequisites, preflight, and exact commands against a real database.
- The recurring operational workflow, field-reading order, red flags, and escalation rules live in `docs/09_AUDIT_PLAYBOOK.md`.

Use this when validating the audit foundation against a real database instead of mocked unit inputs.

## Prerequisites

- Set `DATABASE_URL` for the target environment.
- Prefer a disposable or read-only environment first.
- Pick a user that already has:
  - at least one saved workout week
  - at least one performed exercise with progression history
  - an active or recently completed mesocycle

## Preflight

```powershell
npm run audit:workout -- --mode historical-week --user-id <user-id> --week <week>
```

The command should print the audit preflight block and write an artifact under `artifacts/audits/`.

## Recommended Validation Runs

Historical week:

```powershell
npm run audit:workout -- --mode historical-week --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>
```

Future week:

```powershell
npm run audit:workout -- --mode future-week --user-id <user-id>
```

Future week for one explicit intent:

```powershell
npm run audit:workout -- --mode future-week --user-id <user-id> --intent pull
```

Forced deload preview:

```powershell
npm run audit:workout -- --mode deload --user-id <user-id> --intent pull
```

Progression / anchor trace:

```powershell
npm run audit:workout -- --mode progression-anchor --user-id <user-id> --exercise-id <exercise-id> --workout-id <workout-id>
```

## What To Inspect

Use this section as a quick validation smoke-check only. Full artifact interpretation order belongs in `docs/09_AUDIT_PLAYBOOK.md`.

- `historicalWeek.sessions[*].sessionSnapshot`
- `historicalWeek.sessions[*].progressionEvidence`
- `historicalWeek.sessions[*].weekClose`
- `historicalWeek.sessions[*].reconciliation`
- `sessionSnapshot.generated.traces.progression`
- `sessionSnapshot.generated.traces.deload`

## Expected Hardening Checks

- Deload traces include `resolvedTopSetLoad`, `resolvedSetLoads`, and `resolvedLoadSource`.
- Historical week entries expose whether a session counted toward progression history without reading code.
- Historical week entries surface linked or target-week-close state when relevant.
- Reconciliation reports generated-vs-saved drift without flattening the generated/saved layers.
