# Trainer2 populated template builder

This document owns the bounded catalog/template and explicit override extension to [the draft slice](DRAFT_SLICE.md). Local, synthetic development only. Planning owns expansion and compatibility in `src/lib/engine/trainer2/plan-builder.ts`, `catalog.ts` and `planning.ts`; contracts live in `src/lib/trainer2-contracts/draft.ts`. The existing API transaction, command envelope, ownership boundary, immutable revisions, identity registry, retry and stale-edit protections remain authoritative. No migration or V1 runtime dependency is added.

## Template and catalog provenance

Starter version 1 is a general, editable full-gym hypertrophy starting point, not historical reconstruction or individualized optimization. It balances squat/hinge, horizontal/vertical push/pull, unilateral work, arms, calves and core. Existing runtime template assets require V1 plan/database context and were not reused as authority.

`catalog-snapshot.json` is a bounded Trainer2-owned snapshot of 48 exercises selected from `prisma/exercises_comprehensive.json` at base `3dc23f5978ec27af8cb1f76a8c400a589bc0f20b`. Source SHA-256: `E9C3368519730685D066A0D9FB07315090DC1CB22F4548F9C8267EAADA3C415F`. It copies names, equipment, reviewed measurement profile/convention/basis and rep recommendations; adds explicit purpose groups and common aliases. Goblet Squat is narrowed to its dumbbell variant (the source lists dumbbell and kettlebell alternatives). No runtime import of the source asset or live legacy lookup occurs.

`t2:<source catalog key>` IDs belong to this snapshot, not to V1 database exercise IDs. Catalog version 1 is immutable: new catalog meaning requires a new version or identity. The saved exercise includes ID/version, name, equipment, purpose and measurement semantics. Acceptance verifies that snapshot against the versioned registry. Custom names always remain `authoredDescription`, including names identical to catalog entries. Unsupported timed, distance and unreviewed measurement exercises are excluded; picker empty-state copy explains this boundary.

Initialization copies the starter into an unsaved document. All 20 occurrences and their positions/targets receive distinct identities. Template constants never run on load. `starterVersion` records origin; plan-owned workout defaults and occurrence prescriptions are saved, so template changes cannot alter saved plans. Existing empty plans stay empty.

Four training weeks use weekly effort 3 / 3 / 2 / 1 reps left; week 5 uses 4. Deload halves working sets, rounded up with a minimum of one. Rep ranges and exercise meaning stay unchanged. No load increase is prescribed. Weight stays unspecified until deliberately entered. Per-side reps are shown explicitly.

## Starter prescriptions

| Workout | Role | Exercise | Working sets × reps |
| --- | --- | --- | --- |
| Lower A | Main | Barbell Back Squat | 3 × 6–10 |
| Lower A | Secondary | Barbell Romanian Deadlift | 3 × 8–10 |
| Lower A | Accessory | Seated Leg Curl | 2 × 10–15 |
| Lower A | Calves | Selectorized Standing Calf Raise | 3 × 10–15 |
| Lower A | Core | Cable Crunch | 2 × 10–15 |
| Upper A | Main | Barbell Bench Press | 3 × 6–10 |
| Upper A | Secondary | Chest-Supported Dumbbell Row | 3 × 8–12 |
| Upper A | Accessory | Lat Pulldown | 2 × 8–12 |
| Upper A | Accessory | Dumbbell Lateral Raise | 2 × 12–20 |
| Upper A | Accessory | Cable Triceps Pushdown | 2 × 10–15 |
| Upper A | Accessory | Dumbbell Curl | 2 × 10–15 |
| Lower B | Main | Leg Press | 3 × 8–12 |
| Lower B | Secondary | Bulgarian Split Squat | 2 × 8–12 per side |
| Lower B | Accessory | Lying Leg Curl | 3 × 10–15 |
| Lower B | Calves | Seated Calf Raise | 3 × 12–20 |
| Lower B | Core | Machine Crunch | 2 × 10–15 |
| Upper B | Main | Incline Dumbbell Bench Press | 3 × 8–12 |
| Upper B | Secondary | Seated Cable Row | 3 × 8–12 |
| Upper B | Secondary | Dumbbell Overhead Press | 2 × 8–12 |
| Upper B | Accessory | Lat Pulldown | 2 × 10–15 |
| Upper B | Accessory | Reverse Pec Deck | 2 × 12–20 |
| Upper B | Accessory | Overhead Cable Triceps Extension | 2 × 10–15 |
| Upper B | Accessory | Cable Curl | 2 × 10–15 |

## Overrides and structure

The occurrence owns explicit `overrides`: removed source keys, an order override, position-keyed field masks and row values, and target-ID-keyed masks for individually edited set fields. Values live in immutable saved documents and travel through the named `setWeekEdits` command. `editPositionRole` preserves roles independently of exercise identity. No override is inferred by comparing shared and current values. A deliberate field input equal to the default remains explicit after reload.

- Shared field edits reach every inheriting occurrence field. Position-level overrides cover sets, reps (range/basis together), exercise, role, measurement, effort, rest, classification and requiredness. Individual-set overrides take precedence over row field defaults. Editing a field for all sets deliberately replaces individual overrides of that same field only.
- Reset field removes that override and uses the current shared/weekly default. Reset individual-set field restores its current row default. Reset swap restores the shared exercise, reps and measurement together; unrelated overrides stay.
- Week-only additions have no shared source key and remain independent authored content, even for duplicate exercises. Row and individual-set edits do not create inheritance masks or reset controls for these additions. They follow shared rows unless the week has an explicit order. Shared additions append to an explicitly ordered week; otherwise shared order applies and week-only additions remain at the end.
- Week-only removal records a source-key tombstone. Shared changes cannot resurrect it. Restore workout clears all local structural/field edits, removes week-only additions and recreates removed positions with fresh IDs.
- Week-only reorder preserves the explicit remaining ID order. Shared additions append. Shared removal drops only the removed slot and preserves the other order. Reorder never regenerates identity.
- Shared removal affecting week-specific field/set edits requires a modal identifying affected weeks; `removeBuilderRow` removes only that slot and its dependent masks, values and target metadata. Set reductions and set-count resets both use `changeSetCount`: discarded individually edited sets are identified before confirmation, and only their metadata is removed. Cancel retains the whole plan. Reset computes the current inherited count, including a single deload reduction from the shared count.
- Older `weekOverride: true` occurrences remain independent, including when shared rows are removed. No field provenance is guessed. Their existing content is preserved until deliberate Restore workout. Older documents without a builder keep the structural editor.
- Start blank deliberately removes all exercises and week overrides, retaining the schedule and its identities. Saved history remains immutable; Save records the replacement as a new revision.

## Swap and picker behavior

Browse opens immediately. Suggestions rank exact purpose/movement groups first, then matching equipment, then name; sharing a muscle alone never earns a suggestion. Search matches names and aliases such as RDL, DB bench and BSS. Full gym is the default. Plan equipment preferences are durable, optional and never replace exercises; unavailable equipment is flagged. A picker-local equipment filter narrows current results only.

Swaps retain slot/source, occurrence, position and surviving target IDs. They change only the chosen scope. Same-purpose/same-rep-basis replacements retain sets and rep ranges. Different purpose or rep basis uses the candidate's rep defaults; sets and other compatible details remain. All exercise-specific numeric weight/assistance is cleared, even when the units match. Bodyweight candidates get explicit bodyweight meaning; load/assistance candidates have unspecified weight until entered. Catalog controls permit only that exercise's recorded basis/kind/convention, while preserving units and decimal spelling. No implicit kg/lb, assistance or unilateral conversion occurs.

A shared swap preserves independently swapped weeks. Inheriting weeks with incompatible rep-basis or numeric measurement overrides require deliberate confirmation before those particular overrides are cleared. Other overrides stay. With a week swap, reps and measurement are explicitly scoped with the exercise; reset of just reps uses compatible defaults for that selected exercise.

The native dialog supports focus containment/return, Escape, Tab, arrow navigation among results, Enter and touch. Roles and optional details are expandable; the ordinary row shows exercise, sets and reps. Individual set details remain editable. The five-week view reads actual occurrence prescriptions, including deload and overrides.

The picker retains its invoking element and restores focus after React commits dismissal or selection. If that element disappears or becomes disabled, focus returns to Add exercise or the edit-scope control. A following confirmation dialog retains modal focus. Weekly summaries use compact count × reps/effort only when those displayed prescriptions agree across sets; mixed sets show a numbered breakdown. Rep basis and zero effort remain visible.

## Override validation and saved-document recovery

`draftDocument` is the shared strict boundary for CreateDraft and the final atomic EditDraft document. Override values must reference a position in the same occurrence, correspond to its declared field mask, and retain supported value/catalog meaning. Unsupported fields and malformed values reject the command. Older shared mask-only representations remain supported without inferred values; explicitly equal values remain overrides.

The defective template candidate could save values for removed positions and inheritance labels on source-less additions. `readSavedDocument` opens such saved revisions unchanged only when `repairBuilderMetadata` would produce a fully valid document. This read path writes nothing and does not reinterpret historical content. New commands never use the compatibility schema to validate incoming documents.

The editor shows **Remove obsolete override labels** and requires that explicit action before further builder edits. It removes only value entries whose position no longer exists anywhere in the document, and masks/values/target masks on source-less additions. Actual positions, targets, decimal spelling, independent prescriptions, and legitimate shared overrides remain unchanged. Save submits ordinary `setWeekEdits` operations with the current expected revision; the server validates the complete result before writing a new immutable revision. Reload before Save cancels the pending repair. A rename alone cannot silently repair an invalid document.

Foreign-position values, mask/value mismatches on existing shared positions, malformed values and unsupported fields are outside this repair. They remain rejected and require separately scoped investigation. No historical revision rewrite, SQL repair, migration, generic save or automatic background cleanup exists. Correction evidence and limits are in [the correction report](TEMPLATE_BUILDER_CORRECTIONS.md).

## Verification and restart

Focused tests: `src/lib/engine/trainer2/template-builder.test.ts`, retained planning/editor tests, and transitive isolation test. `scripts/trainer2/verify-template-persistence.ts` covers real PostgreSQL round-trips for explicit equal overrides, individual-set decimals, duplicate positions, additions/removals/order/reset and legacy drafts. `verify-editor-browser.ts` exercises the actual app at 1280px and 390px, keyboard/touch swaps, alias/equipment search, field inheritance, save/reload, stale edits and uncertain retries. The existing harness retains atomic rollback, immutable-revision, owner/role and upgrade tests. Screenshots and source-qualified receipts are local ignored artifacts.

From this worktree's `trainer-app` directory:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

The launcher prints **READY — Trainer plan builder**, followed by its clickable loopback URL. Enter/Ctrl+C stops the app and deletes its own synthetic database. Installed dependencies, Docker and `postgres:17-alpine` are required. Plan editing only; activation and hosted readiness are not claimed.
