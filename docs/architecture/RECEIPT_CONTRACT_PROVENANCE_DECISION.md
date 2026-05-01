# Receipt Contract Provenance Decision

Scope: read-only receipt-contract audit for `trainer-app`. This note does not implement contract changes, mutate data, alter schema, or change app behavior.

## 1. Executive Summary

Recommended decision:

| Proposed field | Decision | Classification | Reason |
|---|---|---|---|
| Active mesocycle id | Add in a future receipt-contract change | Should be in receipt | The receipt currently preserves cycle position but not which active mesocycle produced that position. Saved workouts have `Workout.mesocycleId`, but generated/unsaved receipts and audit comparisons are not self-contained. |
| Generation path | Do not add to receipt | Should remain audit-only | `standard_generation`, `active_deload_reroute`, and explicit deload preview are operational routing facts. They are already represented in workout-audit artifacts and can change as orchestration is refactored. |
| Seed source | Add in a future receipt-contract change, narrowly | Should be in receipt | The receipt cannot currently answer whether runtime composition replayed `slotPlanSeedJson` or fell back. That answer exists in per-exercise selection rationale and audit artifacts, but not as session-level receipt truth. |
| Slot label distinct from slot id | Do not add now | Unnecessary / duplicative | Current runtime slot identity is `slotId + intent + sequenceIndex`; UI labels are derived. No separate persisted slot-label contract was found. |

Bottom line: add only minimal, semantic provenance that helps the receipt preserve runtime meaning across generation, save, audit, and future debugging: active mesocycle id and session-level composition or seed source. Keep route/debug path and display labels outside the receipt unless those become canonical domain facts.

## 2. Evidence Sources

Files inspected:

| Area | Files |
|---|---|
| Receipt schema/types | `trainer-app/src/lib/evidence/types.ts` |
| Receipt parser/builder/normalizer | `trainer-app/src/lib/evidence/session-decision-receipt.ts` |
| Generation finalization | `trainer-app/src/lib/api/template-session/finalize-session.ts` |
| Selection metadata rebuild helpers | `trainer-app/src/lib/ui/selection-metadata.ts` |
| Session semantics consumer | `trainer-app/src/lib/session-semantics/derive-session-semantics.ts` |
| Save route consumer | `trainer-app/src/app/api/workouts/save/route.ts` |
| Generation route consumers | `trainer-app/src/app/api/workouts/generate-from-intent/route.ts`, `trainer-app/src/app/api/workouts/generate-from-template/route.ts` |
| Session audit snapshot | `trainer-app/src/lib/evidence/session-audit-types.ts`, `trainer-app/src/lib/evidence/session-audit-snapshot.ts` |
| Runtime seed replay | `trainer-app/src/lib/api/template-session.ts`, `trainer-app/src/lib/api/template-session/slot-plan-seed.ts` |
| Next-session / workout context | `trainer-app/src/lib/api/next-session.ts`, `trainer-app/src/lib/api/workout-context.ts` |
| UI consumers | `trainer-app/src/lib/ui/session-summary.ts`, `trainer-app/src/lib/ui/workout-list-items.ts`, `trainer-app/src/lib/ui/session-identity.ts`, `trainer-app/src/lib/ui/explainability.ts` |
| Audit consumers | `trainer-app/src/lib/audit/workout-audit/generation-runner.ts`, `trainer-app/src/lib/audit/workout-audit/serializer.ts`, `trainer-app/src/lib/audit/workout-audit/types.ts` |
| Contract docs/schema | `trainer-app/docs/03_DATA_SCHEMA.md`, `trainer-app/docs/04_API_CONTRACTS.md`, `trainer-app/prisma/schema.prisma` |
| Prior live-path evidence | `docs/architecture/SEED_RUNTIME_ALIGNMENT_AUDIT.md` |

Searches run:

```powershell
rg -l "sessionDecisionReceipt|readSessionDecisionReceipt|readSessionSlotSnapshot|extractSessionDecisionReceipt|buildSessionDecisionReceipt|normalizeSelectionMetadataWithReceipt" trainer-app/src trainer-app/docs
rg -n "slotLabel|slot label|slotId.*label|label.*slotId|format.*Slot|sessionSlot" trainer-app/src/lib trainer-app/src/app trainer-app/docs
rg -n "generationPath|standard_generation|active_deload_reroute|persisted_slot_plan_seed|slotPlanSeedJson" trainer-app/src trainer-app/docs
```

## 3. Current Receipt Contract

Observed current type: `SessionDecisionReceipt` in `trainer-app/src/lib/evidence/types.ts`.

Current top-level fields:

| Field | Current purpose |
|---|---|
| `version` | Receipt version, currently `1`. |
| `cycleContext` | Generation-time week/block/phase/deload context. |
| `sessionSlot` | Optional runtime slot identity: `slotId`, `intent`, `sequenceIndex`, optional `sequenceLength`, and source. |
| `targetMuscles` | Optional target-muscle list for generated session variants. |
| `lifecycleRirTarget` | RIR target used by lifecycle/generation. |
| `lifecycleVolume` | Volume targets and target source. |
| `sorenessSuppressedMuscles` | Muscles suppressed by soreness logic. |
| `deloadDecision` | Deload mode/reason/reduction/application target. |
| `plannerDiagnosticsMode` | Standard/debug diagnostics mode. |
| `plannerDiagnostics` | Optional planner diagnostics, sanitized by mode. |
| `readiness` | Autoregulation/readiness summary. |
| `exceptions` | Semantic exceptions such as optional gap-fill, supplemental deficit, and closeout. |

Current `cycleContext` fields:

| Field | Present? | Notes |
|---|---|---|
| `weekInMeso` | Yes | Preserves mesocycle week number. |
| `weekInBlock` | Yes | Preserves block-relative week number. |
| `blockDurationWeeks` | Optional | Present when canonical block context exists. |
| `mesocycleLength` | Optional | Duration context, not identity. |
| `phase` | Yes | Accumulation/intensification/realization/deload. |
| `blockType` | Yes | Block type mirror for display/logic. |
| `isDeload` | Yes | Boolean deload signal. |
| `source` | Yes | `computed` or `fallback`. |
| Active mesocycle id | No | Proposed field. |

Current `sessionSlot` fields:

| Field | Present? | Notes |
|---|---|---|
| `slotId` | Yes | Canonical runtime slot identity, for example `upper_a`. |
| `intent` | Yes | Session intent, for example `upper`. |
| `sequenceIndex` | Yes | Zero-based slot position. |
| `sequenceLength` | Optional | Total slot-sequence length when known. |
| `source` | Yes | `mesocycle_slot_sequence` or `legacy_weekly_schedule`. |
| Slot label | No | Proposed field, but current UI derives labels from `slotId` and `intent`. |

Important parser behavior:

- `buildSessionDecisionReceipt()` only accepts the current contract fields.
- `parsePersistedReceipt()` reconstructs only the current contract fields.
- `normalizeSelectionMetadataWithReceipt()` rebuilds the receipt from parsed values.
- `selection-metadata.ts` helpers also rebuild receipts when stamping optional gap-fill, supplemental, closeout, or slot metadata.

Interpretation: unknown future fields would be easy to drop accidentally unless every receipt rebuild path is updated. Any contract addition must update parser, builder, normalizer, selection metadata helpers, route tests, and receipt tests together.

## 4. Current Consumers

| Consumer category | Main files | What they read today | Do proposed fields matter today? |
|---|---|---|---|
| Receipt build/parse/normalize | `src/lib/evidence/session-decision-receipt.ts` | Full current receipt shape | Yes. Any new field must be parsed and preserved here first. |
| Generation finalization | `src/lib/api/template-session/finalize-session.ts` | Builds receipt from mapped generation context and optional `sessionSlot` | Yes. This is the correct write point for active mesocycle id and composition source if added. |
| Generation routes | `src/app/api/workouts/generate-from-intent/route.ts`, `src/app/api/workouts/generate-from-template/route.ts` | Attach canonical selection metadata and generated session audit snapshots | Yes. They know active mesocycle, requested slot, optional gap-fill, supplemental, and generated audit context. |
| Save route | `src/app/api/workouts/save/route.ts` | Requires receipt, normalizes it, persists saved mesocycle snapshots separately | Yes. It should preserve new receipt fields and could later compare receipt mesocycle id against `Workout.mesocycleId`. |
| Session semantics | `src/lib/session-semantics/derive-session-semantics.ts` | Cycle phase, deload decision, exceptions, selection mode, session intent | No direct need. It does not need mesocycle id, generator path, seed source, or label for current classification. |
| Next-session and history context | `src/lib/api/next-session.ts`, `src/lib/api/workout-context.ts` | `sessionSlot.slotId`, snapshots from workout row | Slot label is not needed. Active mesocycle id is read from workout row, not receipt. |
| UI session display | `src/lib/ui/session-summary.ts`, `src/lib/ui/workout-list-items.ts`, `src/lib/ui/session-identity.ts` | Slot id, intent, week/phase, derived labels | Slot label is currently display-only and derived. |
| Explainability | `src/lib/api/explainability.ts`, `src/lib/ui/explainability.ts` | Receipt, workout row mesocycle snapshot, session audit snapshot | Active mesocycle id is available from row after save; generation seed source is not a first-class receipt fact. |
| Session audit snapshot | `src/lib/evidence/session-audit-snapshot.ts` | Generated state from receipt/workout, saved state with mesocycle snapshot | Saved side already carries `mesocycleId`; generated side does not. |
| Workout audit CLI | `src/lib/audit/workout-audit/generation-runner.ts`, `serializer.ts`, `types.ts` | Top-level `generationPath`, session snapshot, generation result | Generation path already belongs here. Seed source can be inferred from selection rationale but is not receipt-level. |
| Historical slot repair / handoff artifacts | `src/lib/api/historical-session-slot-repair.ts`, `src/lib/api/mesocycle-handoff-artifacts.ts` | Receipt `sessionSlot` and workout/mesocycle context | Slot id matters. Slot label does not. |

## 5. Proposed Field Analysis

### Active Mesocycle Id

Observed facts:

- `Workout.mesocycleId` exists in Prisma and is persisted on saved workouts.
- `Workout.mesocycleWeekSnapshot`, `Workout.mesoSessionSnapshot`, and `Workout.mesocyclePhaseSnapshot` provide saved read-model context.
- `SessionAuditSavedState.mesocycleSnapshot` can carry `mesocycleId`, week, session, and phase after save.
- `SessionDecisionReceipt.cycleContext` currently carries week/phase/block context but not the active mesocycle id that produced it.
- The generated session response carries `selectionMetadata.sessionDecisionReceipt` before a workout row exists.

Pros of adding:

- Makes generated and unsaved receipts self-contained enough to say which active mesocycle produced the cycle context.
- Allows save/audit code to detect mismatch between generation-time active mesocycle and save-time `Workout.mesocycleId`.
- Reduces dependence on external audit context when checking seed/runtime alignment.
- Fits the receipt's existing role as immutable generation-time evidence.

Cons of adding:

- Duplicates `Workout.mesocycleId` after save unless the meanings are documented separately.
- Existing historical receipts will not have it.
- Current receipt rebuild helpers would drop it unless explicitly updated.
- Closeout/gap-fill/supplemental sessions need clear semantics: the field should mean "generation active mesocycle id" or "anchored mesocycle id", not just "whatever row is saved later."

Decision:

**Should be in receipt**, but only as immutable generation/anchor provenance. It should not replace `Workout.mesocycleId` as the relational association for saved workouts.

Recommended future meaning:

```txt
activeMesocycleId = the mesocycle whose lifecycle/slot/seed context was used to generate or anchor this receipt
```

### Generation Path

Observed facts:

- Workout audit already records `generationPath` separately in `generation-runner.ts`.
- The known audit values include standard generation, explicit deload preview, and active-deload reroute.
- The receipt already carries semantic outcomes that matter downstream: cycle phase, deload decision, session slot, exceptions, readiness, and volume/RIR context.
- Route/generator function names are implementation details and can change without changing session meaning.

Pros of adding:

- A receipt alone could say which route branch created it.
- It would make some audit artifacts easier to inspect without looking at top-level audit metadata.

Cons of adding:

- Turns operational routing into stored domain evidence.
- Creates churn if generation orchestration is renamed or split.
- Duplicates existing audit artifact metadata.
- Does not currently affect session semantics, progression eligibility, next-session resolution, UI labels, or logging.

Decision:

**Should remain audit-only.** Do not add generator path or route path to `sessionDecisionReceipt`.

Recommended boundary:

```txt
Audit artifact owns: requested mode, execution mode, generator function, routing reason.
Receipt owns: the session decision outcome and stable runtime meaning.
```

### Seed Source

Observed facts:

- Accepted seeded mesocycles use `Mesocycle.slotPlanSeedJson` as canonical runtime composition source.
- Runtime seed replay is implemented through `slot-plan-seed.ts` and `template-session.ts`.
- Seeded selection currently stamps per-exercise rationale with `reason: "persisted_slot_plan_seed"` and `components.slotPlanSeed`.
- `slotPlanSeedJson` can have its own source such as `handoff_slot_plan_projection`.
- The receipt currently carries slot identity but not whether composition was replayed from seed, legacy-selected, deload-transformed, or fallback-shaped.
- The prior live-path audit had to compare seed JSON, selection rationale, generated workout, and audit artifact fields to prove seed replay.

Pros of adding:

- Makes the receipt capable of answering the core architecture question: "what composition authority produced this session?"
- Avoids relying on per-exercise rationale as a session-level source-of-truth substitute.
- Helps distinguish expected legacy fallback from bad seed data or runtime bugs after the fact.
- Supports future audit/reporting without recomputing or mining generator internals.

Cons of adding:

- Must be carefully named to avoid copying all seed details into the receipt.
- Can duplicate evidence already present in selection rationale and audit artifacts.
- Needs clear behavior for non-seeded legacy sessions, deload sessions, optional gap-fill, supplemental sessions, and seed set-count fallback.
- Historical receipts will need an `unknown` or absent-state interpretation.

Decision:

**Should be in receipt**, but as a small session-level composition provenance field, not as a full seed mirror.

Recommended future meaning:

```txt
compositionSource = persisted_slot_plan_seed | legacy_selection | deload_generation | fallback | unknown
seedSource = source string from slotPlanSeedJson when compositionSource is persisted_slot_plan_seed
seedSlotId = slot id replayed from seed when compositionSource is persisted_slot_plan_seed
```

The exact field names should be finalized during implementation planning. The important contract decision is that seed replay versus fallback should be a receipt-level fact.

### Slot Label

Observed facts:

- `sessionSlot.slotId` already preserves canonical slot identity.
- UI display labels are derived by `src/lib/ui/session-identity.ts` from `intent` and `slotId`.
- `formatSessionSlotTechnicalLabel()` currently returns `null`, so the app is not displaying a distinct technical slot label.
- Setup preview docs mention display-only slot labels, but runtime receipt semantics use `slotId + intent + sequenceIndex`.
- Some audit/planning files use local `slotLabel` strings, but those are not the receipt contract.

Pros of adding:

- If user-authored mutable labels ever become canonical, a receipt display snapshot could preserve historical wording.
- It could make audit artifacts more readable.

Cons of adding:

- No distinct runtime slot-label source of truth was found.
- Duplicates derived UI language today.
- Risks making display decoration look like domain identity.
- Slot identity is already stable through `slotId`, `intent`, `sequenceIndex`, and `source`.

Decision:

**Unnecessary / duplicative today.** Do not add `slotLabel` to the receipt now.

Future exception:

If the product later adds user-authored slot names whose wording must be historically preserved, add a display snapshot field only after the slot contract itself owns that label. Until then, labels should remain derived UI.

## 6. Pros and Cons of Changing the Receipt

### Pros

- Makes receipts more self-contained for generated/unsaved sessions.
- Lets future audits validate active mesocycle and seed replay without stitching together row context, seed JSON, rationale, and audit metadata.
- Converts "seed replay happened" from an inferred per-exercise pattern into a stable session-level fact.
- Helps classify future failures as legacy fallback, unsupported seed shape, bad data, or runtime bug.

### Cons

- Additive receipt fields must be preserved through multiple rebuild paths, not just parsed.
- Some provenance overlaps with `Workout.mesocycleId`, `SessionAuditSavedState.mesocycleSnapshot`, `Mesocycle.slotPlanSeedJson.source`, and selection rationale.
- Existing historical receipts will lack the new fields and need compatibility handling.
- Poorly scoped fields could turn the receipt into a dumping ground for route/debug metadata.

Guardrail: add provenance only when it answers stable session meaning. Keep operational trace/debug fields in audit artifacts.

## 7. Recommended Decision

Recommended future receipt additions:

| Addition | Purpose | Owner to update later |
|---|---|---|
| Active mesocycle id / anchor mesocycle id | Preserve which mesocycle generated or anchored the receipt | `src/lib/evidence/types.ts`, `src/lib/evidence/session-decision-receipt.ts`, `src/lib/api/template-session/finalize-session.ts`, generation routes, save route preservation/tests |
| Composition or seed source | Preserve whether runtime composition came from persisted slot-plan seed or fallback/legacy generation | `src/lib/evidence/types.ts`, `src/lib/evidence/session-decision-receipt.ts`, `src/lib/api/template-session.ts`, `src/lib/api/template-session/slot-plan-seed.ts`, audit tests |

Recommended non-additions:

| Field | Keep out because |
|---|---|
| Generation path | Audit-only operational metadata. Receipt should store outcome, not route mechanics. |
| Slot label | No distinct runtime label contract exists. Current labels are UI-derived from canonical slot identity. |

Recommended contract language:

```txt
sessionDecisionReceipt is the immutable generated-session meaning/evidence payload.
It should preserve the mesocycle/slot/composition authority needed to interpret the generated plan.
It should not preserve implementation routing details or display-only labels.
```

## 8. Migration and Backward Compatibility Considerations

No migration is required by this decision note because no code or schema is changed here.

If the recommended additions are implemented later:

| Consideration | Required handling |
|---|---|
| Historical receipts | Treat missing provenance as `unknown` / legacy absent. Do not invalidate existing receipts. |
| Receipt parser | Parse optional new fields in `parsePersistedReceipt()`. |
| Receipt builder | Accept and emit new fields from `buildSessionDecisionReceipt()`. |
| Receipt normalization | Preserve new fields in `normalizeSelectionMetadataWithReceipt()`. |
| Selection metadata helpers | Preserve new fields in optional gap-fill, supplemental, closeout, and slot-stamping helpers. |
| Generation finalization | Stamp active mesocycle id and composition source at generation time. |
| Save route | Preserve fields and optionally compare active mesocycle provenance with saved `Workout.mesocycleId`. |
| Session audit snapshot | Decide whether generated audit snapshots should copy these fields or continue reading them from the receipt. |
| Tests | Update receipt parser/builder tests, generation route tests, save-route integration tests, session metadata tests, and audit tests. |
| Versioning | Prefer optional additive `version: 1` fields only if older receipts remain valid and unknown/missing fields are explicitly handled. Use a version bump only if semantics become breaking. |

Important compatibility risk: current receipt rebuild paths do not preserve unknown fields. Adding fields only to the TypeScript type is not enough. The parser, builder, and every rebuild helper must preserve them before any downstream consumer can rely on them.

## 9. Current Ambiguity Assessment

| Ambiguity | Exists today? | Safe current workaround | Residual risk |
|---|---|---|---|
| Which mesocycle generated this unsaved receipt? | Yes | Audit context or save-time active mesocycle lookup | Medium. Save-time context can differ from generation-time context. |
| Which mesocycle owns a saved workout? | Mostly no | `Workout.mesocycleId` and saved mesocycle snapshots | Low-medium. Receipt cannot independently cross-check the row. |
| Did runtime replay `slotPlanSeedJson`? | Yes, from receipt alone | Selection rationale, seed JSON, generated exercises, audit artifact | Medium. Requires inference across multiple artifacts. |
| Which generator route/path ran? | Yes, from receipt alone | Workout-audit `generationPath` | Low. This is operational metadata. |
| What display label should be shown for a slot? | No material ambiguity | Derive from `slotId` and `intent` through UI helper | Low. No distinct canonical label exists. |

## 10. No Code Changes

This audit created only this markdown decision note:

```txt
docs/architecture/RECEIPT_CONTRACT_PROVENANCE_DECISION.md
```

It intentionally did not change:

- `trainer-app/src`
- `trainer-app/prisma`
- tests
- seed data
- runtime behavior
- database records

