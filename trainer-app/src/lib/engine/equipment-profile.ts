import type { EquipmentType } from "./types";

export const EQUIPMENT_PROFILE_VALUES = [
  "FULL_GYM",
  "BARBELL_HOME",
  "DUMBBELLS",
  "MACHINES",
  "BODYWEIGHT",
] as const;

export type EquipmentProfile = (typeof EQUIPMENT_PROFILE_VALUES)[number];

const EQUIPMENT_BY_PROFILE: Record<
  EquipmentProfile,
  ReadonlySet<EquipmentType> | null
> = {
  FULL_GYM: null,
  BARBELL_HOME: new Set([
    "barbell",
    "rack",
    "bench",
    "dumbbell",
    "bodyweight",
    "band",
    "ez_bar",
    "trap_bar",
  ]),
  DUMBBELLS: new Set(["dumbbell", "bench", "bodyweight", "band"]),
  MACHINES: new Set(["machine", "cable", "bodyweight", "band"]),
  BODYWEIGHT: new Set(["bodyweight", "band"]),
};

function normalizeEquipment(value: string): EquipmentType {
  return value.trim().toLowerCase() as EquipmentType;
}

export function equipmentForProfile(
  profile: EquipmentProfile,
): readonly EquipmentType[] | null {
  const equipment = EQUIPMENT_BY_PROFILE[profile];
  return equipment ? [...equipment] : null;
}

export function isEquipmentProfileCompatible(
  requiredEquipment: readonly string[],
  profile: EquipmentProfile,
): boolean {
  const allowed = EQUIPMENT_BY_PROFILE[profile];
  if (!allowed) return true;
  if (requiredEquipment.length === 0) return true;
  return requiredEquipment.some((item) => allowed.has(normalizeEquipment(item)));
}
