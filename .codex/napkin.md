# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|-----------------|--------------------|
| 2026-04-28 | self | Used bash-style `node - <<'NODE'` heredoc in PowerShell and hit parser errors. | Use a PowerShell here-string piped to `node` for inline Node scripts. |

## User Preferences
- Keep Trainer implementation and audit work concise, direct, and production-friendly.

## Patterns That Work
- For V2 planner/repair questions, treat repaired projection as evidence of legacy downstream responsibility, not as the target architecture.

## Patterns That Don't Work
- Do not promote suspicious downstream repair rows unless the owning V2 layer is clearly upstream and compatible with the target architecture.

## Domain Notes
- V2 target path: MesocycleDemand -> WeeklyDemandCurve -> SlotDemandAllocationByWeek -> ExerciseClassDistributionBySlot -> SetDistributionIntent -> ExerciseSelectionPlan -> Accepted Seed -> Runtime Replay.
- V2 cross-week readiness distinction: `accumulationWeekProjection` may repeat Week 1 shape for diagnostic Weeks 2-4, but replacement readiness still treats Weeks 2-4 as unprojected while `slotDemandAllocationByWeek` / `preselectionDistributionPolicyByWeek` have missing per-week slot distribution, fatigue carryover, continuity, and identity policy.
