import type {
  EquipmentType,
  JointStress,
  MovementPatternV2,
  SplitTag,
  StimulusBias,
} from "@/lib/engine/types";

export type MuscleGroup = "chest" | "back" | "shoulders" | "arms" | "legs" | "core";

export type ExerciseListItem = {
  id: string;
  name: string;
  isCompound: boolean;
  movementPatternsV2: MovementPatternV2[];
  splitTags: SplitTag[];
  jointStress: JointStress;
  equipment: EquipmentType[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  sfrScore: number;
  lengthPositionScore: number;
  isFavorite: boolean;
  isAvoided: boolean;
};

export type ExerciseDetail = ExerciseListItem & {
  isMainLift: boolean;
  isMainLiftEligible: boolean;
  fatigueCost: number;
  stimulusBias: StimulusBias[];
  timePerSetSec: number;
  aliases: string[];
  variations: { id: string; name: string; description?: string }[];
  substitutes: { id: string; name: string; primaryMuscles: string[] }[];
  baseline?: {
    id: string;
    context: string;
    workingWeightMin?: number;
    workingWeightMax?: number;
    workingRepsMin?: number;
    workingRepsMax?: number;
    topSetWeight?: number;
    topSetReps?: number;
    notes?: string;
  };
};

export type SortField = "name" | "fatigueCost" | "sfrScore" | "lengthPositionScore";
export type SortDirection = "asc" | "desc";

export type ExerciseFilters = {
  search?: string;
  muscleGroup?: MuscleGroup;
  muscle?: string;
  isCompound?: boolean;
  movementPattern?: MovementPatternV2;
  equipment?: EquipmentType;
  splitTag?: SplitTag;
  favoritesOnly?: boolean;
};

export type ExerciseSort = {
  field: SortField;
  direction: SortDirection;
};
