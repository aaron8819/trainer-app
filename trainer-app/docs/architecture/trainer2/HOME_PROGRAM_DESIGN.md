# Home and Program presentation

`src/components/trainer2/TrainingOverview.tsx` and its CSS module own the Trainer2-only warm canvas, sage progress surface, selectable workout rows, prescription preview, compact week ribbon, expandable Program cards and bottom navigation. `DraftWorkbench.tsx` applies this shell only to saved training views. Logger now uses its separately scoped [approved presentation](LOGGER_DESIGN.md). Builder retains its existing presentation, including the default `PlannedWorkout` rendering outside the designed screens.

`Workout.tsx` still owns the existing validated reads, durable Start identity, same-tab recovery and stale-response protection. Selecting any current-week occurrence is read-only, including finished and skipped occurrences. Readback retains a selected occurrence while it remains a member of the authoritative current week; advancement resets selection to the new week. Only explicit Start submits a command, and only a server-eligible occurrence may start. The authoritative account-wide open execution supplies the prominent Resume link even while another workout is previewed. The preview of that open occurrence uses its immutable start snapshot.

`SkipWorkout.tsx` and `AdvanceWeek.tsx` remain the command owners and stay mounted through pending Start feedback. Explicit advancement uses released eligibility and exact retry/readback. The final week requires Complete program; finish and skip do not advance the week. Program browsing changes only presentation state. It shows Saved from the validated saved-plan read, and occurrence status comes from ReadNext; a past week is never assumed to have been performed.

Prescriptions use the existing exact-consecutive-target grouping and load display owners. Unlike reps, RIR, classifications, optionality, measurement conventions or rest values never collapse together. Unspecified loads stay unspecified; assistance states that more weight means easier. Finished is a neutral terminal label because ReadNext does not expose full-versus-partial performance. View results retains the existing execution review and correction capabilities.

Paused and other unsupported lifecycle states show their saved state and prescriptions. They do not call unsupported ReadNext or fabricate Pause/Resume commands. There is no released empty active program: draft validation requires occurrences. An empty workspace remains the existing unsaved plan builder. Saved-plan loading/read failure has a dedicated status and retry surface.

## Prototype adaptations

- Omit synthetic duration estimates, guessed past-week completion and simulated failure state.
- Keep explicit final-week completion instead of treating resolved workouts as program completion.
- Keep real sets, load conventions, per-side/alternating counts, rest, optional work and RIR outside compact presets.
- Resume is an ordinary link to the authoritative execution; Program review links retain existing review capabilities.
- The read model does not support an arbitrary future-workout Home preview link. Program expands that workout's exact prescription and links back to current-week selection.
- No new dependency, schema, grant, authentication or training-policy changes.

## Verification and local preview

From `trainer-app`, with repository-installed dependencies and no inherited database targets:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-home-program.ts --confirm-disposable
node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-home-program-surfaces.ts --confirm-disposable
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-home-program.ts --confirm-disposable
```

The surfaces launcher isolates the remaining mobile/read/focus checks without rerunning the core lifecycle journey. Each launcher validates exact confirmation before importing database code. The native cluster explicitly uses UTC to match the released container fixture and Prisma timestamp transport. Each invocation creates its own loopback PostgreSQL 17 cluster (the installed Windows PostgreSQL 17 runtime when available, otherwise a disposable container), restricted connections, synthetic owner/session and separate Next port. The verification journey uses real application reads/commands and stops its own browser, app and database runtime. The preview intentionally retains its app and synthetic database until Enter, Ctrl+C or creation of the `stopFile` printed in `preview.json`; a full restart creates fresh synthetic data. Its printed Home URL and auth URL are invocation-specific; the synthetic passcode is `trainer2-local-review`. Sign in at that auth URL, then open Home. Existing services, profiles and the prototype on 4318 are untouched.

The journey covers read-only selection, exact preview, explicit Start, authoritative Resume, Program browsing at desktop/390px/320px, finished/skipped inspection, explicit advancement, lost accepted Start replay after reload, final completion, load semantics, long names, loading/error recovery, keyboard focus and final-card clearance. Screenshots and source manifests are saved under invocation-specific `artifacts/trainer2/home-program-verify-*`. Focused component tests additionally protect terminal selection, paused saved state and durable recovery. Browser emulation does not qualify physical iPhone/Safari or a real mobile keyboard.
