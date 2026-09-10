# Trainer App 2.0 — Product Blueprint

Revision: September 9, 2026 — second adversarial-review revision

Status: FINAL PRODUCT AND BEHAVIORAL BLUEPRINT — architecture derivation authorized. This revision integrates the independent adversarial reviews. Behavioral and progression defaults are product decisions, not claims of clinical guidance or existing implementation.

This document defines observable outcomes and domain boundaries. It does not mandate a database schema or event architecture. Foundation requirements apply to the first usable release; explicitly deferred capabilities inherit the same evidence and identity rules.

## 1. Product definition

Trainer App is a personal strength and hypertrophy training system that helps the user **design, execute, and improve training plans over time**.

Its core promise:

> Trainer App handles complexity so the user can focus on training, while keeping important decisions visible, understandable, and under the user’s control.

The product should make training easier to manage, preserve trustworthy evidence, support progression, and help the user make informed decisions. The user remains sovereign.

The product is not primarily a workout logger, spreadsheet, autonomous coach, black-box generator, volume calculator, readiness tracker, habit app, or analytics dashboard. It does not depend on an external LLM API. Its intelligence comes from explicit product logic, structured evidence, and explainable recommendations.

A feature belongs in the primary experience when it helps the user make a better training decision or reduces effort in executing a decision already made.

## 2. Experience and product hierarchy

The visible hierarchy remains shallow:

**Training direction and goals → Plans → Workouts → Training history.**

Analytics and recommendations support these layers. Additional internal distinctions should not create unnecessary navigation or terminology.

Before training, the user should know what is next, why it matters, the prescribed targets, relevant previous performance, and any decision worth attention.

During training, logging should be fast, resilient, and flexible. Substitutions, omitted work, added exercises, and changes in order are normal.

After training, most sessions should end quietly. Meaningful milestones may earn attention; analysis and reflection should generally remain optional.

> Clarity before. Invisibility during. Intelligence afterward.

## 3. Training direction, goals, and constraints

Training direction expresses what the user is working toward across one or more plans. It can evolve without rewriting the objectives associated with previous plans.

Distinguish three concepts:

| Concept | Purpose | Examples |
| --- | --- | --- |
| Milestone | An outcome with explicit achievement criteria | Squat 200 lb for one recorded working-set rep; first unassisted pull-up |
| Training priority | An emphasis that shapes programming | Build back strength; emphasize quads; maintain chest |
| Constraint | A practical limit or explicit restriction | Four sessions per week; approximately 60 minutes; available equipment; excluded movement |

Milestones specify exercise or variation, units, load convention, required reps, and any relevant conditions. A performed achievement and an estimated achievement are different. An estimated maximum must not silently satisfy a milestone requiring a performed lift.

Goals can span multiple plans. Completing a plan does not require achieving every goal, and achieving a goal does not automatically end a plan.

When objectives compete, the app should surface the tradeoff. It should not imply that all priorities can be maximized simultaneously.

## 4. Core domain distinctions

The product preserves intent, execution, and evidence separately.

| Concept | Meaning | Ownership rule |
| --- | --- | --- |
| Plan | Approved training intent over a defined block | Owns its prescribed structure and future planned work |
| Workout structure | A reusable arrangement of exercises and prescriptions | Copying creates independently owned contents |
| Planned occurrence | One specific session within a plan | Exists before execution and can be scheduled, moved, skipped, or replaced |
| Workout execution | One concrete training session | Owns the starting prescription, session changes, and recorded performance |
| Training history | The user’s record of what occurred | Draws from executions and explicit corrections; never from assumed performance |

These are behavioral distinctions, not a mandated database schema.

A planned occurrence retains identity when renamed, rescheduled, reordered, or edited before starting. Repeating work creates new occurrences. Names, dates, and sequence positions are not identities.

Occurrence continuity is determined by the user's edit operation, not by content similarity. Editing an existing occurrence preserves its identity even when its prescription changes substantially. Removing an occurrence and introducing another creates a new identity. The system never infers continuity by comparing names, dates, positions, exercises, or prescription contents.

Each prescribed exercise position also has distinct identity. Two appearances of the same exercise can have different purposes and prescriptions. Reordering them must not exchange their history or meaning.

A planned occurrence can have at most one ordinary linked execution. An unfinished execution resumes as the same session. Training the session again after it has been finished creates a new occurrence or standalone execution, with an optional repeat relationship. It does not replace the first performance.

Standalone executions are valid without a plan occurrence.

### Execution ownership and programmed relationships

The foundation supports one in-progress execution per user across planned and standalone training. Creating a new execution requires connectivity and an authoritative check of this rule. Previewing or caching work does not reserve or start it. An empty accidental execution can be discarded; an execution with recorded work must be finished, including as partial, before another starts.

Different devices may resume the same execution. They do not create another execution for the same occurrence. Concurrent changes follow Section 17.

A programmed exercise position has an explicit relationship to its intended counterparts across future occurrences. This relationship is authored or deliberately established by an edit; it is never inferred from name, index, or numerical similarity. A counterpart relationship controls edit scope, not automatic performance comparability.

Within a copied plan, copied positions receive new identities and independently owned counterpart relationships. Source references remain provenance only. Repeating a stage creates new occurrence and position identities; its preview explicitly establishes which new positions continue an existing within-plan counterpart relationship. A split position receives distinct identities and an explicit selection of future counterparts. Combining positions never silently merges their performance histories. These advanced operations may be deferred, but cannot reuse identities to avoid modeling the distinction.

## 5. Plan definition

A plan is a complete, human-readable expression of training intent. It contains:

- A block of training weeks or stages with a finite intended endpoint.
- Specific workout occurrences, their order, and intended frequency.
- Optional planned dates.
- Exercises, exercise order, sets, rep or other supported targets, effort targets, and relevant rest guidance.
- Explicit progression methods and programmed changes across the block.
- Relevant goals, priorities, constraints, and comparison with the source plan when copied.

The user should be able to inspect the whole plan without mentally executing hidden generation rules.

Distinguish fixed intent, flexible targets, and runtime guidance. A programmed rep range or RIR target is intent. Today’s suggested load is guidance. A recorded load is performance evidence.

The plan need not predict exact future loads. Its structure and progression intent must nevertheless be visible before activation.

## 6. Plan building and reuse

Three product entry paths converge into the same editor:

1. Start from scratch.
2. Copy an existing or previous plan.
3. Start from a recommended structure.

Recommended structures use supported templates, structured goals, constraints, and available history. They do not require generative AI and must not imply comprehensive personalization when evidence is limited.

Workout templates, plan templates, and previous-plan copies are starting points. Once copied, the destination owns its contents. Source edits never silently propagate.

Copying transfers intent, not completion status, execution identity, logged sets, accepted runtime loads, or transient illness and travel context. The new draft is checked against current explicit constraints.

Personal patterns may later improve defaults, but inferred patterns remain visible and reversible.

## 7. Plan editor and activation review

The editor should make daily structure, programmed volume, progression, estimated duration, goal alignment, and differences from a prior plan understandable.

Duration is an estimate with stated assumptions about rest and setup. Workload summaries describe their counting conventions and do not pretend to be exact measures of stimulus or recoverability.

Review distinguishes:

| Category | Behavior |
| --- | --- |
| Hard validity problem | Blocks activation when the app cannot represent or execute the plan correctly |
| Strong programming concern | Clearly explains the concern; user may proceed |
| Programming tradeoff | Informs the decision without blocking |
| Conflict with an explicit personal exclusion | Requires a deliberate scoped exception or an edit |

Hard validity examples include missing required prescriptions, invalid measurement combinations, and no executable training in the entire plan. Rest days and optional preparation can exist without being empty executable workouts.

Programming concerns include abrupt workload changes, aggressive progression, redundancy, or unrealistic scheduling. There is no universal plan quality score.

The review must match the draft being activated. A change after review cannot result in a different plan being started without showing the updated state.

The primary action is **Start Plan**. The initial product supports one Active or Paused plan at a time. Starting another requires explicitly concluding the current plan; multiple drafts are allowed.

For this blueprint, **current plan** means the single plan in Active or Paused state. Drafts are never current plans.

## 8. Plan lifecycle

User-facing states remain:

| State | Meaning |
| --- | --- |
| Draft | Editable intent that has not begun |
| Active | The plan is available for planned execution |
| Paused | Planned execution and schedule expectations are suspended |
| Completed | The plan reached its currently approved endpoint with all retained occurrences resolved |
| Concluded Early | The user intentionally stopped before resolving the retained plan |

Pause is nonterminal. Completed and Concluded Early plans remain available for history, review, and copying.

A retained occurrence is resolved when its session is finished or it is explicitly skipped. Finishing partial work resolves that occurrence; it does not claim all prescribed work was done.

When the final retained occurrence is resolved, the plan completes without a separate administrative gate. If an edit leaves no unresolved occurrences, its preview explains the resulting closure outcome under the endpoint rules below. A plan can complete with skipped sessions; its summary must say what was actually performed.

**End Plan** intentionally concludes a plan with unresolved work. Remaining work is recorded as not pursued because the plan ended, not falsely classified as individually skipped.

Ordinary evidence corrections do not reactivate a closed plan. A dedicated resolution correction can repair an accidental finish or skip under Section 18. Genuine additional training creates a new occurrence or standalone workout. Correcting an accidental skip on an active plan can return that occurrence to pending if no linked execution exists.

### Endpoint changes and an open execution at closure

Removing the final unresolved pending work without retaining any unfinished execution or future occurrence concludes the plan early. The edit preview says so. Shortening a plan while retaining work can establish a revised endpoint; later resolving that work completes the revised plan. Its review states the original and revised endpoints and the work removed. Completed never means adherence to the original plan by implication.

Explicitly skipping all remaining occurrences can still produce Completed, with truthful skipped-versus-performed reporting. Skipping means the user deliberately resolved identified sessions; removing intent and ending a plan are separate actions with separate recorded meanings.

End Plan is permitted while an execution is open. It closes the plan as Concluded Early, marks unstarted pending work as not pursued because the plan ended, and preserves the open execution and its source link. The started occurrence remains distinguishable as unfinished at closure. The user can resume and finish that execution without reopening the plan. Its later performance appears in history and the updated review; the closure outcome remains Concluded Early.

A new plan may be activated after closure, but its first execution cannot start while the prior execution remains open. Home prioritizes Resume and identifies that the open workout belongs to the concluded plan. Ending a plan never acts as an implicit finish or discards recorded sets.

## 9. Preserving intent when execution begins

Starting a workout captures the prescription and relevant guidance presented at that moment. Subsequent plan edits do not silently change an open execution.

An execution preserves:

- Its starting prescribed work and source occurrence, when present.
- Explicit changes made for today.
- Recorded performance and explicitly omitted work.
- Recommendations actually presented or accepted when relevant to understanding the session.

Today’s adjusted target may differ from the starting prescription. Both remain distinguishable in history. A two-of-four session cannot silently become two-of-three because the future plan was edited.

Opening a preview does not start an execution. Starting from stale plan state refreshes the preview or explains the relevant change before creating the session. An existing open session remains resumable under its own captured prescription.

Starting requires an online authoritative check of the occurrence, plan state, current restrictions, and absence of another open execution. Start and changes that resolve or remove the occurrence must have one unambiguous accepted order. If start wins, the occurrence is started and is excluded from pending-work edits and skips. If skip or removal wins, start refreshes instead of creating an execution from stale intent.

The captured prescription must be durably available on the device before offline continuation is presented as ready. An unsuccessful or uncertain start is retried with the same action identity so a network timeout cannot create another session.

## 10. Active plan editing

Active plans represent stable, editable intent. Changes have explicit scope:

| Scope | Effect |
| --- | --- |
| Today only | Changes the open execution; preserves its starting prescription |
| Future occurrences | Changes selected unstarted pending occurrences; excludes open and finished sessions |
| Today and future occurrences | Explicitly combines both scopes and shows both effects |
| Restructure remaining plan | Changes the organization and prescriptions of remaining pending work through a reviewed edit |

For exercise replacements, the default future scope follows the selected programmed exercise position across its related future appearances. It does not replace every matching exercise name. The preview names the affected sessions and supports a broader or narrower explicit selection.

Changes to order, dates, and prescriptions preserve occurrence identity when the intended session continues. Repeated or newly introduced sessions receive new identities. Pending sessions removed by restructuring are recorded as removed from intent, not as performed or skipped.

Restructuring preserves open and finished executions. Its preview shows additions, removals, prescription changes, progression stages, and expected endpoint changes. There is no silent partial application.

Future edits recheck that the entire selected scope is still eligible when applied. If a selected occurrence has started or changed incompatibly since preview, the edit is refreshed; it is not silently narrowed. A combined today-and-future edit is applied as one accepted operation or leaves both scopes unchanged. Offline changes to today are supported; combined and future-plan edits require connectivity in the foundation.

## 11. Sequencing, training weeks, and dates

The plan has an ordered set of occurrences grouped into programmed training weeks or stages. Calendar dates help organize life; they do not determine identity or automatically expire work.

The default next workout is the earliest pending occurrence in the approved sequence. If a workout is already open, the primary action is Resume.

The user can intentionally start a later pending occurrence. Earlier work remains pending unless explicitly skipped, moved, or removed through a plan edit. After the later session, the default again selects the earliest pending occurrence. The interface makes this consequence clear.

An occurrence uses the progression stage assigned to it. Elapsed days alone do not advance its RIR target or turn it into a deload. Long gaps can affect runtime guidance or produce a recommendation to revise the plan.

Skipping the last session in one training week resolves it and allows the next pending week’s session to become next without identity repair or regeneration.

Analytics distinguishes programmed-week volume from calendar-week or rolling-time exposure. A four-session training week completed in twelve days is not described as four sessions per seven days.

## 12. Disruption actions

Travel, illness, equipment issues, fatigue, and limited time are expected. The system provides direct actions without requiring a disruption questionnaire.

| Action | Defined behavior |
| --- | --- |
| Resume where I left off | Continues the earliest pending occurrence with its assigned stage |
| Shift dates | Changes scheduling without changing identity or prescriptions |
| Skip a session | Explicitly resolves that occurrence without performance evidence |
| Skip ahead | Previews and explicitly skips the selected earlier pending occurrences |
| Repeat a week or stage | Creates new occurrences copied from a specified prescription stage; preserves original outcomes |
| Ease back in | Proposes concrete changes for today or selected future occurrences; requires acceptance |
| Shorten or restructure | Applies a reviewed change to remaining intent |
| Pause | Suspends the plan without resolving pending occurrences |

Repeating a stage inserts the new occurrences at a visible position. Existing pending work remains unless the user explicitly chooses which occurrences to replace or skip. Repetition does not erase prior skipped or performed work and does not automatically shift progression targets in later stages.

Disruption guidance is dismissible. A user who wants to train can reach a planned or standalone session without first redesigning the entire block.

## 13. Pause and re-entry

Pausing preserves plan position and pending work. It does not create skips or count days as missed scheduled sessions. Actual time away still matters to recency and performance interpretation.

If a session is open, pausing the plan preserves it. The user may finish or resume that session without silently unpausing the plan. New planned sessions require resuming the plan; standalone training remains available.

Resuming does not silently rewrite dates or prescriptions. The app offers to continue, shift dates, or review a return adjustment. Scheduling changes are explicit.

Programmed reduced training and deloads retain their context. Lower output during such periods is not automatically classified as regression.

## 14. Standalone workouts

The user can train without an active plan, between plans, or while a plan is paused.

A standalone workout can start empty, from a template, or as a copy of a prior session’s structure. It records real work and can inform future guidance under the same comparability rules as planned work.

It does not automatically satisfy a plan occurrence or resume a paused plan. A session intended to count toward a plan should start from that occurrence. The initial release does not require retrospective attachment of standalone sessions to plans.

Finishing a plan must never leave the user unable to log training while deciding what to do next.

## 15. Workout execution and logging

The execution surface supports fast entry, previous-performance context, optional load suggestions, substitutions, exercise additions and removals, changed order, and early finish.

Previous-load prefill, set duplication, and sensible defaults reduce typing. A suggested value is visibly distinguishable from a recorded result. A deliberate logging action confirms performance; merely opening a session or finishing it never records prefilled sets automatically.

Accepting a suggested target may adjust the execution's intended target, but it never records performance. Only an explicit logging action creates performed evidence.

Each performed set is independently recorded. Zero is a valid value where the measurement convention permits it and is distinct from missing data. Actual execution order is preserved without rewriting planned order.

Added exercises have their own session identity and do not acquire invented plan lineage. A substitution retains its relationship to the replaced position while separately identifying the exercise actually performed.

Unsupported exercise measurements may be retained as notes, but must not be forced into misleading numeric records or progression calculations.

### Substitution after performed work

A performed set retains its own actual exercise, measurement convention, and relationship to the prescribed position. If the user performs two squat sets and substitutes leg press for the remaining work, the squat sets remain squat performance. The substitution explicitly targets the remaining work and creates separately identifiable leg-press work under the source-position relationship.

Removing or replacing remaining work never removes already recorded performance. Relabeling an erroneous performed set is a deliberate evidence correction. If a replacement changes the set count, the adjusted prescription records that change; the original denominator remains available. Extra performed sets are identified as additional work, not silently matched to another position with the same exercise name.

## 16. Finishing a workout

Session status, completeness, and context are separate:

- Status says whether an execution is in progress or finished.
- Completeness describes recorded work relative to the starting and deliberately adjusted prescriptions.
- Context may explain that the session was shortened, stopped early, affected by equipment, or otherwise modified.

The user can finish without logging every planned set. Reasons are optional.

Finishing resolves the linked occurrence even when some work is incomplete. The summary can say “Finished — 8 of 12 prescribed sets logged” without implying failure or full completion.

Unlogged work remains unknown unless explicitly marked omitted. The finish action may offer a single optional action to mark remaining work as not performed, but must not require set-by-set cleanup.

Skipping is for an occurrence without performed work. A session with recorded work is finished as a partial session; the app must not discard those records to call it skipped. An empty accidental session may be discarded without resolving its occurrence, or explicitly skipped.

## 17. Durability and recovery

The first usable release must support durable mobile logging through temporary connectivity loss and application interruption.

An entered result is acknowledged only after a successful durable save on the device or server. The interface distinguishes locally saved, pending synchronization, and synchronized state without interrupting each set.

An execution successfully started online and durably available on the device can be logged, adjusted for today, and finished during temporary connectivity loss. All new execution starts, activation, resolution corrections, and future-plan edits require connectivity in the foundation. Offline starting from a cached preview is deferred; a future release must define reservation and conflicting-start outcomes before enabling it.

Reloading or restarting restores acknowledged session entries on the same device. Pending work is not silently discarded during sign-out, updates, or synchronization failures. Uninstalling the app or clearing device storage can destroy unsynchronized local records; the product must not claim otherwise.

Repeated saves and finish actions do not duplicate sets, sessions, plan advancement, or celebrations. Concurrent edits do not silently overwrite one another. Conflicts preserve recoverable input and identify the affected work in plain language.

Offline completion may be shown provisionally. Synchronization resolves plan state without changing the recorded session’s source identity. Device failure limitations and synchronization status must be truthful.

### Synchronization and finish boundaries

Each logging, edit, and finish action has stable identity across retries. Different actions never become duplicates merely because their numeric values match. Repeated delivery of the same action has one effect.

Finish references the durable session changes included in that finish. Synchronization may receive actions out of order, but cannot finalize the execution or resolve its occurrence until all referenced changes have arrived and relevant conflicts are resolved. Locally finished is visibly provisional until this succeeds. Local pending entries remain exportable or otherwise recoverable during a prolonged failure.

Independent additions to the same open execution can be retained together when their identities and relationships do not conflict. Concurrent edits to the same set, removal against an edit, and finish against unseen session changes require explicit reconciliation. Arrival order never silently chooses the user's intent.

If another device finalized the execution before receiving independently recorded work, the late work is preserved as pending reconciliation. The user confirms whether it belongs to that session as corrected evidence or was a distinct workout. The app never silently discards it, silently appends it to a finalized session, or automatically creates a second workout. If confirmed as a distinct session, recovery records a separate historical execution without changing the original source relationship; it does not create a second open execution or falsely satisfy another occurrence.

A locally pending finish keeps the authoritative execution open until synchronization completes; another device cannot start a new workout by assuming it finished. If the plan was ended elsewhere, valid queued session entries still synchronize to their original execution, and finishing does not reopen the plan.

An explicit correction made after synchronization must not later be overwritten by an older queued update. Conflicting source versions are surfaced with recoverable values. Account changes must keep unsynchronized records isolated to their originating account.

## 18. Historical corrections

History is protected from silent rewriting, but explicit correction is supported.

Users can correct loads, reps, units, exercise assignment, context, and mistaken entries after finishing. Corrections retain enough provenance to distinguish the original record from the corrected record. A correction is not a new workout.

Ordinary removal of erroneous evidence excludes it from current calculations while retaining its correction context. A separate explicit data-deletion operation may permanently remove data; it must not be confused with correcting an entry.

Corrections update affected analytics, PR eligibility, milestone evidence, and future guidance. They do not rewrite recommendations shown in past sessions or silently reopen completed plans.

If a correction invalidates a milestone, its current evidence-backed status changes. The app does not repeatedly celebrate an achievement as recalculations run. Manually acknowledged milestones remain distinguishable from automatically evidenced ones.

### Correcting an accidental finish or skip

Undo Finish is a dedicated online action, separate from editing loads or reps. It preserves execution identity, recorded sets, prescription history, and the original finish and correction provenance. It requires no other open execution. The preview explains any occurrence or plan-state effect.

For an active or paused source plan, Undo Finish makes the same execution in progress and its occurrence unresolved. A paused plan stays paused. For a plan automatically completed by that finish, Undo Finish restores its prior Active or Paused state only when no other current plan exists. If another plan is Active or Paused, the user must explicitly conclude that plan before restoring the earlier plan. This decision is never bundled into an ordinary evidence edit.

For a plan explicitly Concluded Early, Undo Finish can reopen the execution while the plan remains Concluded Early. Its source relationship is retained. A standalone execution can likewise reopen when no other execution is open.

If the user only needs to enter forgotten evidence for work already performed, historical correction is sufficient and does not reopen anything. Continued real-time training in a mistakenly finished session uses Undo Finish. Training again on a genuinely separate occasion is a new workout.

Undo Skip is allowed for an occurrence with no execution. On an active or paused plan it restores pending status. On a plan completed by that skip, it can restore the prior nonterminal state only when there is no other current plan; otherwise the conflict is explained before any change. An explicitly concluded plan is not restarted by Undo Skip; historical resolution errors can be annotated and corrected without recreating live obligations.

Correcting closure does not erase earlier celebration delivery. Re-finishing the repaired endpoint does not repeat the same plan-completion celebration. The current review and milestone evidence remain correctable.

## 19. Exercise catalog and measurement semantics

The catalog supports search, muscle and movement browsing, recents, favorites, substitutions, and easy custom exercise creation.

Useful structure includes equipment, movement pattern, muscles involved, unilateral or bilateral execution, loading style, stability demands, and progression type.

Custom exercises require only what is necessary to log them correctly. Missing descriptive attributes reduce recommendation coverage rather than blocking ordinary logging.

Every quantitative performance record preserves relevant measurement meaning: units, per-hand or combined load, external load or assistance, rep basis, and equipment context where needed. Conventions are visible where mistakes are likely.

Renaming or updating catalog metadata does not reinterpret historical numbers. Duplicate detection suggests possible matches but never silently merges histories. Any supported merge must preserve original measurement meaning and provenance.

## 20. Comparability and substitution

Exercise suitability and performance comparability are different questions.

A replacement may serve the same training purpose without supporting direct load transfer. Different machines, assistance mechanisms, variations, or loading conventions can require separate progression histories.

The app ranks alternatives using intent, equipment, explicit restrictions, history, and preferences. It explains useful reasons briefly and lets the user choose scope.

Direct progression requires sufficiently comparable records. Units may be normalized only when the underlying measurement meaning is equivalent. Similar exercise names alone are insufficient.

When comparability is uncertain, show relevant history with its context and offer calibration or user-selected starting load. Do not invent precision or treat uncertainty as zero performance.

## 21. Progression

Plan-level progression defines the intended evolution of sets, rep ranges, effort, emphasis, and deloads. Session-level progression answers what the user might attempt today.

Supported methods may include load progression, double progression, assistance reduction, and rep progression. Variation progression can be added when its comparisons and transitions are explicitly modeled.

A runtime recommendation can use comparable prior performance, recency, current targets, recorded effort, progression method, and explicit disruption context. Missing effort data limits effort-based conclusions; it is not silently filled in as fact.

Increments respect the selected equipment and loading convention. A larger recorded number is not universally better: reduced assistance, for example, progresses in the opposite numeric direction.

Recommendations state the actionable target and a concise reason. If evidence is inadequate, hold, calibrate, or abstain. Applying a progression method to an unsupported exercise must not produce arbitrary guidance.

### Foundation progression policy

The initial automated methods are double progression and rep progression, including double progression expressed as decreasing assistance. Other methods remain manually authorable until their policies are specified. These defaults are product rules, not claims of a universally optimal training prescription.

A progression group is an explicitly defined set of working-set targets with a shared exercise, measurement meaning, prescription role, and progression method. Top sets and back-off sets are separate groups unless deliberately modeled otherwise. A future-edit counterpart relationship does not itself merge progression groups.

A qualifying exposure is a finished, synchronized session group with all required sets explicitly recorded; comparable exercise and equipment meaning; matching set count and rep-range policy; and no unresolved correction or synchronization conflict. Preparation, optional extras, unknown remaining work, and omitted required sets do not count toward a successful exposure. Comparable standalone evidence can qualify only when the same target structure and role were explicitly captured; raw sets with no known target remain contextual history.

| Policy element | Foundation behavior |
| --- | --- |
| Evidence window | Examine the latest two qualifying exposures performed within the preceding 28 days; show their dates. The window is an explicit versioned product default. |
| Double progression trigger | Both exposures use the same comparable load and every required set reaches the upper rep target. If an RIR target was prescribed, every set must have recorded RIR meeting or exceeding its lower bound. Missing required effort evidence prevents an increase. |
| Result after trigger | Suggest one configured equipment step harder and a return to the lower rep target. For external load this normally increases load; for assistance it decreases assistance. The user explicitly accepts or overrides. |
| Rep progression | At the same load or difficulty, use the latest qualifying exposure and suggest one additional rep on each set below its upper bound, capped at that bound, only when all sets met their lower targets and any prescribed RIR minimum. At the upper bound, hold; this method does not change load automatically. |
| Increments | Use explicitly available equipment values in the recorded convention. A per-hand increment is not doubled in a per-hand record. Select the adjacent supported harder value; never fabricate an intermediate value. At zero assistance, a new unassisted progression group requires deliberate setup. |
| Insufficient evidence | Show comparable context and hold a defensible existing target, or request user-selected calibration. Never interpret missing evidence as zero performance. |
| Failed trigger | Do not increase automatically. Explain which requirement was unmet without declaring regression. |
| No representable next step | Hold and explain the equipment limit; offer a deliberate change of method or targets. |

A current planned deload, explicit illness or pain context, or a return-to-training adjustment suppresses automatic escalation. Today-only reductions, altered set structures, and substituted work remain actual exposure and contextual evidence but do not establish a normal progression trigger. A more recent disrupted or nonqualifying exposure prevents silently using two older successes to increase demands; hold or calibrate and explain the intervening context.

Changes to rep ranges, set count, equipment, or prescription role require a fresh eligibility check. The foundation does not automatically transfer progression readiness across such changes. It can show old performance as context.

Policy identity, inputs used, and explanation are retained for presented consequential guidance. Policy updates affect future computation; accepted targets in open sessions remain fixed unless the user changes them. Corrected evidence invalidates affected future suggestions without rewriting prior advice.

## 22. Recommendation authority

The system uses the following authority boundary:

| Action | Authority |
| --- | --- |
| Compute trends, show history, estimate duration | Automatic |
| Suggest or prefill a candidate target | Automatic, clearly unrecorded |
| Log performed work | Explicit user logging action |
| Change today’s prescribed structure | Explicit user action |
| Change future plan intent, dates, or constraints | Explicit user action after visible scope |
| Resolve an occurrence or conclude a plan | Explicit action or the defined consequence of finishing the last occurrence |
| Infer a preference | May form a hypothesis; cannot silently create an exclusion |

Recommendations carry the evidence and plan context needed to determine whether they are still applicable. Changed inputs can invalidate a suggestion. A stale consequential suggestion is refreshed before application.

The user can accept, override, or dismiss. Dismissed advice is not repeatedly shown for unchanged evidence. It may return after a material change, with a reason.

An accepted target in an open session does not keep moving as background analytics update. New material context can prompt a reconsideration, but changes remain explicit.

## 23. Intelligence and evidence quality

The intelligence stack separates deterministic product rules, analytics, and recommendation policy.

For each recommendation category, implementation must define the required inputs, comparability conditions, insufficient-evidence behavior, and explanation. There is no requirement to produce advice after every workout.

Observations, hypotheses, and programming judgments remain distinct. Repeated substitutions can indicate equipment friction; they do not prove dislike. Omitted accessories can indicate time pressure; they do not prove poor tolerance. Positive performance alone does not establish that more volume is appropriate.

When a missing cause materially changes the decision, the app can ask one optional contextual question or abstain. It must not manufacture a personalized conclusion from thin evidence.

Without an LLM integration, free-text notes are available for human reference and retrieval. They do not automatically become interpreted constraints or recommendation inputs.

## 24. Personal profile and constraint precedence

The profile holds durable preferences, current goals, temporary context, explicit restrictions, and observed tendencies as distinguishable concepts.

Actionable constraints specify their scope: profile-wide, plan-specific, date-bounded, or session-only. Temporary restrictions can have an end date or remain active until explicitly cleared. The user can inspect and change them.

Explicit instructions outrank inferred preferences. Narrower deliberate exceptions may override broader instructions only within the selected scope. A durable excluded movement remains excluded elsewhere.

When explicit instructions conflict, the app surfaces the conflict instead of inventing a priority. Copying a plan and applying recommendations must respect current restrictions.

A temporary illness or travel context does not automatically become a permanent limitation. Repeated observations may support a suggestion to update the profile, but not a silent update.

### Enforcement boundaries

Restrictions do not silently rewrite an activated plan or captured execution. The app checks applicable explicit restrictions during activation, starting planned work, applying affected future edits, and accepting substitutions or recommendations. A conflict requires an edit or deliberate scoped exception before that action proceeds. Starting a standalone workout does not bypass the restriction check when adding affected exercises.

A newly applicable restriction is surfaced in an already-open execution when known, including after synchronization. It does not delete performed work or prevent honest logging of what actually occurred. Continuing to prescribe the affected movement requires a scoped exception or a change to the remaining work. Known cached restrictions apply offline; newly created remote restrictions cannot be claimed as enforced before the device receives them.

An exception identifies the restriction, affected work, scope, and validity period. Exceptions do not transfer when copying a plan. A changed restriction requires a new applicability check; a broader scope cannot be inferred from an earlier narrow exception. Where custom-exercise metadata is insufficient to evaluate an exclusion, the app states that uncertainty and asks for deliberate confirmation when proposing or prescribing that exercise; it does not certify compliance from missing metadata.

## 25. Recovery, pain, and limitations

Recovery inputs are optional and relevant when they change training decisions. The product does not require daily sleep, stress, soreness, or readiness scores.

It distinguishes preference, poor fit, temporary discomfort, and persistent limitation. “Do not program this movement” creates an explicit durable restriction. One uncomfortable session does not.

The product does not diagnose conditions, declare medical clearance, or infer that a substitute is safe for an injury. Explicit illness or pain context should not result in automatic escalation of training demands.

Structured context can explain changed performance, pauses, or reduced training. Notes preserve nuance without acting as hidden commands.

## 26. Exercise order, preparation, and optional work

Ordering suggestions generally place priority and demanding work earlier, consider compatible supersets, and reduce equipment friction. The user can change actual execution order without changing prescribed order.

The product distinguishes general preparation, ramp-up sets, working sets, and optional finishers. Reusable prep is lightweight; logging it is optional.

Ramp-ups may be suggested from a selected working load. Preparation and ramp-up sets are excluded from ordinary working-set volume, working-set PRs, and progression evidence by default. Classification is correctable.

Optional finishers are visibly optional and do not prevent session or plan completion when omitted. If performed, their work is retained under the appropriate measurement and analytic category.

The app must not infer superset execution or elapsed rest solely from planned exercise order.

## 27. Analytics and learning

Analytics operates quietly and primarily informs building, review, disruption decisions, replacement, and progression. A dashboard remains secondary.

Useful dimensions include performance, recorded effort, exposure, frequency, substitutions, duration, goal evidence, and plan-to-plan changes.

Every comparison respects its denominator and context. Distinguish:

- Original planned work, revised planned work, and performed work.
- Explicitly omitted work and unknown logging completeness.
- Programmed-week totals and actual calendar exposure.
- Planned deloads, pauses, and ordinary training.
- Comparable exercise performance and related but noncomparable history.

Editing remaining work must not erase the fact that the plan was revised. A revised-plan completion measure cannot be presented as adherence to the original plan.

Volume summaries state whether sets are direct, indirect, or weighted estimates. Muscle involvement is not exact stimulus measurement. Volume landmarks may provide optional context, but they are not universal thresholds that automatically require more work or block a plan.

Duration estimates and recorded session duration remain distinguishable, including long interruptions when known. Behavior-based conclusions should reflect uncertainty about causes.

### Performed time and calendar attribution

Preserve performed time separately from entry, synchronization, and correction time. A session records its start and finish when known, its training date, and the timezone used for that date. Calendar summaries default to that preserved training date; a midnight-crossing session is grouped by its start date unless explicitly corrected. Changing the user's current timezone does not silently move historical workouts between days.

Where trustworthy timestamps exist, recency uses actual performed instants rather than upload order. Date-only imported or retrospectively entered records preserve their limited precision; no exact instant or duration is invented. Uncertain timestamps limit recency-based recommendations.

Historical correction includes session date, timezone, and performed-time errors. Recalculation moves the affected exposure into the correct period without creating another session. Future dates and implausible device-clock values are surfaced for confirmation before driving automatic progression.

Duration distinguishes elapsed session time from known interruptions and any measured active time. The app does not present elapsed time as active training time without supporting evidence.

## 28. Notes and qualitative context

Optional notes may attach to a set, exercise occurrence, workout, plan, or milestone. Notes preserve discomfort, grip limitations, equipment differences, travel details, and movement quality.

Structured data drives product state. A note saying “skip next week” does not skip sessions; the corresponding structured action does. The interface can make that action easy to find without pretending to understand every note.

## 29. Home screen and navigation

Home answers what matters now with this priority:

| Context | Primary action |
| --- | --- |
| Open workout | Resume workout |
| Active plan | Start next workout |
| Paused plan | Resume plan, with standalone training readily available |
| Newly completed plan | Optional celebration and review |
| No current plan | Start a workout or build a plan |
| Meaningful disruption | Contextual adaptation option alongside a direct training path |

Relevant goals and position are secondary. Analytics is tertiary.

Disruption advice does not replace access to training with a mandatory decision flow. Celebration, review, and planning can be dismissed and revisited. The app remembers where the user left off without reopening dismissed screens repeatedly.

## 30. Completion, milestones, and motivation

Plan closure and milestone achievement are distinct events. Both can be meaningful, but their presentation must match the evidence.

The intended experience is **Celebrate → Review → Decide → Build**, with each step optional and resumable.

Celebration is brief, tasteful, slightly whimsical, and skippable, with reduced-motion behavior. It recognizes actual effort and evidenced accomplishments. A block with no recorded training can close cleanly without claiming training achievements.

Review summarizes what went well, what changed, observed patterns, meaningful progress, and useful evidence for the next decision. Missing evidence remains visible as uncertainty.

The user may continue similarly, modify structure, start fresh, take time off, revisit goals, or simply train without building a new plan yet.

Most individual workouts end quietly. PRs and user-selected milestones earn selective attention. Avoid mandatory reflections, guilt language, punitive adherence scores, meaningless badges, and streak pressure.

## 31. Product voice

The voice is concise, natural, evidence-aware, and comfortable with uncertainty. It should express exactly what the evidence supports.

Examples:

- “You reached the top of the range in both comparable sessions. Try 5 lb more if today feels normal.”
- “You swapped this movement in three recent sessions. Was that equipment availability or preference?”
- “You logged fewer sets during the planned deload. That was part of the plan.”
- “This machine has different loading. Your old numbers are here for context; choose a starting load for this setup.”

The app should not imply causal certainty, medical judgment, or personalized knowledge it does not possess. Strong evidence, weak evidence, and general programming advice remain distinguishable even when the wording is conversational.

## 32. First usable release and delivery order

The long-term vision remains intact. Implementation should first deliver a complete, trustworthy training loop.

### Foundation release

Include:

- Structured manual goals, priorities, restrictions, and a small exercise catalog with custom entries.
- Scratch and prior-plan-copy building, a complete visual prescription, and activation review.
- Stable planned occurrences, one current plan, sequencing, explicit skips, pause, resume, and clean closure.
- Today-only changes and targeted future edits with clear scope and open-session isolation.
- Standalone workouts, resilient logging, partial finish, and explicit historical corrections.
- Correct load and assistance semantics, relevant exercise history, and a small set of supported progression methods that can abstain.
- A lightweight completion celebration and factual review.

The foundation supports straightforward remaining-work edits. Guided multiweek restructuring, repeat-week assistance, and return-to-training proposals may follow, but must use the same identity and history contracts.

### Subsequent capabilities

Add recommended plan structures, ranked substitutions, richer disruption workflows, additional progression methods, and broader goal tracking after the core evidence is reliable.

Add learned preference suggestions, tolerance hypotheses, advanced plan comparisons, and a dedicated dashboard only with explicit evidence policies and adequate data.

An unavailable intelligence feature must not prevent manual authoring or honest logging. Deferral does not justify a foundational model that cannot support the specified behavior later.

### Foundation scope boundaries

The foundation includes online start with offline continuation, one open execution, defined finish synchronization, deliberate resolution correction, restriction enforcement, explicit position relationships, and performed-time semantics. These are part of the trustworthy loop, not optional later hardening.

Double progression and rep progression use the policies in Section 21. Richer methods, offline starts, guided restructuring, and automatic progression transfer between changed prescriptions are deferred. Manual prescription, comparable history, and abstention remain usable without those features.

## 33. Existing prototype and transition

Evaluate current components as retain, simplify, extract, rewrite, or retire according to this product contract. Sunk cost does not determine the result.

Preserve valuable training records, dates, original load values and units, measurement conventions where known, exercise context, notes, available prescriptions, plan relationships, and recorded corrections.

Do not invent missing historical intent, identity, effort, measurement conventions, or recommendation evidence. Uncertain imported records remain labeled and may be excluded from automatic progression while remaining readable.

The initial transition carries an in-flight legacy plan as reference and historical data rather than automatically reconstructing uncertain live obligations. Continuing it in 2.0 requires a reviewed draft of the remaining intended work. That draft does not duplicate prior performance or falsely claim the legacy plan’s lifecycle continued unchanged.

Before cutover, verify record coverage, representative exercise histories, numerical values and units, timestamps, and known omissions. Preserve a recoverable export and provide a concise discrepancy report. Historical preservation does not require retaining obsolete runtime paths.

### Cutover ownership and late records

Cutover has a recorded final source snapshot and write boundary. Before that boundary, reconcile or export outstanding offline records from known legacy devices. After the boundary, 2.0 owns new logging and the legacy application is read-only where enforceable. If legacy clients can still write, their late records are explicitly treated as outstanding imports rather than evidence that the original migration is complete.

Imports use stable source-record identity and provenance. Re-importing the same source revision has one effect; a later source correction is compared with any destination correction rather than blindly overwriting it. Different real sessions must not be deduplicated merely because dates, exercises, or loads match.

A final reconciliation compares the migrated dataset with the source at the cutoff and records unresolved omissions. Late uploads are quarantined from automatic progression until reviewed, then imported or excluded with a reason. They retain performed dates and never reconstruct legacy live obligations automatically.

A recoverable source export and migration mapping are retained. If rollback is required after 2.0 accepts training, preserve and reconcile that new evidence before restoring an earlier system. A rollback cannot silently discard post-cutover work. The cutover report states verified coverage and known outstanding devices or records; it never claims complete migration beyond the checked boundary.

## 34. Architectural constraints

This document does not select a framework, database schema, event architecture, or reuse strategy. It does require:

- Stable identities independent of labels, dates, and positions.
- Separate ownership of future intent and started execution.
- Explicit change scope and preserved source relationships.
- Correctable history with provenance and no silent reinterpretation.
- Reliable measurement semantics and evidence eligibility.
- Repeat-safe logging, completion, and background processing.
- Recovery from interrupted work and explicit conflict handling.
- Recommendation applicability checks and explainable authority.
- Independent plan closure, milestone status, and celebration delivery.

Users should never need to understand seeds, receipts, materialization, revisions, generation lanes, or repair states to train. Internal mechanisms must serve these behavioral contracts.

## 35. Behavioral acceptance scenarios

These are product acceptance requirements. Deferred features must satisfy their applicable scenarios when delivered.

| Scenario | Required result |
| --- | --- |
| Skip the last Upper B of a training week | The next pending occurrence is available with its assigned stage; no identity ambiguity |
| Move a session from Tuesday to Thursday | Same occurrence, prescription, and source relationships |
| Start a later session | Earlier pending work remains pending unless explicitly resolved; next selection remains predictable |
| Edit four sets to three after a session starts | Open session retains four as its starting prescription; future sessions receive the edit |
| Explicitly shorten that open session | Its adjusted target changes while its starting prescription remains inspectable |
| Replace one of two same-name exercise positions | Only the selected position and explicitly selected future counterparts change |
| Repeat a training week | New occurrences reference the selected source intent; prior outcomes remain intact |
| Remove future work during restructuring | It is recorded as removed intent, not skipped performance |
| Finish eight logged sets with four unlogged | Session resolves; four remain unknown unless explicitly marked omitted |
| Attempt to skip a session containing recorded work | The work is retained and the session can finish partially |
| Correct 200 lb to 120 lb after a milestone | Current milestone evidence and future guidance update; past advice is not rewritten |
| Switch to a different machine | Related history is visible without assuming numerical equivalence |
| Leave suggested set values untouched | They never become performed work automatically |
| Log during temporary connection loss and reload | Acknowledged entries recover on the same device and synchronize without duplication |
| Finish twice or from stale concurrent state | No duplicate execution, plan advancement, or silent overwrite; conflicting unseen work remains recoverable |
| Train while a plan is paused | Standalone work records normally without resuming or satisfying plan obligations |
| Reach the squat milestone mid-plan | Milestone recognition occurs; the plan continues |
| Finish a plan without achieving its milestone | Plan completes; the longer-term milestone remains open |
| Skip all remaining occurrences | Plan can complete, with truthful performed-versus-skipped reporting |
| End a plan with pending occurrences | State is Concluded Early; pending work is not falsely labeled individually skipped |
| Copy a plan containing an excluded movement | Current restriction is surfaced before activation; no silent exception |
| Import a record with unknown load convention | Original data remains accessible; uncertain comparisons do not drive automatic progression |
| Dismiss completion review and train tomorrow | Workout access remains immediate; review remains available later |

### Collision and correction acceptance scenarios

| Scenario | Required result |
| --- | --- |
| Start from a cached preview while offline | Foundation explains that starting requires connectivity; no provisional execution is created |
| Start races with skip or removal | One accepted order; start either captures valid work or refreshes without creating a session |
| Two devices start simultaneously | One open execution; the other request resumes it or reports the conflict |
| Finish arrives before its referenced sets | Authoritative finish waits for all included changes and conflict resolution |
| Another device edits a set included in a pending finish | No silent winner; recoverable values and explicit reconciliation |
| Late independent work arrives after finalization | User can reconcile it as corrected evidence or a distinct historical workout; no automatic reassignment |
| End Plan while its workout is open | Plan remains Concluded Early; original execution resumes and finishes normally |
| Activate another plan with an old execution open | Activation is allowed after old-plan closure; new execution waits for the open one to resolve |
| Undo final finish with no other current plan | Same execution reopens and automatically completed plan returns to its prior nonterminal state |
| Undo final finish while another plan is current | No partial correction or silent replacement; explain the required explicit plan decision |
| Add forgotten sets to a truly finished session | Historical evidence correction, without reopening the plan or creating a workout |
| Remove all final unresolved pending work | Concluded Early, with removed-intent provenance |
| Shorten the endpoint and then finish retained work | Completed revised plan; review distinguishes original and revised intent |
| Substitute after two squat sets | Squat sets remain unchanged; replacement applies to explicitly selected remaining work |
| Add an exclusion after activation | Applicable start, edit, and recommendation boundaries surface the conflict |
| Restriction arrives while session is offline | Existing evidence survives; conflict surfaces when received; no claim of earlier enforcement |
| Copy a plan with a scoped exception | The exception does not transfer; current restriction is checked |
| Missing required RIR during double progression | No automatic load increase; relevant evidence remains visible |
| Top set improves but back-off group does not | Guidance evaluates their explicitly separate progression groups |
| New disruption follows two successful exposures | Old successes do not silently trigger escalation |
| Sunday workout syncs Tuesday | Exposure uses its performed training date and recency uses supported performed time |
| Correct a session date | Affected periods recalculate without a new execution |
| Legacy device uploads after cutoff | Outstanding import is identified, reviewed, and reconciled with provenance |
| Repeat migration or celebration processing | No duplicate performance records or repeated delivery of the same completion celebration |

## 36. North star

Trainer App helps the user design, execute, and improve training plans with less effort and greater trust.

It preserves the meaning of intended work, records reality accurately, adapts through deliberate changes, and offers judgment proportionate to its evidence.

It makes progress visible and meaningful accomplishments worth recognizing.

Every workout should begin with a simple experience:

> I know what I’m doing today. I know why I’m doing it. And the app is helping me do it well.
