# Bounded Trainer2 program support

## Ownership and scope

Based on commit `124d57e0c2b8138b75e3f716729a9c9d26885456`, tree `7f04590a59d2e7efe724b5a13b5d6982841c471e`. `catalog-adapter.ts` owns selectable recording definitions; `program-catalog.json` is a Trainer2-only reviewed variant source. `SetResultRow.tsx` owns form prefill and untouched-measurement preservation. Existing `logging-prefill.ts` remains the history compatibility and rounded-suggestion owner. No V1 source, database schema, migration, grant, owner/session implementation, hosted state or user training plan changes.

## Definition provenance

All source keys below refer to unchanged `prisma/exercises_comprehensive.json`. Muscle lists, movement patterns and rep defaults are inherited explicitly from these sources, not inferred from new display names. These are recording definitions, not new empirical stimulus claims. Builder-authored reps supersede defaults.

| New catalog key (all prefixed `t2:`) | Source metadata | Recording definition and evidence |
| --- | --- | --- |
| neutral-grip-lat-pulldown | lat-pulldown | Cable/machine; same Lats primary and Biceps/Upper Back/Forearms secondary. Proposed program specifies neutral grip. Explicit bilateral stack variant; total reps, external displayed stack setting. |
| ez-bar-preacher-curl | preacher-curl | Biceps primary, no secondary muscles. Source explicitly includes EZ_Bar; retain only EZ bar plus preacher support represented as Bench. Both arms together, total reps, total EZ-bar mass including bar, using existing ez-bar-curl load semantics. |
| rope-hammer-curl | cable-curl and hammer-curl | Both sources name Biceps primary and Forearms secondary. Cable equipment and stack convention from cable-curl; rope neutral grip from requested program. Explicit bilateral variant; total reps. |
| single-arm-cable-lateral-raise | cable-lateral-raise | Side Delts primary, no secondary muscles; cable equipment. User confirmed one arm at a time, reps per side, displayed stack setting. Generic cable-lateral-raise remains unqualified. |
| chest-supported-machine-row-stack | chest-supported-dumbbell-row | Same chest-supported horizontal-row muscle metadata, restricted to the user-confirmed machine execution. Both arms together, total reps, single displayed stack setting. |
| chest-supported-machine-row-plates-per-arm | chest-supported-dumbbell-row | Same muscle metadata; both arms together with equal loading. External plates added per arm, excluding starting resistance. |
| chest-supported-machine-high-row-stack | iso-lateral-high-row | Upper Back/Lats primary, Biceps/Rear Delts secondary. User-confirmed chest-supported machine, both arms together; total reps, displayed stack setting. Ambiguous generic iso-lateral-high-row remains unqualified. |
| chest-supported-machine-high-row-plates-per-arm | iso-lateral-high-row | Same muscle metadata; both arms together with equal loading. External plates added per arm, excluding starting resistance. |
| smith-machine-bulgarian-split-squat-plates-added | bulgarian-split-squat | Quads/Glutes primary, Hamstrings/Adductors secondary. Equipment explicitly changed to Smith_Machine and Bench. User confirmed reps per leg and total plates added across both sides, excluding Smith bar resistance. |

No exact catalog identity is substituted for a materially different implement or support. New immutable variation text states each execution convention. Custom authoring remains available for differing or asymmetric executions.

`machinePlatesPerArm` and `smithPlatesTotal` are distinct external-load conventions. Zero means zero added plates, never zero effective resistance. No starting machine/Smith resistance is inferred, computed or added. Stack entries retain `machineDisplayed` with positive numeric settings; blank stays unspecified. Both-arm rows count one bilateral repetition, not twice that count. Per-leg sets record reps per leg, without independent left/right results.

The adapter validates shared tuples with the existing measurement parser; reviewed plate-only profile/rep/zero tuples are separately validated and explicitly translated in the Trainer2 adapter and never promoted into shared V1 semantics. Complete catalog snapshots, including instructions and facts, continue to be compared canonically on new authoring/acceptance. Reads preserve historical snapshots. Legacy 48-entry snapshots and starter-document hash remain unchanged.

## Exact prescribed-load prefill

Every explicitly measured first prescribed set uses its exact authored load for display rather than nearest-five rounding. Untouched kg prescriptions retain their original decimal spelling, kg unit, kind, convention, zero meaning and rep basis in performed results. UI presents pounds using bounded display conversion; a supported positive kg decimal does not become displayed zero. User-edited loads save as lb. Subsequent sets copy the preceding compatible actual result's weight, reps and RIR, preserving original kg internally when untouched. Session-added exercises/sets use the same rule. Swaps clear unrelated numeric prescriptions and Return to original restores captured START.

All Trainer2 load surfaces use pounds only, including advanced Builder fields, saved draft review, Program, Logger, History and prescription summaries. There is no unit selector or kg entry workflow. `components/trainer2/pound-display.ts` owns display conversion; `DraftEditor.tsx` initializes numeric measurements in lb and changes only an explicitly edited load to lb. Untouched legacy measurements and frozen snapshots retain their internal provenance. Display retains assistance, per-implement, per-arm plates, total Smith plates and total barbell meaning. The disposable Logger journey also verifies new Builder lb authoring/reload and legacy Builder preservation; program-support kg compatibility fixtures are created through fixture commands rather than user controls.

With no explicit prescribed measurement, compatible history still supplies a nearest-five-pound suggestion. Ambiguous source positions and custom descriptions establish no guessed identity/load. Suggestions are never persisted until the user logs a result. Blank and zero remain distinct.

## Compatibility and recovery

No SQL schema/grant change is needed: measurements and captured definitions are existing JSON content. The two new convention enum values extend the Trainer2 wire contract. Old strict application readers reject those values, and older catalog writers cannot qualify the new IDs. After plans/results use the new definitions, recovery must use an application version that understands them; rollback to the baseline is not qualified for those records. No existing snapshot/result is rewritten.

Pending sessionStorage commands/drafts retain their exact saved envelopes and entered forms. A pre-existing rounded lb draft is user/recovery state and is not silently converted back to prescribed kg. Reload alone does not rewrite it. Existing account authorization, assignment binding, optimistic version checks, lost-response replay and reviewed finish remain unchanged.

Integration owner: combine this branch with the separately reviewed access candidate later. Shared integration surfaces are application artifact/build qualification and Trainer2 browser journeys using the current auth boundary. There are no source edits to identity/session owners and no merge is performed here. Catalog definitions and measurement contract changes require the matching reader/server at integration; no hosted admission is authorized by this handoff.

## Verification handoff

Focused definitions cover all 48 legacy snapshots, exact complete-snapshot qualification, new IDs, distinct plate-versus-stack histories, per-side and assistance loads, untouched kg versus edited lb, zero versus blank, tiny positive kg display, carry-forward and ambiguous histories. `scripts/test-trainer2-program-support.ts --confirm-disposable` uses the existing task-owned home/program fixture and `program-support-journey.ts` for Builder selection/prescription/save/reload, logging, swaps/restoration, additions and history. It uses synthetic local training only. Assertions, cleanup results and supervisor completion must be reported separately. Final source identity and exact outcomes are in the local handoff receipt.

All seven requested exercise positions have concrete qualified variants under the user's supplied recording conventions. No remaining definition question is required. Specific machine starting resistance is deliberately excluded; unequal plate loading or a different execution should use explicit custom authoring or a separately reviewed variant.
