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

`SetResultRow` owns result drafts, suggestions, original version bindings, exact pending commands and conflict recovery. `ActiveWorkout` owns selection, queue presentation, movement and advisory rest. The result, finish and discard server protocols remain unchanged. Only explicit Log set or Save correction records evidence.

Logging defaults to pounds without a preference system or unit picker. `pound-display.ts` divides kg by exactly 0.45359237 and rounds converted presentation to two decimal places; existing lb decimal spelling is retained. Bodyweight and unspecified measurements are not converted. Per-implement, machine-displayed, barbell-total, added and assistance meanings remain explicit. Original kg prescriptions are available in History; saved kg values expose Original units. Immutable prescriptions and persisted result revisions are never relabeled or modified. An unchanged measurement in a correction retains its original value/unit bytes. Saving unchanged values is a no-op, preventing display-only corrections and conversion drift. New numeric mass entered here uses lb. Changing actual load type remains an explicit Options action.

Suggestion priority: retained unsaved draft, saved result for correction, nearest compatible preceding logged set in this execution-owned exercise position (reverse saved set order), then explicit prescription. Rep basis and load type/convention/zero meaning must be compatible; missing fields carry as missing. No data crosses exercise-position boundaries, even for duplicate labels. Prescription defaults include an explicit load, exact reps only (ranges remain visible and actual reps blank), and a single optional RIR. Previous-workout performance never supplies amounts. Suggested values are captured once when first presented and retained separately in same-tab sessionStorage; they do not count as unsaved input. Refresh/correction of another set cannot overwrite them. Drafts keep their original reviewed version until explicit conflict review/rebase.

A saved chip opens the correction form directly. Reps have circular ±1 controls; weight has −5/−1/+1/+5/Clear; RIR has 0–3 shortcuts and optional direct 0–10 entry. Clear blanks the weight field, never the saved result. The separate reasoned Clear erroneous result command retains its established meaning. Blank and zero remain distinct.

Uncertain delivery exposes Retry save (the exact retained envelope) and Check saved results. Readback reports Checking… then current data or an actionable failure, but never proves an individual command succeeded or clears pending state. Conflict exposes Review latest result and a separate explicit rebase/save. Finish/discard conflicts have contextual Review latest values. There is no permanent Recovery panel. Eligible empty discard is under Workout menu; any recorded history still forbids it. Finish remains separate with pending/unsaved blockers and explicit acknowledgement of missing work. Only confirmed finish/readback navigates home.

## Advisory rest

`rest-state.ts` and `RestBar` maintain a browser-local deadline. After a bound accepted **RecordSetResult** plus authoritative matching readback, a version-1 event starts 180 seconds for the just-logged Main lift or 120 seconds otherwise. Authored rest remains visible as a target but does not override this personal-use timer rule. The deadline is the server record timestamp plus duration, never response arrival time. Late retries receive only the remaining interval; already-expired responses display no timer. Corrections, clear/re-record (which are corrections under the existing identity), readback alone, refresh and historical replay do not start rest. A new record during rest replaces it; older out-of-order events cannot replace a newer rest.

LocalStorage scopes state to account/execution and records seen action IDs, including dismissed/expired events. Reload and browser restart preserve the deadline if that origin's storage is retained. Storage deletion/private browsing can lose convenience state; storage failure does not block logging. Browser/server clocks are assumed reasonably aligned; timestamps represent recording, not inferred performance time. Visibility changes and deadline-based ticks handle delayed/background execution without extending rest. Cross-tab storage events synchronize the displayed timer. Controls add/subtract 30 seconds or dismiss, clamped at zero. No per-second server writes, sounds or notification permissions exist. Confirmed finish/discard (including terminal readback) clears rest. The timer cannot block navigation, logging or completion.

## Queue, scrolling and focus

Consecutive role groups retain saved exercise order and can collapse; each exercise's set chips can expand/collapse. Native details state persists through logging and selection while the component remains mounted. Reload need not preserve expansion. Counts use non-null saved results only; selected chips are highlighted and logged chips retain mass convention, rep basis and explicit RIR. Trainer2's version-1 catalog has purpose/equipment/measurement metadata but **no verified muscle-group tags**; tags are omitted rather than inferred or sourced from V1.

Only an explicit queue selection or confirmed new-record advance requests movement. Target identity and selection generation must still match submission time. Corrections, timers, typing and refresh never move selection. The selected heading receives focus with preventScroll and a polite announcement; numeric inputs are never auto-focused on advance. Scroll occurs only when the relevant card is outside the usable visual viewport, reserving bottom space and honoring reduced motion. Trainer2 excludes the V1 sticky navigation; no hidden fixed header overlaps this route. Reduced-height emulation verifies scrolling, not a physical mobile keyboard.

Deferred: Skip Set, Add Set/Exercise, new warmup authoring, finishers, Pause/Resume, Undo Finish, undo-skip, full offline/device-loss recovery and physical mobile qualification. Earlier accepted domain reviews remain closed; accumulated training UI still requires independent review.

## Local demo restart

The existing confirmed-disposable launcher now accepts `r` then Enter to restart only its application on the same port, retaining its database. Enter alone or Ctrl+C still stops the launcher and removes its own database. Full launcher restart creates fresh data. No hosted admission changes.

See `artifacts/trainer2/TRAINING_UI_HANDOFF.md` for source-bound browser/PostgreSQL results, screenshots, gates, synthetic setup and exact demo coordinates.

## Active-set logging

One identity-keyed controller per execution target remains mounted, with only the selected form visible. Selection is retained in account/execution-scoped sessionStorage, falling back to the first unrecorded target in immutable saved order. A bound accepted new record and matching current readback advances to the next unrecorded target, wrapping to earlier work, only while selection identity/generation still match. Newer known result versions prevent stale advancement. Corrections and clear/re-record stay selected. All-recorded work shows Ready to finish; it does not finish automatically.

See [logging polish handoff](../../../artifacts/trainer2/LOGGING_POLISH_HANDOFF.md) for source-bound verification, screenshots, demo instructions and remaining limitations.
