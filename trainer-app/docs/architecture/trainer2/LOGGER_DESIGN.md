# Logger presentation

`src/components/trainer2/Logger.module.css` owns the approved prototype's warm canvas, active card, 27px numeric fields, controls, sage sticky rest timer, queue and compact history styling. `Workout.tsx` applies the scope only to Trainer2 execution and completed-review screens. The execution page uses the same warm background. V1, Home/Program and Builder owners are unchanged.

`ActiveWorkout.tsx` keeps the existing execution-owned selection, prefill inputs, result readback, progress counts, additions and swap controllers. Deliberate navigation aligns the active card beneath the visible sticky timer and focuses its heading without opening a numeric keyboard. Typing does not request scrolling. History uses a native modal dialog with Escape dismissal and focus return; it displays the existing comparable previous execution, including its latest corrections, and retains the source-workout link. It does not invent additional history sessions. Muscles appear in the queue; chips remain directly available.

`SetResultRow.tsx` retains its form parsing, blank/zero distinctions, measurement conventions, original measurement preservation, durable identities, pending envelopes, stale-version recovery and drafts. Reps offer −1/+1; pounds offer −10/−5/+5/+10 and Clear. RIR presets are 0–5 with numeric entry for other valid values. Decimal loads remain supported. Feedback reserves space; long recovery messages can expand rather than being hidden. Ordinary input has no Discard input button. Recovery and closed-workout retained-input controls remain visible. Normal corrections have no reason field; clearing an erroneous result still requires the existing explicit reason under Set options.

Prescribed loads retain the existing nearest-five lbs suggestion. Untouched accepted session-added loads and carried actual measurements retain their original exact measurement; editing pounds records pounds. These are different existing measurement paths, not a visual conversion rule.

`RestBar.tsx` changes presentation only: deadline, start/reset qualification, adjustments, dismissal, cross-tab synchronization and persistence stay in their existing owners. Corrections and skips do not become rest-start events.

`FinishWorkout.tsx` now reviews both resolved and unresolved workouts before submission. The existing inline confirmation owner freezes the reviewed snapshot, preserves exact retry/readback and navigates to Home only after confirmed completion. No next workout starts automatically. Keep working cancels the decision. Completed results remain reviewable and correctable.

## Prototype adaptations

- Keep the disposable/protected-trial warning, exact target text, measurement conventions, recovery controls and Set options.
- Keep the existing inline finish confirmation and execution Training link rather than adding prototype navigation or a second finish owner.
- Add set stays beside each exercise's chips; Swap stays with the active exercise. No duplicate command controller is mounted for a second shortcut.
- History shows the one comparable previous execution available from the released read model, rather than simulated multi-session history.
- Clear load and numeric RIR add space beyond the prototype's original demo. Actual saved facts and valid RIR outside the presets remain intact.
- Builder styling and behavior are a separate slice.

## Disposable verification and preview

Use the repository-installed dependencies from `trainer-app`, with no inherited database targets:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-logger-design.ts --confirm-disposable
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-logger-design.ts --confirm-disposable
```

The launcher reuses the accepted Home/Program fixture's isolated PostgreSQL 17, restricted runtime connections, synthetic owner/session, separate Next port, source manifest and ownership-safe cleanup. Logger mode seeds comparable previous performance and a kg prescription through existing owners. It does not access hosted data or enable a real owner. Verification records screenshots, failed evidence, command recovery and cleanup separately under `artifacts/trainer2/logger-verify-*`.

The preview intentionally retains its own synthetic app/database. Its printed `preview.json` contains the invocation-specific Home/auth URLs and stop marker. Sign in using `trainer2-local-review`, then choose Resume workout. Enter, Ctrl+C or creation of that exact stop marker stops only its owned services. Restarting creates fresh synthetic data.

Desktop Chromium, 390px, 320px and reduced-height viewport checks are emulation. Physical iPhone/Safari, actual keyboard/visual-viewport behavior, focus zoom, browser toolbar/safe-area rendering and background timer suspension remain unverified.
