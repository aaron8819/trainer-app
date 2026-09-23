# Local training interface

`DraftWorkbench` keeps draft authoring and activated training presentation separate. An activated/completed bookmark at `/trainer2/dev/drafts?planId=…` shows Training. `&view=program` opens the dedicated, bookmarkable Program view; browsing never starts an execution. Existing development/principal/admission gates apply unchanged.

## Owners and read models

Planning's existing `readNextWorkout` remains authoritative for next selection, account-wide open execution, occurrence status and program completion. Its occurrence rows additionally expose the account/plan-scoped finished `executionId` (null otherwise) for result links. No occurrence cursor or new persistence is introduced.

`TrainingOverview` joins the validated saved document and next read by occurrence UUID. Program week is the saved stage position of the open/next occurrence, never elapsed time. Total weeks and workout counts come from saved arrays. Accumulation/deload labels require builder metadata. Effort is summarized from the actual occurrence targets, including mixed and partially unspecified RIR. Completed counts mean finished workouts, which can have unrecorded sets; skipped work is counted separately. The final home preserves result and Program access.

`training-summary.ts` aggregates only consecutive targets whose complete authored meaning matches, excluding identity. Rep basis, measurement value/unit/convention/zero meaning, effort, rest, classification and requiredness remain significant. Unspecified load/rest are omitted. Original target values and execution captures are never changed.

## Previous performance

Execution & Evidence owns the presentation-only `readExecutionWithPrevious` enrichment in `src/lib/api/trainer2/previous-performance.ts`. The existing execution GET runs it inside the authorized repeatable-read, read-only transaction. No new route, account resolution, write, V1 history import, or progression calculation exists.

Rules:

- Read only the trusted account's finished executions, excluding this execution. Finish time must be no later than the current execution's immutable start time. Search newest finish first; execution UUID breaks timestamp ties deterministically.
- Match catalog identity/version and the complete catalog snapshot, including variation and measurement semantics. This conservative rule can omit renamed snapshots. Custom authored descriptions have no stable exercise identity and never match by name.
- Omit a candidate with multiple positions carrying the same exercise snapshot. Do not invent correspondence between duplicate appearances.
- Read latest result revisions through the existing execution reader, including corrections made after completion. Ignore cleared results, discarded attempts and skips. A candidate must actually be Finished with a finish fact.
- Require specified reps and measurement, matching catalog rep basis, load type and convention. A result must fit at least one current target's measurement semantics. Both supported mass units (kg/lb) are comparable and displayed in pounds; original source values remain available. When targets have no authored load, catalog kind/convention establish compatibility and each historical result displays its own unit. Once this exercise has observed current reps or load, those actual semantics take precedence: previous results must agree with every specified rep basis and load kind/convention in at least one current result. Partial actual results constrain only their specified fields; effort alone does not establish a measurement context. This matcher performs no numerical comparison; the presentation helper converts supported mass for display.
- Choose the latest candidate containing compatible results per current exercise position. Display the compatible exercise results, source workout, finish date and execution link, without claiming set-for-set correspondence. Incompatible results within a candidate are omitted. No amounts become today's defaults or recommendations.

Reads currently scan prior finish IDs and validate candidate executions until each match is found (or history is exhausted). This simple implementation has no pagination/caching optimization; a large unmatched history can cost additional queries. A corrupt source fails the read explicitly rather than fabricating history.

## Entry, recovery and navigation

`SetResultRow` owns result drafts, suggestions, original version bindings, exact pending commands and conflict recovery. `ActiveWorkout` owns selection, queue presentation, movement and advisory rest. Value corrections now accept an absent reason; finish, discard and reasoned erroneous clearing retain their established contracts. Only explicit Log set or Update set records evidence.

Logging defaults to pounds without a preference system or unit picker. `pound-display.ts` divides kg by exactly 0.45359237 and rounds converted presentation to two decimal places; existing lb decimal spelling is retained. Bodyweight and unspecified measurements are not converted. Per-implement, machine-displayed, barbell-total, added and assistance meanings remain explicit. When correcting a result with no saved measurement, the form uses the prescribed or catalog load type while leaving the weight blank; it does not retroactively add a measurement. Original units remain in immutable source data; the repeated Original units disclosure is removed. Immutable prescriptions and persisted result revisions are never relabeled or modified. An unchanged measurement in a correction retains its original value/unit bytes. Saving unchanged values is a no-op, preventing display-only corrections and conversion drift. New numeric mass entered here uses lb. Changing actual load type remains an explicit Options action.

Suggestion priority: an existing user-edited draft (including deliberately cleared fields), persisted result when editing, the nearest preceding non-cleared logged target in the same execution-owned exercise position in saved set order, then first-set load defaults. If that preceding result has incompatible rep/load meaning, it is not used and no older recorded target is substituted. No data crosses exercise-position boundaries. Missing actual fields carry as missing, including optional reps/RIR and zero. Untouched forms derive defaults from each authoritative read, even if mounted or selected before the previous save; they do not retain a convenience snapshot. User drafts keep their original reviewed version until explicit conflict review/rebase. Late saves cannot change selection or replace another form's draft.

For set 1, a compatible explicit prescription supplies load first. Otherwise, read-only `firstSetLoads` selects the trusted account's latest eligible Finished workout at/before the current start, excluding the current execution, discarded attempts and skipped occurrences. Stable catalog ID/version, variation, equipment, load kind/convention and rep basis must agree; display-name differences do not change identity, and authored descriptions never match by name. Within the workout, scan matching exercise positions and targets in saved order for the first recorded working set with compatible numeric load, using its latest corrected revision. Missing reps do not disqualify a weight suggestion. Incompatible or missing loads are skipped; zero is eligible. This weight-only selection is separate from the unchanged comparison-history display matcher above.

Initial prescription/history mass converts to pounds and then rounds to the nearest 5 lb, with positive halfway values upward (60 kg → 130 lb). The starting-target summary labels rounded prescription values as suggestions; history says Last time and never authors a prescription. Following sets copy actual values with no five-pound rounding. Carried kg measurements retain original bytes when logged unchanged; edited/persisted amounts are never quantized. Exact first-set reps and optional RIR retain their existing defaults; ranges never become performed reps. Suggestions write no results until explicit logging.

A saved chip opens the correction form directly. Reps have circular ±1 controls; weight has −10/−5/+5/+10 lb then Clear; RIR has 0–5 shortcuts and optional direct 0–10 entry. Clear blanks the weight field, never the saved result. The separate reasoned Clear erroneous result command retains its established meaning. Blank and zero remain distinct.

Uncertain delivery exposes Retry save with the exact retained envelope after the in-flight request fails. The pending controls and status do not reserve space during a normal save; Check saved results is omitted because a generic refresh cannot establish whether the exact command succeeded. Conflict exposes Review latest result and a separate explicit rebase/save. Finish/discard conflicts have contextual Review latest values. There is no permanent Recovery panel. Eligible empty discard is under Workout menu; any recorded or skipped set history still forbids it. Finish remains separate with pending/unsaved blockers and explicit acknowledgement of missing work. Only confirmed finish/readback navigates home.

## Advisory rest

`rest-state.ts` and `RestBar` maintain a browser-local deadline. After a bound accepted **RecordSetResult** plus authoritative matching readback, a version-1 event starts 180 seconds for the just-logged Main lift or 120 seconds otherwise. Authored rest remains visible as a target but does not override this personal-use timer rule. The deadline is the server record timestamp plus duration, never response arrival time. Late retries receive only the remaining interval; already-expired responses display no timer. Corrections, clear/re-record (which are corrections under the existing identity), readback alone, refresh and historical replay do not start rest. A new record during rest replaces it; older out-of-order events cannot replace a newer rest.

LocalStorage scopes state to account/execution and records seen action IDs, including dismissed/expired events. Reload and browser restart preserve the deadline if that origin's storage is retained. Storage deletion/private browsing can lose convenience state; storage failure does not block logging. Browser/server clocks are assumed reasonably aligned; timestamps represent recording, not inferred performance time. Visibility changes and deadline-based ticks handle delayed/background execution without extending rest. Cross-tab storage events synchronize the displayed timer. Controls add/subtract 30 seconds or dismiss, clamped at zero. No per-second server writes, sounds or notification permissions exist. Confirmed finish/discard (including terminal readback) clears rest. The timer cannot block navigation, logging or completion.

## Queue, scrolling and focus

Consecutive role groups retain saved exercise order and can collapse; each exercise's set chips are always directly visible below its information. Native details state persists through logging and selection while the component remains mounted. Reload need not preserve expansion. Counts use non-null saved results only; selected chips are highlighted and logged chips retain mass convention, rep basis and explicit RIR. `MuscleTags` joins version-1 catalog identity to the bounded display-only `catalog-muscles.json` mapping. Its 48 entries were extracted from V1 `prisma/exercises_comprehensive.json` at commit `15783474`, matching each `t2:` ID to `catalogKey` and verifying names offline. Primary and secondary labels use explicit text as well as distinct styling and appear only in the exercise queue. Custom descriptions, unmatched IDs and other catalog versions receive no tags. This mapping never alters saved exercise identity or prescriptions.

Only an explicit queue selection or confirmed log/skip advance requests movement. Target identity and selection generation must still match submission time. Corrections, timers, typing and refresh never move selection. The selected heading receives focus with preventScroll; numeric inputs are never auto-focused on advance. Scroll occurs only when the relevant card is outside the usable visual viewport, reserving bottom space and honoring reduced motion. Trainer2 excludes the V1 sticky navigation; no hidden fixed header overlaps this route. Reduced-height emulation verifies scrolling, not a physical mobile keyboard.

Deferred: Skip Set, Add Set/Exercise, new warmup authoring, finishers, Pause/Resume, Undo Finish, undo-skip, full offline/device-loss recovery and physical mobile qualification. Earlier accepted domain reviews remain closed; accumulated training UI still requires independent review.

## Local demo restart

The existing confirmed-disposable launcher now accepts `r` then Enter to restart only its application on the same port, retaining its database. Enter alone or Ctrl+C still stops the launcher and removes its own database. Full launcher restart creates fresh data. No hosted admission changes.

See `artifacts/trainer2/TRAINING_UI_HANDOFF.md` for source-bound browser/PostgreSQL results, screenshots, gates, synthetic setup and exact demo coordinates.

## Active-set logging

One identity-keyed controller per execution target remains mounted, with only the selected form visible. Selection is retained in account/execution-scoped sessionStorage, falling back to the first unresolved target in immutable saved order. A bound accepted new record and matching current readback advances to the next unresolved target, wrapping to earlier work, only while selection identity/generation still match. Newer known result versions prevent stale advancement. Corrections and clear/re-record stay selected. All-resolved work shows Ready to finish; it does not finish automatically.

See [logging polish handoff](../../../artifacts/trainer2/LOGGING_POLISH_HANDOFF.md) for source-bound verification, screenshots, demo instructions and remaining limitations.

## V1 layout refinement

`SetResultRow` uses full-width reps between circular steppers, a left-aligned weight-control row above the weight input, RIR presets above direct entry, and equal-width black primary and outlined secondary pill actions. `ActiveWorkout` shows an editing banner and Return to active set without discarding retained input. `RestBar` exposes accessible ±30-second controls directly beside the countdown.

History uses aligned weight/reps/RIR columns, with load convention and rep basis retained. Original kg values remain internal; blank actuals display an em dash. Shared load-basis labels appear once, with per-row labels only when meanings differ. Row numbers enumerate available previous results in saved set order; the read model excludes invalid/missing comparison sources and does not expose original set ordinals. They do not identify current-set matches.

See [prefill corrections handoff](../../../artifacts/trainer2/LOGGER_PREFILL_HANDOFF.md) for the reproduced stale-suggestion defects, browser/PostgreSQL evidence and separate disposable demo. Earlier visual-only handoffs describe historical policy, superseded by the rules above.

## V1 logger alignment and durable Skip set

[SKIP_SET.md](SKIP_SET.md) owns the current layout, durable skipping and finish/discard integration. Active input uses a hidden legend and shows feedback only when needed; there is no normal Discard input action. New performed results require reps, including valid zero, while load may be unspecified. Machine-displayed pounds offer 2.5 lb adjustments in addition to the existing steps. The timer appears outside and above the card only while active, and sticks during scrolling. Its bottom progress line drains smoothly against the deadline with a reduced-motion fallback. Queue counts distinguish logged/skipped/remaining, and progress is labeled resolved. Queue chips omit unspecified fields while preserving the full result in history. Existing draft protection, prefill, measurement meaning and rest deadlines remain.
