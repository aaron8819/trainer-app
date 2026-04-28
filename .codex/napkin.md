# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|-----------------|--------------------|
| 2026-04-28 | self | Used bash-style `node - <<'NODE'` heredoc in PowerShell and hit parser errors. | Use a PowerShell here-string piped to `node` for inline Node scripts. |
| 2026-04-28 | self | Used `&&` command chaining in PowerShell while checking git status/diff and hit a parser error. | Run separate PowerShell commands or use `;` only when sequential shell semantics are intended. |
| 2026-04-28 | self | Added a new typed planner-only artifact field and initially only fixed the focused mesocycle explain tests. | Update serializer, artifact serialization, and CLI fixtures together whenever `MesocycleExplainPlannerOnlyNoRepair` gains a required field. |
| 2026-04-28 | self | In a V2 selection diagnostic, initially allowed same-muscle fallback to assign a Week 1 exercise to a lane whose existing lane evidence had no selected exercise. | Preserve identities only from explicit lane evidence; use inventory evidence for alternatives and mark missing generic inventory as not evaluated. |
| 2026-04-28 | self | V2 `ExerciseSelectionPlanDiagnostic` can re-harden concentration artifacts already tier-downgraded by `v2TargetVsNoRepairDiff` / acceptance classification. | Reuse the tier-aware no-repair concentration classification for readout status; raw `exerciseConcentration` flags alone are too broad for blocker status. |
| 2026-04-28 | self | The V2 diagnostic also treated `squat_compound` / `squat_or_quad_support` as class mismatches against lower quad-support planned classes, inflating readout blockers and class mismatch counts. | Keep class aliases diagnostic-only and satisfy lower quad-support planned classes through the diagnostic matcher without touching selection or generation. |

## User Preferences
- Keep Trainer implementation and audit work concise, direct, and production-friendly.

## Patterns That Work
- For V2 planner/repair questions, treat repaired projection as evidence of legacy downstream responsibility, not as the target architecture.

## Patterns That Don't Work
- Do not promote suspicious downstream repair rows unless the owning V2 layer is clearly upstream and compatible with the target architecture.

## Domain Notes
- V2 target path: MesocycleDemand -> WeeklyDemandCurve -> SlotDemandAllocationByWeek -> ExerciseClassDistributionBySlot -> SetDistributionIntent -> ExerciseSelectionPlan -> Accepted Seed -> Runtime Replay.
- V2 cross-week readiness distinction: `accumulationWeekProjection` may repeat Week 1 shape for diagnostic Weeks 2-4, but replacement readiness still treats Weeks 2-4 as unprojected while `slotDemandAllocationByWeek` / `preselectionDistributionPolicyByWeek` have missing per-week slot distribution, fatigue carryover, continuity, and identity policy.
- The V2 cross-week gate currently recognizes Weeks 2-4 readiness only when both `slotDemandAllocationByWeek` and `preselectionDistributionPolicyByWeek` use statuses containing `planner_owned`; `v2SetDistributionIntent` by itself remains diagnostic-only.
