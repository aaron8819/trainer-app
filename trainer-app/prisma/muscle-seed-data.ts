import { MUSCLE_POLICIES } from "../src/lib/engine/muscle-policy";

export type MuscleSeedRow = {
  name: string;
  mv: number;
  mev: number;
  mav: number;
  mrv: number;
  sraHours: number;
};

export const MUSCLE_SEED_ROWS: readonly MuscleSeedRow[] = MUSCLE_POLICIES.map(
  (policy) => ({
    name: policy.displayName,
    ...policy.volume,
    sraHours: policy.defaultSraHours,
  })
);
