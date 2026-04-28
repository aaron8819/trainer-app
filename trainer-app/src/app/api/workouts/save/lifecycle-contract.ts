export {
  buildPerformedLifecycleCounterUpdate,
  deriveSaveRouteMesoSnapshot,
  resolvePersistedAdvancesSplit,
  shouldAdvanceLifecycleForPerformedTransition,
  type SaveRouteMesocycle,
  type SaveRouteMesoSnapshot,
} from "@/lib/api/save-workout/lifecycle";
export {
  assertMesocycleAllowsWorkoutSave,
  getClosedMesocycleSaveFenceReason,
  type SaveRouteMesocycleState,
} from "@/lib/api/save-workout/guards";
