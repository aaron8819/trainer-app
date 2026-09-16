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
- Require specified reps and measurement, matching catalog rep basis, load type and convention. A result must fit at least one current target's measurement semantics. Explicit target units must agree. When targets have no authored load, catalog kind/convention establish compatibility and each historical result displays its own unit. Once this exercise has observed current reps or load, those actual semantics take precedence: previous results must agree with every specified rep basis and load kind/convention/unit in at least one current result. Partial actual results constrain only their specified fields; effort alone does not establish a measurement context. There is no unit conversion or numerical comparison.
- Choose the latest candidate containing compatible results per current exercise position. Display the compatible exercise results, source workout, finish date and execution link, without claiming set-for-set correspondence. Incompatible results within a candidate are omitted. No amounts become today's defaults or recommendations.

Reads currently scan prior finish IDs and validate candidate executions until each match is found (or history is exhausted). This simple implementation has no pagination/caching optimization; a large unmatched history can cost additional queries. A corrupt source fails the read explicitly rather than fabricating history.

## Entry, recovery and navigation

`SetResultRow` retains the accepted explicit RecordSetResult / CorrectSetResult / CorrectHistoricalSetResult protocol. Untouched compact controls contain no actual values and create neither a draft nor a result. Rep basis and load type/convention come only from a saved prescription or catalog snapshot. Authored unit wins; otherwise a unique unit in current workout results can supply context. With no reliable unit, choose kg/lb explicitly. Mixed current units provide no default. Historical amounts are never copied.

Edited actual values and original reviewed versions remain in account/execution/target-scoped session storage. Saving, saved, validation failure, uncertain delivery and conflict remain distinct. Saved results reopen through explicit Edit/Correct actions. Options preserve units, load types, rep basis and external zero meaning. Blank remains unspecified; zero remains a value. Clear/re-record and historical correction restrictions are unchanged. Refresh cannot replace unsaved input or rebase it. Exact retries, unmount invalidation and explicit conflict review are retained.

Finish retains acknowledgement of unrecorded sets. Pending/unsaved input blocks finish with safe record/discard/recovery actions. Only accepted finish followed by successful authoritative completion readback invokes `onFinished`. The browser returns to the plan bookmark, where a session-scoped success marker is checked against a Finished occurrence/execution before display. Home reads current weekly state again. Completed execution pages do not embed a next-workout prompt.

Skip confirmation retains its frozen command target/revision/sequence; it now displays stage/week text and the occurrence's unique ordinal within the saved program. Duplicate names cannot obscure the target.

## Rest and deferred work

V1 has `RestTimer` and `useRestTimerState`. Trainer2 has no timer/session timer state. This slice displays authored rest when present and removes repeated missing-rest text. It does not import V1 timer/mutation state or insert defaults into activated intent. A later Trainer2 timer should use authored rest first, otherwise 180 seconds for explicit Main lift roles and 120 seconds for other roles, clearly labeled as defaults.

Deferred: add a finisher after completion as a separate lifecycle slice; Pause/Resume; Undo Finish; undo-skip; new progression algorithms; full offline/device-loss recovery; physical mobile qualification. No nonfunctional finisher button exists.

## Local demo restart

The existing confirmed-disposable launcher now accepts `r` then Enter to restart only its application on the same port, retaining its database. Enter alone or Ctrl+C still stops the launcher and removes its own database. Full launcher restart creates fresh data. No hosted admission changes.

See `artifacts/trainer2/TRAINING_UI_HANDOFF.md` for source-bound browser/PostgreSQL results, screenshots, gates, synthetic setup and exact demo coordinates.
