# Template builder corrections — ready for focused re-review

Branch: `codex/trainer2-builder-corrections`. Base: `fe73741255311280098175a8b7309654a5b31823`, tree `5c4ad1caed12c3b1f8dd9c6e0e3309c30f356778`. Final commit/tree and evidence hashes are recorded in the task worktree's `trainer-app/artifacts/corrections/final-source.json` after commit.

All five review failures were corroborated before corrections using a task-owned disposable PostgreSQL 17 database and installed Edge. The independent review, implementation delivery/evidence, original worktrees and user demo were read-only. Report labels below follow the review, not its internal probe labels.

| Finding | Root cause and correction | Evidence |
| --- | --- | --- |
| R1 | Reset bypassed destructive-count handling and left cut target masks. Domain `changeSetCount` now owns reduction and reset, identifies week/workout/exercise/set conflicts, throws before mutation unless confirmed, prunes discarded target metadata, and retains surviving IDs/prescriptions. Deload reset derives from the current shared count. | Domain regressions and browser exact reproduction; cancel/confirm; unrelated pending name and surviving decimal customization; save/reload; no-conflict reset; stable deload. |
| R2 | Shared removal omitted the values map; document validation omitted value relationships. `removeBuilderRow` and `removePositionContent` own both removal scopes. Strict document validation rejects unknown/foreign keys, unmasked values, unsupported/malformed fields and inconsistent catalog meaning. | Unit and real HTTP/PostgreSQL Create/Edit matrix; preceding valid rename never partially applies; equal overrides and old mask-only records remain valid; shared removal cancel/confirm. Synthetic pre-correction orphans recover explicitly into new revisions while historical canonical bytes remain identical. |
| U1 | Source-less additions acquired masks despite having no inherited baseline. Row and target editing now preserve these as independent authored content without inheritance controls. Old false labels have narrow explicit recovery. | Unit old-document recovery and browser add/edit/individual edit/save/reload with no reset controls; shared reset still works. |
| U2 | Dialog removal did not explicitly restore the invoker. Picker retains the trigger and restores focus after React commits; absent/disabled triggers use a nearby editor control. | Real Edge Add and Swap: Escape, close and selection return focus; Tab continues. Component tests cover removed/disabled triggers. |
| U3 | Summary used only the first target and omitted rep basis. Presentation formatter compares all displayed prescriptions, gives numbered mixed-set details, and retains basis and zero effort. | Unit and saved/reloaded browser checks for 6–10/2 alongside 15–20/0, per-side reps and compact homogeneous text. No targets changed for display. |

## Local verification

Sanitized commands, outcomes, screenshots and source manifests are under `trainer-app/artifacts/corrections/` in this correction worktree. Durable definitions are `src/lib/engine/trainer2/builder-corrections.test.ts`, `src/components/trainer2/ExercisePicker.test.tsx` and `scripts/trainer2/verify-builder-corrections.ts`.

- 47 focused tests across 8 domain/component/isolation files passed, including the existing draft tests.
- Repository-selected `test:fast`: 86 tests across 8 files passed. TypeScript, affected-file ESLint and whitespace checks passed.
- Real installed Edge at 1280px and 390px with touch support, named HTTP commands and PostgreSQL round-trips passed. Populated plan → swap → customize → save → reload remains functional.
- Desktop/mobile reset confirmation, independent-addition controls and weekly-summary screenshots were visually inspected. Browser fallback uses repository-installed Playwright because agent-browser is unavailable; nothing was downloaded.
- Original foundational evidence was source-qualified before edits. Unchanged SQL constraints/migrations, Auth/principal checks, envelope binding, transaction write sequence and isolation boundaries retain that evidence. Full foundational SQL attack/upgrade inventory and full release build were not mechanically rerun. The repository gate explicitly excludes generic release `verify` in local implementation mode.

The browser receipt with recovery proves two documents actually saved by the defective candidate: a direct orphan-value CreateDraft and ordinary shared-removal orphan values. Both opened without writes, required explicit cleanup, saved a successor revision, and preserved all executable prescriptions and original canonical revision bytes. Source-less legacy recovery is additionally covered by domain tests. [The contract](TEMPLATE_BUILDER.md#override-validation-and-saved-document-recovery) defines exactly what can be repaired; other malformed relationships fail closed.

## Repetition and limits

From this worktree's `trainer-app` directory, start a new disposable service:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Wait for READY and use its newly printed loopback URL. To run the correction browser matrix, supply that task-owned service's URL and container name:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/trainer2/verify-builder-corrections.ts --confirm-disposable http://127.0.0.1:<port> trainer2-draft-<suffix>
```

An optional final argument points to baseline probe receipts from the *same* disposable database; use it only before their affected heads have been repaired. Baseline probe sources/receipts are retained locally. They were run against the uncorrected base before source edits; they intentionally assert the old failures. The final source binding separately qualifies the recovery receipt and the final browser run.

Only task-owned browser/app/database services were stopped after verification. No originating evidence, worktree, branch or user service was removed. Mobile evidence uses emulation, not physical devices. This is a bounded correction matrix, not exhaustive catalog-pair testing. No push, merge, deployment, production access, hosting, activation or Phase 0 completion. Independent re-review has not been performed on this correction candidate.
