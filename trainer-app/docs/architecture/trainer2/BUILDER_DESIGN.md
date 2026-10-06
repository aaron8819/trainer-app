# Approved Builder integration

The Builder uses the approved design-lab template, warm canvas, workout navigation, sticky scope, prescription cards and focused editing sheets. `src/components/trainer2/Builder.module.css` is scoped to draft authoring. Home, Program and Logger retain their approved presentation.

## Ownership and behavior

`engine/trainer2/plan-builder.ts` remains the owner of template creation, expansion, field-level inheritance, deload, swap compatibility, removal, set reduction and ordering. `PlanBuilder.tsx` applies these existing operations. A sheet commits only changed fields; untouched individual-set prescriptions, measurement conventions and exact stored kg values remain unchanged. A new or changed starting load is authored in lbs with the exercise's frozen catalog meaning. Starting loads are planned prescriptions, never performed results or automatic increases. Bodyweight has no numeric starting load; assistance explicitly says more lbs means easier. Authored descriptions retain the existing advanced measurement editor.

Creation starts with the existing five-week template: Lower A, Upper A, Lower B, Upper B; weekly RIR 3/3/2/1/4; four accumulation weeks and one deload. The template allocates existing domain identities once. Saved drafts bypass template selection. Reordering uses explicit 44px move controls, with no drag dependency.

Workout defaults apply to inheriting weeks. Week-only edits keep the existing field and individual-target masks, independent additions, explicit ordering and removal semantics. Deload still halves inherited working sets, rounded up. Restore, shared-removal conflicts and individually edited set reduction retain deliberate confirmations. Reduction warnings stay inside the sheet without losing local inputs. Individual sets and field reset controls remain available under inheritance details.

`ExercisePicker.tsx` enables Builder-only muscle filtering using the catalog adapter's actual primary/secondary facts, alongside the existing alias search and equipment filters. The current adapter supports 91 selectable exercises; the UI calculates that count from its actual membership. Unsupported entries remain unselectable and show their reason. Custom descriptions remain explicitly unmatched. Logger picker presentation is unchanged.

`DraftWorkbench.tsx` retains the authoritative CreateDraft, EditDraft, review, instruction and ActivatePlan commands. Account/ownership/plan-scoped session storage keeps unsaved applied draft edits and complete pending draft commands before submission. Reload of an uncertain save offers the identical request. A known stale revision preserves the losing document through reload; the user can inspect it and deliberately use retained edits against the latest revision, or continue with the latest saved document. This is whole-draft recovery, not an automatic merge. Accepted saves always reload the current server state. Browser storage failure prevents an unsafe save retry; session storage does not claim recovery after tab loss, cross-device sync or offline queueing.

`api/trainer2/planning.ts::readDraft` adds read-only `currentPlan` admission context to the existing saved review: owned Active/Paused plan ID and lifecycle, or null. The response validator accepts the optional field for older responses; when absent, the UI explicitly says eligibility will be checked at submission. This does not change the reviewed digest or acceptance policy. `api/trainer2/activation.ts` still rechecks the current-plan conflict under the existing account lock. The Builder disables activation for a displayed current plan and links to it. Open workouts are not a new activation blocker: the existing command does not consult them. Activation neither replaces a plan nor starts/closes a workout. Plan conclusion remains unavailable.

## Mobile and accessibility

Builder controls use at least 44px targets. Main numeric fields use large type and numeric/decimal input modes. Native dialogs provide modal isolation; explicit Tab wrapping, Escape dismissal and invoker focus return supplement it. Sheets scroll independently and size/position against the visual viewport. Their Apply footer remains inside the sheet. Fixed draft actions have document and safe-area clearance. Cancel discards only unapplied prescription-sheet inputs; applied draft edits remain. Program settings describe their immediate application to the draft.

## Verification and review handoff

Base: commit `689017b4acbda53daa6b17ef71a23f2eebe28923`, tree `3190056613f43f697df704ba4f9a1a28a8b4bc94`. The task worktree retains focused logs, qualified unchanged-owner evidence, disposable browser receipts, desktop/390px/320px screenshots and final commit/tree identity under `trainer-app/artifacts/builder/`. Independent review has not yet been performed on this change. Review the ownership boundaries, whole-draft recovery and stale-state choice, changed-field application, measurement meaning and read-only admission context; use the final identity and evidence in `HANDOFF.md` there.

Verification uses existing installed dependencies and task-owned synthetic loopback PostgreSQL/Next services. The disposable journey covers template creation → editing/reorder → week override → starting loads → lost accepted save/reload/replay → stale revision recovery → review → permitted activation → exact Home/Program prescription readback. It also covers catalog interactions, blocked activation with an Active plan and open workout, keyboard focus/containment, cancellation and mobile overflow. Required selected implementation checks, TypeScript, affected-file lint, contracts and whitespace checks are recorded. Unchanged acceptance, migrations, authentication, runtime and training UI owners reuse qualified retained evidence. No verification infrastructure was changed.

Physical iPhone/Safari and actual keyboard checks remain pending: viewport resizing, focus zoom, safe areas, toolbars, scrolling and reachable fields/actions. Chromium viewport emulation and a reduced-height viewport are not physical-device qualification.

## Separate synthetic preview

From this task worktree's `trainer-app`, with no inherited database targets:

```powershell
node node_modules/tsx/dist/cli.mjs artifacts/builder/run.ts preview --confirm-disposable
```

The task-local launcher reuses the existing owned-resource fixture setup and cleanup. Wait for `PREVIEW READY`, sign in at its printed `/trainer2/auth` URL with synthetic passcode `trainer2-local-review`, then open the printed Builder URL. It creates a fresh empty synthetic workspace; saving and activation use the real local commands. Exact current URL, stop-marker path and running PIDs are in the local handoff and preview receipt. Create that exact stop marker to stop only this preview. Restarting creates fresh synthetic data. Existing previews on 52176 and 4318 are preserved.

Prototype deviations: real save precedes authoritative review; no fixture-switch activation; no claim of 150 supported exercises; field-level inheritance replaces prototype snapshots; valid non-preset RIR and advanced prescriptions remain available; the existing unsupported conclusion flow stays unavailable. No schema, grants, V1, paid resource, hosted write, push or deployment changes.
