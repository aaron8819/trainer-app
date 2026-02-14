export * from "./apply-loads";
export * from "./random";
export * from "./history";
export * from "./rules";
export * from "./types";
export * from "./utils";
export * from "./main-lift-picker";
export * from "./prescription";
export * from "./volume";
export * from "./volume-landmarks";
export * from "./timeboxing";
export * from "./substitution";
export * from "./progression";
export * from "./sra";
export * from "./template-session";
export * from "./template-analysis";
export * from "./smart-build";
export * from "./warmup-ramp";
export * from "./session-types";

// Selection v2 (multi-objective beam search)
export * from "./selection-v2";

// Periodization
export type {
  BlockType,
  VolumeTarget,
  IntensityBias,
  AdaptationType,
  MacroCycle,
  Mesocycle,
  TrainingBlock,
  BlockContext,
  PrescriptionModifiers,
} from "./periodization/types";
export type { GenerateMacroInput } from "./periodization/generate-macro";
export type { BlockTemplate } from "./periodization/block-config";
export type {
  BasePrescription,
  BlockAwarePrescription,
  PrescribeWithBlockInput,
} from "./periodization/prescribe-with-block";
export { generateMacroCycle } from "./periodization/generate-macro";
export { deriveBlockContext } from "./periodization/block-context";
export { getPrescriptionModifiers, getMesoTemplateForAge, getMesoFocus } from "./periodization/block-config";
export { prescribeWithBlock } from "./periodization/prescribe-with-block";
